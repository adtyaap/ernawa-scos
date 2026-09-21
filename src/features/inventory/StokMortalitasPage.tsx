import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatKg } from '../../lib/format';
import type { AvailableBatchLine, Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface MortalityDraft {
  qty: string;
  cause: string;
}

interface MortalityHistoryRow {
  id: string;
  event_at: string;
  qty_kg: number;
  cause: string | null;
  inventory_ledger_id: string | null;
  batch_line: {
    batch: { site_id: string; tank: { name: string } | null } | null;
    lot: { product: { name: string } | null } | null;
  } | null;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Stok dibaca dari RPC get_available_batch_lines (migration 0008): saldo
// SELALU SUM(inventory_ledger) saat query, bukan angka tersimpan (CLAUDE.md
// #2), dan parameter site wajib — jadi stok tidak pernah tercampur antar
// site/track (CLAUDE.md #1). Total ditampilkan per produk DI DALAM satu site,
// tidak pernah dijumlahkan lintas site.
//
// Mortalitas = insert ke mortality_events; trigger DB membuat baris ledger
// negatif otomatis (append-only, tidak ada UPDATE stok). Guard saldo ada di
// DB (migration 0014), pengecekan di sini cuma supaya pesan lebih cepat.
export function StokMortalitasPage() {
  const { session } = useAuth();

  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [lines, setLines] = useState<AvailableBatchLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [history, setHistory] = useState<MortalityHistoryRow[]>([]);
  const [reversedLedgerIds, setReversedLedgerIds] = useState<Set<string>>(new Set());

  const [drafts, setDrafts] = useState<Record<string, MortalityDraft>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  useEffect(() => {
    supabase
      .from('sites')
      .select('id, name, type')
      .order('name')
      .then(({ data }) => setSites((data as Site[]) ?? []));
  }, []);

  async function loadSite(siteId: string) {
    if (!siteId) {
      setLines([]);
      setHistory([]);
      return;
    }
    setLoadingLines(true);
    setLinesError(null);

    const [{ data, error }, { data: historyData }] = await Promise.all([
      supabase.rpc('get_available_batch_lines', { p_site_id: siteId }),
      supabase
        .from('mortality_events')
        .select(
          'id, event_at, qty_kg, cause, inventory_ledger_id, batch_line:batch_lines(batch:batches(site_id, tank:tanks(name)), lot:receiving_lots(product:products(name)))',
        )
        .order('event_at', { ascending: false })
        .limit(50),
    ]);

    if (error) {
      setLinesError(error.message);
      setLines([]);
    } else {
      setLines((data as AvailableBatchLine[]) ?? []);
    }

    const allHistory = (historyData as unknown as MortalityHistoryRow[]) ?? [];
    const siteHistory = allHistory.filter((row) => row.batch_line?.batch?.site_id === siteId).slice(0, 20);
    setHistory(siteHistory);

    const ledgerIds = siteHistory.map((row) => row.inventory_ledger_id).filter((id): id is string => Boolean(id));
    if (ledgerIds.length > 0) {
      const { data: reversalData } = await supabase.from('inventory_ledger').select('reversal_of').in('reversal_of', ledgerIds);
      setReversedLedgerIds(new Set(((reversalData as { reversal_of: string }[] | null) ?? []).map((r) => r.reversal_of)));
    } else {
      setReversedLedgerIds(new Set());
    }
    setLoadingLines(false);
  }

  useEffect(() => {
    setDrafts({});
    setFeedback(null);
    loadSite(selectedSiteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId]);

  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  const totalsByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      totals.set(line.product_name, (totals.get(line.product_name) ?? 0) + line.balance_kg);
    }
    return [...totals.entries()];
  }, [lines]);

  function updateDraft(lineId: string, patch: Partial<MortalityDraft>) {
    setDrafts((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? { qty: '', cause: '' }), ...patch } }));
  }

  async function handleRecord(line: AvailableBatchLine) {
    const draft = drafts[line.batch_line_id];
    const qty = Number(draft?.qty ?? 0);

    if (!(qty > 0)) {
      setFeedback({ variant: 'danger', message: 'Qty mortalitas harus lebih dari 0.' });
      return;
    }
    if (qty > line.balance_kg) {
      setFeedback({
        variant: 'danger',
        message: `Qty mortalitas melebihi saldo ${line.product_name} (${line.tank_name}): ${formatKg(line.balance_kg)}.`,
      });
      return;
    }
    if (!session?.user.id || submittingId) return;

    setSubmittingId(line.batch_line_id);
    setFeedback(null);

    const { error } = await supabase.from('mortality_events').insert({
      batch_line_id: line.batch_line_id,
      event_at: new Date().toISOString(),
      qty_kg: qty,
      cause: draft?.cause.trim() || null,
      recorded_by: session.user.id,
      client_id: crypto.randomUUID(),
    });

    setSubmittingId(null);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: `Mortalitas ${formatKg(qty)} untuk ${line.product_name} berhasil dicatat.` });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[line.batch_line_id];
      return next;
    });
    await loadSite(selectedSiteId);
  }

  const historyColumns: DataTableColumn<MortalityHistoryRow>[] = [
    { key: 'event_at', header: 'Waktu', render: (row) => formatDateTime(row.event_at) },
    { key: 'product', header: 'Produk', render: (row) => row.batch_line?.lot?.product?.name ?? '-' },
    { key: 'tank', header: 'Tank', render: (row) => row.batch_line?.batch?.tank?.name ?? '-' },
    { key: 'qty_kg', header: 'Qty', render: (row) => formatKg(row.qty_kg) },
    { key: 'cause', header: 'Penyebab', render: (row) => row.cause ?? '-' },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.inventory_ledger_id && reversedLedgerIds.has(row.inventory_ledger_id) ? (
          <StatusBadge label="Dikoreksi" tone="danger" />
        ) : (
          <StatusBadge label="Berlaku" tone="success" />
        ),
    },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Stok &amp; Mortalitas</h1>
        <p className="text-sm text-app-muted">
          Stok per site (dihitung dari ledger) dan pencatatan mortalitas. Koreksi dilakukan lewat baris baru, bukan
          mengubah stok.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Perhatian'}>
          {feedback.message}
        </AlertBanner>
      )}

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel p-4">
        <label className="block max-w-sm space-y-1">
          <span className="text-xs font-medium text-app-muted">Site *</span>
          <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)} className={inputClass}>
            <option value="">Pilih site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.type})
              </option>
            ))}
          </select>
          {selectedSite && (
            <StatusBadge
              label={selectedSite.type === 'trading' ? 'Trading' : 'Budidaya'}
              tone={selectedSite.type === 'trading' ? 'info' : 'success'}
            />
          )}
        </label>

        {!selectedSiteId && <p className="text-sm text-app-muted">Pilih site dulu untuk melihat stok.</p>}
        {loadingLines && <p className="text-sm text-app-muted">Memuat stok...</p>}
        {linesError && (
          <AlertBanner variant="danger" title="Gagal memuat stok">
            {linesError}
          </AlertBanner>
        )}
        {selectedSiteId && !loadingLines && !linesError && lines.length === 0 && (
          <p className="text-sm text-app-muted">Tidak ada stok tersedia di site ini.</p>
        )}

        {totalsByProduct.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {totalsByProduct.map(([name, total]) => (
              <span key={name} className="rounded-md border border-app-border px-3 py-1 text-xs text-app-text">
                {name}: <strong>{formatKg(total)}</strong>
              </span>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {lines.map((line) => {
            const draft = drafts[line.batch_line_id] ?? { qty: '', cause: '' };
            return (
              <div
                key={line.batch_line_id}
                className="grid grid-cols-1 gap-2 rounded-md border border-app-border p-3 sm:grid-cols-[2fr_1fr_1fr_2fr_auto]"
              >
                <div>
                  <p className="text-sm font-medium text-app-text">{line.product_name}</p>
                  <p className="text-xs text-app-muted">{line.tank_name}</p>
                </div>
                <div className="text-sm text-app-text">{formatKg(line.balance_kg)}</div>
                <input
                  type="number"
                  min="0"
                  max={line.balance_kg}
                  step="0.001"
                  placeholder="Qty mati (kg)"
                  value={draft.qty}
                  onChange={(e) => updateDraft(line.batch_line_id, { qty: e.target.value })}
                  className={inputClass}
                />
                <input
                  type="text"
                  placeholder="Penyebab (opsional)"
                  value={draft.cause}
                  onChange={(e) => updateDraft(line.batch_line_id, { cause: e.target.value })}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => handleRecord(line)}
                  disabled={submittingId !== null || !draft.qty}
                  className="rounded-md bg-app-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
                >
                  {submittingId === line.batch_line_id ? 'Menyimpan...' : 'Catat Mortalitas'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {selectedSiteId && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-app-text">Riwayat Mortalitas (20 terakhir di site ini)</h2>
          <DataTable columns={historyColumns} rows={history} getRowId={(row) => row.id} emptyLabel="Belum ada mortalitas." />
        </div>
      )}
    </div>
  );
}
