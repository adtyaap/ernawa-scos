import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { formatKg, todayLocalDate } from '../../lib/format';
import type { AvailableBatchLine, Site, Tank } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface HandoverLineRow {
  id: string;
  qty_kg: number;
  qty_kg_received: number | null;
  batch_line: {
    id: string;
    receiving_lot: { product: { name: string } | null } | null;
    batch: { tank: { name: string } | null } | null;
  } | null;
}

interface PendingHandover {
  id: string;
  from_site_id: string;
  to_site_id: string;
  handed_over_at: string;
  notes: string | null;
  from_site: { name: string } | null;
  to_site: { name: string } | null;
  handover_lines: HandoverLineRow[];
}

// Serah Terima antar site — dua langkah, dua aktor (migration 0029):
//
// 1) KIRIM: dijalankan orang di site asal (RLS: akses site asal saja cukup).
//    Stok LANGSUNG berkurang di site asal seketika dikirim (movement_type
//    transfer_out) — barang dianggap "di jalan", tidak bisa dialokasikan lagi
//    ke delivery lain sampai batal/dikoreksi manual oleh owner.
//
// 2) KONFIRMASI TERIMA: dijalankan orang di site tujuan (RLS: akses site
//    tujuan saja cukup) — TIDAK perlu akses site asal. Qty yang benar-benar
//    diterima boleh lebih kecil dari qty dikirim (mis. ada mortalitas selama
//    perjalanan) — selisihnya otomatis tercatat sebagai 'shrinkage' di ledger
//    site asal, bukan dihilangkan begitu saja.
//
// Belum ada mekanisme "batalkan kiriman" sebelum dikonfirmasi (dicatat di
// CLAUDE.md tech debt) — kalau salah kirim, untuk sementara perlu Koreksi
// Ledger manual oleh owner.
export function HandoverPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  // --- Kirim ---
  const [fromSiteId, setFromSiteId] = useState('');
  const [toSiteId, setToSiteId] = useState('');
  const [availableBatchLines, setAvailableBatchLines] = useState<AvailableBatchLine[]>([]);
  const [loadingBatchLines, setLoadingBatchLines] = useState(false);
  const [dispatchSelections, setDispatchSelections] = useState<Record<string, string>>({});
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
  const [dispatchFeedback, setDispatchFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  // --- Konfirmasi Terima ---
  const [pending, setPending] = useState<PendingHandover[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMaster() {
      const { data } = await supabase.from('sites').select('id, name, type').order('name');
      setSites((data as Site[]) ?? []);
      setLoadingMaster(false);
    }
    loadMaster();
    loadPending();
  }, []);

  async function loadPending() {
    setLoadingPending(true);
    setPendingError(null);

    const { data, error } = await supabase
      .from('handovers')
      .select(
        `id, from_site_id, to_site_id, handed_over_at, notes,
         from_site:sites!handovers_from_site_id_fkey(name),
         to_site:sites!handovers_to_site_id_fkey(name),
         handover_lines(
           id, qty_kg, qty_kg_received,
           batch_line:batch_lines!handover_lines_batch_line_id_fkey(
             id,
             receiving_lot:receiving_lots(product:products(name)),
             batch:batches(tank:tanks(name))
           )
         )`,
      )
      .is('received_by', null)
      .is('cancelled_at', null)
      .order('handed_over_at', { ascending: false });

    if (error) {
      setPendingError(error.message);
      setPending([]);
    } else {
      setPending((data as unknown as PendingHandover[]) ?? []);
    }
    setLoadingPending(false);
  }

  async function loadAvailableBatchLines(siteId: string) {
    if (!siteId) {
      setAvailableBatchLines([]);
      return;
    }
    setLoadingBatchLines(true);
    const { data, error } = await supabase.rpc('get_available_batch_lines', { p_site_id: siteId });
    setAvailableBatchLines(error ? [] : ((data as AvailableBatchLine[]) ?? []));
    setLoadingBatchLines(false);
  }

  useEffect(() => {
    setDispatchSelections({});
    loadAvailableBatchLines(fromSiteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromSiteId]);

  const dispatchRows = useMemo(
    () =>
      availableBatchLines
        .map((line) => ({ line, qty: Number(dispatchSelections[line.batch_line_id] || 0) }))
        .filter((row) => row.qty > 0),
    [availableBatchLines, dispatchSelections],
  );

  async function handleDispatchSubmit(event: FormEvent) {
    event.preventDefault();
    if (dispatchSubmitting) return;

    if (!fromSiteId || !toSiteId) {
      setDispatchFeedback({ variant: 'danger', message: 'Pilih site asal dan site tujuan.' });
      return;
    }
    if (fromSiteId === toSiteId) {
      setDispatchFeedback({ variant: 'danger', message: 'Site asal dan site tujuan tidak boleh sama.' });
      return;
    }
    if (dispatchRows.length === 0) {
      setDispatchFeedback({ variant: 'danger', message: 'Pilih minimal satu batch_line dengan qty lebih dari 0.' });
      return;
    }
    const overAllocated = dispatchRows.find((row) => row.qty > row.line.balance_kg);
    if (overAllocated) {
      setDispatchFeedback({
        variant: 'danger',
        message: `Qty untuk ${overAllocated.line.product_name} (${overAllocated.line.tank_name}) melebihi saldo tersedia (${formatKg(overAllocated.line.balance_kg)}).`,
      });
      return;
    }

    setDispatchSubmitting(true);
    setDispatchFeedback(null);

    const { error } = await supabase.rpc('create_handover_dispatch', {
      p_from_site_id: fromSiteId,
      p_to_site_id: toSiteId,
      p_lines: dispatchRows.map((row) => ({ batch_line_id: row.line.batch_line_id, qty_kg: row.qty })),
      p_notes: dispatchNotes.trim() || undefined,
      p_client_id: crypto.randomUUID(),
    });

    if (error) {
      setDispatchFeedback({ variant: 'danger', message: error.message });
      setDispatchSubmitting(false);
      return;
    }

    setDispatchFeedback({ variant: 'success', message: 'Handover terkirim. Menunggu konfirmasi terima di site tujuan.' });
    setDispatchSelections({});
    setDispatchNotes('');
    setDispatchSubmitting(false);
    await Promise.all([loadAvailableBatchLines(fromSiteId), loadPending()]);
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Serah Terima</h1>
        <p className="text-sm text-app-muted">
          Pindahkan stok antar site. Kirim cukup akses site asal; Konfirmasi Terima cukup akses site tujuan — tidak
          perlu satu orang punya akses ke keduanya.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <h2 className="text-sm font-semibold text-app-text">Kirim</h2>

        {dispatchFeedback && (
          <AlertBanner
            variant={dispatchFeedback.variant}
            title={dispatchFeedback.variant === 'success' ? 'Berhasil' : 'Gagal'}
          >
            {dispatchFeedback.message}
          </AlertBanner>
        )}

        <form onSubmit={handleDispatchSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Site Asal *</span>
              <select value={fromSiteId} onChange={(e) => setFromSiteId(e.target.value)} className={inputClass} disabled={loadingMaster}>
                <option value="">Pilih site asal</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Site Tujuan *</span>
              <select value={toSiteId} onChange={(e) => setToSiteId(e.target.value)} className={inputClass} disabled={loadingMaster}>
                <option value="">Pilih site tujuan</option>
                {sites
                  .filter((s) => s.id !== fromSiteId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type})
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-app-text">Pilih Stok dari Site Asal</h3>
            {!fromSiteId && <p className="text-sm text-app-muted">Pilih site asal dulu untuk melihat stok.</p>}
            {loadingBatchLines && <p className="text-sm text-app-muted">Memuat stok...</p>}
            {fromSiteId && !loadingBatchLines && availableBatchLines.length === 0 && (
              <p className="text-sm text-app-muted">Tidak ada stok tersedia di site ini.</p>
            )}
            <div className="space-y-2">
              {availableBatchLines.map((line) => (
                <div
                  key={line.batch_line_id}
                  className="grid grid-cols-1 gap-2 rounded-md border border-app-border p-3 sm:grid-cols-[2fr_1fr_1fr]"
                >
                  <div>
                    <p className="text-sm font-medium text-app-text">{line.product_name}</p>
                    <p className="text-xs text-app-muted">{line.tank_name}</p>
                  </div>
                  <div className="text-sm text-app-text">{formatKg(line.balance_kg)} tersedia</div>
                  <input
                    type="number"
                    min="0"
                    max={line.balance_kg}
                    step="0.001"
                    placeholder="Qty (kg)"
                    value={dispatchSelections[line.batch_line_id] ?? ''}
                    onChange={(e) => setDispatchSelections((prev) => ({ ...prev, [line.batch_line_id]: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Catatan (opsional)</span>
            <textarea
              value={dispatchNotes}
              onChange={(e) => setDispatchNotes(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder="Mis. nomor kendaraan, nama sopir"
            />
          </label>

          <button
            type="submit"
            disabled={dispatchSubmitting || !fromSiteId || !toSiteId || dispatchRows.length === 0}
            className="rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {dispatchSubmitting ? 'Mengirim...' : 'Kirim Handover'}
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-app-text">Menunggu Konfirmasi Terima</h2>
        {pendingError && (
          <AlertBanner variant="danger" title="Gagal memuat">
            {pendingError}
          </AlertBanner>
        )}
        {loadingPending && <p className="text-sm text-app-muted">Memuat...</p>}
        {!loadingPending && pending.length === 0 && (
          <p className="text-sm text-app-muted">Tidak ada handover yang menunggu konfirmasi.</p>
        )}
        <div className="space-y-4">
          {pending.map((h) => (
            <PendingHandoverCard key={h.id} handover={h} onConfirmed={loadPending} />
          ))}
        </div>
      </section>
    </div>
  );
}

function PendingHandoverCard({ handover, onConfirmed }: { handover: PendingHandover; onConfirmed: () => void }) {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [tanks, setTanks] = useState<Tank[]>([]);
  const [toTankId, setToTankId] = useState('');
  const [businessDate, setBusinessDate] = useState(todayLocalDate);
  const [qtyReceived, setQtyReceived] = useState<Record<string, string>>(
    Object.fromEntries(handover.handover_lines.map((l) => [l.id, String(l.qty_kg)])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  useEffect(() => {
    async function loadTanks() {
      const { data } = await supabase.from('tanks').select('id, site_id, name').eq('site_id', handover.to_site_id).order('name');
      setTanks((data as Tank[]) ?? []);
    }
    loadTanks();
  }, [handover.to_site_id]);

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    if (submitting || !toTankId) return;

    const lines = handover.handover_lines.map((l) => ({
      handover_line_id: l.id,
      qty_kg_received: Number(qtyReceived[l.id] || 0),
    }));

    const invalid = lines.find((l) => l.qty_kg_received <= 0);
    if (invalid) {
      setFeedback({ variant: 'danger', message: 'Qty diterima harus lebih dari 0 untuk semua baris.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.rpc('confirm_handover_receipt', {
      p_handover_id: handover.id,
      p_to_tank_id: toTankId,
      p_business_date: businessDate,
      p_lines: lines,
    });

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    onConfirmed();
  }

  async function handleCancel() {
    if (!cancelReason.trim() || cancelSubmitting) return;
    setCancelSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.rpc('cancel_handover_dispatch', {
      p_handover_id: handover.id,
      p_reason: cancelReason.trim(),
    });

    setCancelSubmitting(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    onConfirmed();
  }

  return (
    <form onSubmit={handleConfirm} className="space-y-3 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-app-text">
          {handover.from_site?.name ?? '-'} &rarr; {handover.to_site?.name ?? '-'}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-app-muted">{new Date(handover.handed_over_at).toLocaleString('id-ID')}</p>
          {isOwner && !cancelling && (
            <button
              type="button"
              onClick={() => {
                setCancelling(true);
                setCancelReason('');
                setFeedback(null);
              }}
              className="rounded px-2 py-1 text-xs font-medium text-app-danger hover:bg-app-danger/10"
            >
              Batalkan
            </button>
          )}
        </div>
      </div>
      {handover.notes && <p className="text-xs text-app-muted">Catatan: {handover.notes}</p>}

      {cancelling && (
        <div className="space-y-2 rounded-md border border-app-danger/40 bg-app-danger/5 p-3">
          <p className="text-xs text-app-muted">
            Membatalkan mengembalikan stok sepenuhnya ke site asal (via reversal). Tidak bisa dibatalkan kalau sudah
            dikonfirmasi.
          </p>
          <input
            type="text"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Alasan pembatalan (wajib)"
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!cancelReason.trim() || cancelSubmitting}
              className="rounded-md bg-app-danger px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {cancelSubmitting ? 'Membatalkan...' : 'Konfirmasi Batalkan'}
            </button>
            <button
              type="button"
              onClick={() => setCancelling(false)}
              className="rounded-md border border-app-border px-3 py-1.5 text-xs text-app-muted hover:bg-app-soft"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal'}>
          {feedback.message}
        </AlertBanner>
      )}

      <div className="space-y-2">
        {handover.handover_lines.map((l) => (
          <div key={l.id} className="grid grid-cols-1 gap-2 rounded-md border border-app-border p-3 sm:grid-cols-[2fr_1fr_1fr]">
            <div>
              <p className="text-sm font-medium text-app-text">{l.batch_line?.receiving_lot?.product?.name ?? '-'}</p>
              <p className="text-xs text-app-muted">dari tank {l.batch_line?.batch?.tank?.name ?? '-'}</p>
            </div>
            <div className="text-sm text-app-text">{formatKg(l.qty_kg)} dikirim</div>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Qty Diterima (kg)</span>
              <input
                type="number"
                min="0"
                max={l.qty_kg}
                step="0.001"
                value={qtyReceived[l.id] ?? ''}
                onChange={(e) => setQtyReceived((prev) => ({ ...prev, [l.id]: e.target.value }))}
                className={inputClass}
              />
            </label>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Tank Tujuan *</span>
          <select value={toTankId} onChange={(e) => setToTankId(e.target.value)} className={inputClass}>
            <option value="">Pilih tank</option>
            {tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Tanggal Terima</span>
          <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} className={inputClass} />
        </label>
      </div>

      <button
        type="submit"
        disabled={submitting || !toTankId}
        className="rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {submitting ? 'Menyimpan...' : 'Konfirmasi Terima'}
      </button>
    </form>
  );
}
