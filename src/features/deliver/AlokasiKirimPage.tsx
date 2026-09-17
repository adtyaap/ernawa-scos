import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatKg } from '../../lib/format';
import type { AvailableBatchLine, Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface OpenDemandOption {
  id: string;
  requested_qty_kg: number;
  customer: { name: string } | null;
  product: { name: string } | null;
}

interface SelectedRow {
  line: AvailableBatchLine;
  qty: number;
}

function isStrictlyOlder(a: AvailableBatchLine, b: AvailableBatchLine): boolean {
  if (!a.received_at) return false;
  if (!b.received_at) return true;
  return new Date(a.received_at).getTime() < new Date(b.received_at).getTime();
}

// Sesuai pseudocode yang sudah di-approve: setelah menerapkan pilihan user,
// kalau ADA batch_line yang lebih tua dari salah satu yang dipilih dan
// masih menyisakan saldo yang tidak diambil -> override FEFO.
function detectFefoOverride(lines: AvailableBatchLine[], selections: { batch_line_id: string; qty: number }[]): boolean {
  if (selections.length === 0) return false;

  const remaining = new Map(lines.map((l) => [l.batch_line_id, l.balance_kg]));
  for (const sel of selections) {
    remaining.set(sel.batch_line_id, (remaining.get(sel.batch_line_id) ?? 0) - sel.qty);
  }

  for (const sel of selections) {
    const selectedLine = lines.find((l) => l.batch_line_id === sel.batch_line_id);
    if (!selectedLine) continue;

    const hasOlderUnused = lines.some(
      (candidate) =>
        candidate.batch_line_id !== selectedLine.batch_line_id &&
        isStrictlyOlder(candidate, selectedLine) &&
        (remaining.get(candidate.batch_line_id) ?? 0) > 0,
    );

    if (hasOlderUnused) return true;
  }

  return false;
}

function formatAge(ageHours: number | null): string {
  if (ageHours === null) return 'umur tidak diketahui';
  if (ageHours < 24) return `${Math.round(ageHours)} jam lalu`;
  return `${Math.round(ageHours / 24)} hari lalu`;
}

// Alur (approved): pilih site -> stock-picker via RPC get_available_batch_lines
// (FEFO + badge overdue) -> pilih batch_line+qty -> deteksi override FEFO ->
// submit.
//
// ATOMIK (migration 0010): submit ini SATU panggilan RPC
// create_delivery_with_allocations — insert deliveries, insert
// delivery_allocations (dengan re-validasi saldo pakai row-lock di dalam
// function, menutup celah race-condition concurrent allocation), dan update
// demands.status='allocated' semuanya jadi satu transaksi all-or-nothing.
// Gap non-atomicity yang dulu dicatat di CLAUDE.md "Catatan Tech Debt" sudah
// ditutup lewat ini. Konsekuensinya: kegagalan sekarang berarti TIDAK ADA
// yang tersimpan sama sekali (bukan lagi delivery "nyangkut" tanpa
// alokasi) — jadi tidak ada lagi pola retry/orphan-delivery seperti versi
// sebelumnya. Kalau RPC gagal, form TIDAK direset (supaya user tidak
// kehilangan pilihan yang sudah diketik), tinggal perbaiki lalu submit ulang.
export function AlokasiKirimPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [openDemands, setOpenDemands] = useState<OpenDemandOption[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedDemandId, setSelectedDemandId] = useState('');

  const [availableBatchLines, setAvailableBatchLines] = useState<AvailableBatchLine[]>([]);
  const [loadingBatchLines, setLoadingBatchLines] = useState(false);
  const [batchLinesError, setBatchLinesError] = useState<string | null>(null);

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [overrideReason, setOverrideReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadOpenDemands() {
    const { data } = await supabase
      .from('demands')
      .select('id, requested_qty_kg, customer:customers(name), product:products(name)')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    setOpenDemands((data as unknown as OpenDemandOption[]) ?? []);
  }

  useEffect(() => {
    async function loadMaster() {
      const { data: siteData } = await supabase.from('sites').select('id, name, type').order('name');
      setSites((siteData as Site[]) ?? []);
      await loadOpenDemands();
      setLoadingMaster(false);
    }
    loadMaster();
  }, []);

  async function loadAvailableBatchLines(siteId: string) {
    if (!siteId) {
      setAvailableBatchLines([]);
      return;
    }
    setLoadingBatchLines(true);
    setBatchLinesError(null);

    const { data, error } = await supabase.rpc('get_available_batch_lines', { p_site_id: siteId });

    if (error) {
      setBatchLinesError(error.message);
      setAvailableBatchLines([]);
    } else {
      setAvailableBatchLines((data as AvailableBatchLine[]) ?? []);
    }
    setLoadingBatchLines(false);
  }

  useEffect(() => {
    setSelections({});
    setOverrideReason('');
    loadAvailableBatchLines(selectedSiteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId]);

  function updateSelection(batchLineId: string, value: string) {
    setSelections((prev) => ({ ...prev, [batchLineId]: value }));
  }

  const selectedRows: SelectedRow[] = useMemo(
    () =>
      availableBatchLines
        .map((line) => ({ line, qty: Number(selections[line.batch_line_id] || 0) }))
        .filter((row) => row.qty > 0),
    [availableBatchLines, selections],
  );

  const totalQty = useMemo(() => selectedRows.reduce((sum, r) => sum + r.qty, 0), [selectedRows]);

  const isOverride = useMemo(
    () =>
      detectFefoOverride(
        availableBatchLines,
        selectedRows.map((r) => ({ batch_line_id: r.line.batch_line_id, qty: r.qty })),
      ),
    [availableBatchLines, selectedRows],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    if (!selectedSiteId) {
      setFeedback({ variant: 'danger', message: 'Pilih site dulu.' });
      return;
    }

    if (selectedRows.length === 0) {
      setFeedback({ variant: 'danger', message: 'Pilih minimal satu batch_line dengan qty lebih dari 0.' });
      return;
    }

    const overAllocated = selectedRows.find((row) => row.qty > row.line.balance_kg);
    if (overAllocated) {
      setFeedback({
        variant: 'danger',
        message: `Qty untuk ${overAllocated.line.product_name} (${overAllocated.line.tank_name}) melebihi saldo tersedia (${formatKg(overAllocated.line.balance_kg)}).`,
      });
      return;
    }

    if (isOverride && !overrideReason.trim()) {
      setFeedback({
        variant: 'danger',
        message: 'Ada batch_line lebih tua yang masih tersedia tapi dilewati — wajib isi alasan override FEFO.',
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.rpc('create_delivery_with_allocations', {
      p_site_id: selectedSiteId,
      p_demand_id: selectedDemandId || null,
      p_allocations: selectedRows.map((row) => ({
        batch_line_id: row.line.batch_line_id,
        qty_kg: row.qty,
        fefo_rank: availableBatchLines.findIndex((l) => l.batch_line_id === row.line.batch_line_id) + 1,
      })),
      p_override_reason: isOverride ? overrideReason.trim() : null,
    });

    if (error) {
      // Atomik: kalau ini gagal, TIDAK ADA yang tersimpan sama sekali
      // (termasuk deliveries-nya) — jadi form sengaja TIDAK direset, user
      // tinggal perbaiki input (mis. kurangi qty kalau ini pesan "saldo
      // tidak cukup" dari race-condition guard) lalu submit ulang.
      setFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    setFeedback({ variant: 'success', message: 'Delivery + alokasi berhasil dicatat.' });
    setSelections({});
    setOverrideReason('');
    setSelectedDemandId('');
    setSubmitting(false);

    await Promise.all([loadAvailableBatchLines(selectedSiteId), loadOpenDemands()]);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Deliver &gt; Alokasi &amp; Kirim</h1>
        <p className="text-sm text-app-muted">
          Pilih site, alokasikan stok (FEFO) untuk satu delivery. Timbang aktual dicatat belakangan di Konfirmasi
          Timbang.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Perhatian'}>
          {feedback.message}
        </AlertBanner>
      )}

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Site *</span>
            <select
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              className={inputClass}
              disabled={loadingMaster}
            >
              <option value="">Pilih site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.type})
                </option>
              ))}
            </select>
            {selectedSiteId && (
              <StatusBadge
                label={sites.find((s) => s.id === selectedSiteId)?.type === 'trading' ? 'Trading' : 'Budidaya'}
                tone={sites.find((s) => s.id === selectedSiteId)?.type === 'trading' ? 'info' : 'success'}
              />
            )}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Demand (opsional)</span>
            <select
              value={selectedDemandId}
              onChange={(e) => setSelectedDemandId(e.target.value)}
              className={inputClass}
              disabled={loadingMaster}
            >
              <option value="">Spot sale (tanpa demand)</option>
              {openDemands.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.customer?.name ?? '-'} — {d.product?.name ?? '-'} ({formatKg(d.requested_qty_kg)})
                </option>
              ))}
            </select>
          </label>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-app-text">Stok Tersedia (FEFO — paling lama di atas)</h2>
              {totalQty > 0 && <span className="text-xs text-app-muted">Total dipilih: {formatKg(totalQty)}</span>}
            </div>

            {!selectedSiteId && <p className="text-sm text-app-muted">Pilih site dulu untuk melihat stok.</p>}
            {loadingBatchLines && <p className="text-sm text-app-muted">Memuat stok...</p>}
            {batchLinesError && (
              <AlertBanner variant="danger" title="Gagal memuat stok">
                {batchLinesError}
              </AlertBanner>
            )}
            {selectedSiteId && !loadingBatchLines && !batchLinesError && availableBatchLines.length === 0 && (
              <p className="text-sm text-app-muted">Tidak ada stok tersedia di site ini.</p>
            )}

            <div className="space-y-2">
              {availableBatchLines.map((line) => (
                <div
                  key={line.batch_line_id}
                  className="grid grid-cols-1 gap-2 rounded-md border border-app-border p-3 sm:grid-cols-[2fr_1fr_1fr_1fr]"
                >
                  <div>
                    <p className="text-sm font-medium text-app-text">{line.product_name}</p>
                    <p className="text-xs text-app-muted">{line.tank_name}</p>
                  </div>
                  <div className="text-sm text-app-text">{formatKg(line.balance_kg)} tersedia</div>
                  <div className="space-y-1">
                    <p className="text-xs text-app-muted">{formatAge(line.age_hours)}</p>
                    {line.is_overdue ? (
                      <StatusBadge label="Lewat ambang holding" tone="danger" />
                    ) : line.max_holding_hours === null ? (
                      <StatusBadge label="Ambang belum diatur" tone="neutral" />
                    ) : null}
                  </div>
                  <input
                    type="number"
                    min="0"
                    max={line.balance_kg}
                    step="0.001"
                    placeholder="Qty (kg)"
                    value={selections[line.batch_line_id] ?? ''}
                    onChange={(e) => updateSelection(line.batch_line_id, e.target.value)}
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
          </div>

          {isOverride && (
            <div className="space-y-1">
              <AlertBanner variant="warning" title="Menyimpang dari urutan FEFO">
                Ada batch_line lebih tua yang masih tersedia tapi dilewati. Wajib isi alasan di bawah.
              </AlertBanner>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-app-muted">Alasan Override FEFO *</span>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={2}
                  className={inputClass}
                  placeholder="Mis. batch lebih tua sudah dipesan customer lain / kualitas tidak sesuai"
                />
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !selectedSiteId || selectedRows.length === 0 || (isOverride && !overrideReason.trim())}
            className="rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {submitting ? 'Menyimpan...' : 'Simpan Delivery & Alokasi'}
          </button>
        </form>
      </div>
    </div>
  );
}
