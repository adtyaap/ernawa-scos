import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatKg, formatNumber } from '../../lib/format';
import type { AvailableBatchLine, MortalityRateRow, Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

type LossKind = 'mortality' | 'shrinkage' | 'reject';

const KIND_LABEL: Record<LossKind, string> = {
  mortality: 'Mortalitas',
  shrinkage: 'Penyusutan',
  reject: 'Reject',
};

interface MortalityDraft {
  qty: string;
  cause: string;
  kind: LossKind;
}

const EMPTY_DRAFT: MortalityDraft = { qty: '', cause: '', kind: 'mortality' };

interface AdjustmentHistoryRow {
  id: string;
  event_at: string;
  qty_kg: number;
  kind: 'shrinkage' | 'reject';
  reason: string;
  inventory_ledger_id: string | null;
  batch_line: {
    batch: { site_id: string; tank: { name: string } | null } | null;
    lot: { product: { name: string } | null } | null;
  } | null;
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

const HISTORY_PAGE = 20;

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Stok dibaca dari RPC get_available_batch_lines (migration 0008): saldo
// SELALU SUM(inventory_ledger) saat query, bukan angka tersimpan (CLAUDE.md
// #2), dan parameter site wajib — jadi stok tidak pernah tercampur antar
// site/track (CLAUDE.md #1). Total ditampilkan per produk DI DALAM satu site,
// tidak pernah dijumlahkan lintas site.
//
// Mortalitas = insert ke mortality_events; penyusutan/reject = insert ke
// stock_adjustments (migration 0021, alasan WAJIB). Trigger DB membuat baris
// ledger negatif otomatis (append-only, tidak ada UPDATE stok). Guard saldo ada
// di DB (0014/0021), pengecekan di sini cuma supaya pesan lebih cepat.
export function StokMortalitasPage() {
  const { session } = useAuth();

  const [sites, setSites] = useState<Site[]>([]);
  const [mortalityRate, setMortalityRate] = useState<MortalityRateRow | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [lines, setLines] = useState<AvailableBatchLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [history, setHistory] = useState<MortalityHistoryRow[]>([]);
  const [adjustmentHistory, setAdjustmentHistory] = useState<AdjustmentHistoryRow[]>([]);
  const [reversedLedgerIds, setReversedLedgerIds] = useState<Set<string>>(new Set());
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);

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

  // Filter site dilakukan di server (inner join), bukan disaring di browser
  // dari N baris global — supaya riwayat site yang sepi tidak hilang hanya
  // karena site lain lebih ramai.
  async function loadSite(siteId: string, limit: number = historyLimit) {
    if (!siteId) {
      setLines([]);
      setHistory([]);
      return;
    }
    setLoadingLines(true);
    setLinesError(null);

    const [{ data, error }, { data: historyData }, { data: adjustmentData }] = await Promise.all([
      supabase.rpc('get_available_batch_lines', { p_site_id: siteId }),
      supabase
        .from('mortality_events')
        .select(
          'id, event_at, qty_kg, cause, inventory_ledger_id, batch_line:batch_lines!inner(batch:batches!inner(site_id, tank:tanks(name)), lot:receiving_lots(product:products(name)))',
        )
        .eq('batch_line.batch.site_id', siteId)
        .order('event_at', { ascending: false })
        .limit(limit),
      supabase
        .from('stock_adjustments')
        .select(
          'id, event_at, qty_kg, kind, reason, inventory_ledger_id, batch_line:batch_lines!inner(batch:batches!inner(site_id, tank:tanks(name)), lot:receiving_lots(product:products(name)))',
        )
        .eq('batch_line.batch.site_id', siteId)
        .order('event_at', { ascending: false })
        .limit(limit),
    ]);

    if (error) {
      setLinesError(error.message);
      setLines([]);
    } else {
      setLines((data as AvailableBatchLine[]) ?? []);
    }

    const siteHistory = (historyData as unknown as MortalityHistoryRow[]) ?? [];
    setHistory(siteHistory);

    const siteAdjustments = (adjustmentData as unknown as AdjustmentHistoryRow[]) ?? [];
    setAdjustmentHistory(siteAdjustments);

    const ledgerIds = [...siteHistory, ...siteAdjustments]
      .map((row) => row.inventory_ledger_id)
      .filter((id): id is string => Boolean(id));
    if (ledgerIds.length > 0) {
      const { data: reversalData } = await supabase.from('inventory_ledger').select('reversal_of').in('reversal_of', ledgerIds);
      setReversedLedgerIds(new Set(((reversalData as { reversal_of: string }[] | null) ?? []).map((r) => r.reversal_of)));
    } else {
      setReversedLedgerIds(new Set());
    }
    setLoadingLines(false);
  }

  async function loadMortalityRate(siteId: string) {
    if (!siteId) {
      setMortalityRate(null);
      return;
    }
    const { data } = await supabase.rpc('get_mortality_rates', { p_days: 30 });
    const row = ((data as MortalityRateRow[] | null) ?? []).find((r) => r.site_id === siteId) ?? null;
    setMortalityRate(row);
  }

  useEffect(() => {
    setDrafts({});
    setFeedback(null);
    setHistoryLimit(HISTORY_PAGE);
    loadSite(selectedSiteId, HISTORY_PAGE);
    loadMortalityRate(selectedSiteId);
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
    setDrafts((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? EMPTY_DRAFT), ...patch } }));
  }

  async function handleRecord(line: AvailableBatchLine) {
    const draft = drafts[line.batch_line_id] ?? EMPTY_DRAFT;
    const qty = Number(draft.qty ?? 0);
    const label = KIND_LABEL[draft.kind];

    if (!(qty > 0)) {
      setFeedback({ variant: 'danger', message: `Qty ${label.toLowerCase()} harus lebih dari 0.` });
      return;
    }
    if (qty > line.balance_kg) {
      setFeedback({
        variant: 'danger',
        message: `Qty ${label.toLowerCase()} melebihi saldo ${line.product_name} (${line.tank_name}): ${formatKg(line.balance_kg)}.`,
      });
      return;
    }
    if (draft.kind !== 'mortality' && !draft.cause.trim()) {
      setFeedback({ variant: 'danger', message: `Alasan wajib diisi untuk ${label.toLowerCase()}.` });
      return;
    }
    if (!session?.user.id || submittingId) return;

    setSubmittingId(line.batch_line_id);
    setFeedback(null);

    const now = new Date().toISOString();
    const { error } =
      draft.kind === 'mortality'
        ? await supabase.from('mortality_events').insert({
            batch_line_id: line.batch_line_id,
            event_at: now,
            qty_kg: qty,
            cause: draft.cause.trim() || null,
            recorded_by: session.user.id,
            client_id: crypto.randomUUID(),
          })
        : await supabase.from('stock_adjustments').insert({
            batch_line_id: line.batch_line_id,
            kind: draft.kind,
            event_at: now,
            qty_kg: qty,
            reason: draft.cause.trim(),
            recorded_by: session.user.id,
            client_id: crypto.randomUUID(),
          });

    setSubmittingId(null);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: `${label} ${formatKg(qty)} untuk ${line.product_name} berhasil dicatat.` });
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

  const adjustmentColumns: DataTableColumn<AdjustmentHistoryRow>[] = [
    { key: 'event_at', header: 'Waktu', render: (row) => formatDateTime(row.event_at) },
    { key: 'kind', header: 'Jenis', render: (row) => KIND_LABEL[row.kind] },
    { key: 'product', header: 'Produk', render: (row) => row.batch_line?.lot?.product?.name ?? '-' },
    { key: 'tank', header: 'Tank', render: (row) => row.batch_line?.batch?.tank?.name ?? '-' },
    { key: 'qty_kg', header: 'Qty', render: (row) => formatKg(row.qty_kg) },
    { key: 'reason', header: 'Alasan' },
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
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Stok &amp; Mortalitas</h1>
        <p className="text-sm text-app-muted">
          Stok per site (dihitung dari ledger) dan pencatatan mortalitas, penyusutan, dan reject. Koreksi dilakukan
          lewat baris baru, bukan mengubah stok.
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

        {selectedSiteId && (
          <div className="space-y-2 rounded-md border border-app-border p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-app-muted">
              Tingkat Mortalitas (30 Hari Terakhir)
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-app-text">
                {mortalityRate && mortalityRate.mortality_pct !== null
                  ? `${formatNumber(Math.round(mortalityRate.mortality_pct * 10) / 10)}%`
                  : 'Belum ada data penerimaan 30 hari terakhir'}
              </span>
              {mortalityRate?.threshold_pct != null ? (
                <span className={mortalityRate.is_overdue ? 'text-app-danger' : 'text-app-muted'}>
                  Ambang: {formatNumber(mortalityRate.threshold_pct)}%{mortalityRate.is_overdue ? ' — di atas ambang' : ''}
                </span>
              ) : (
                <span className="text-app-muted">Ambang belum diatur — atur di Admin &gt; Pengaturan Ambang</span>
              )}
            </div>
          </div>
        )}

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
            const draft = drafts[line.batch_line_id] ?? EMPTY_DRAFT;
            return (
              <div
                key={line.batch_line_id}
                className="grid grid-cols-1 gap-2 rounded-md border border-app-border p-3 sm:grid-cols-[2fr_1fr_1.2fr_1fr_2fr_auto]"
              >
                <div>
                  <p className="text-sm font-medium text-app-text">{line.product_name}</p>
                  <p className="text-xs text-app-muted">{line.tank_name}</p>
                </div>
                <div className="text-sm text-app-text">{formatKg(line.balance_kg)}</div>
                <select
                  value={draft.kind}
                  onChange={(e) => updateDraft(line.batch_line_id, { kind: e.target.value as LossKind })}
                  className={inputClass}
                  aria-label="Jenis pengurangan stok"
                >
                  {(Object.keys(KIND_LABEL) as LossKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  max={line.balance_kg}
                  step="0.001"
                  placeholder="Qty (kg)"
                  value={draft.qty}
                  onChange={(e) => updateDraft(line.batch_line_id, { qty: e.target.value })}
                  className={inputClass}
                />
                <input
                  type="text"
                  placeholder={draft.kind === 'mortality' ? 'Penyebab (opsional)' : 'Alasan (wajib)'}
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
                  {submittingId === line.batch_line_id ? 'Menyimpan...' : `Catat ${KIND_LABEL[draft.kind]}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {selectedSiteId && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-app-text">Riwayat Mortalitas (terbaru di site ini)</h2>
          <DataTable columns={historyColumns} rows={history} getRowId={(row) => row.id} emptyLabel="Belum ada mortalitas." />

          <h2 className="pt-2 text-sm font-semibold text-app-text">Riwayat Penyusutan &amp; Reject (terbaru di site ini)</h2>
          <DataTable
            columns={adjustmentColumns}
            rows={adjustmentHistory}
            getRowId={(row) => row.id}
            emptyLabel="Belum ada penyusutan atau reject."
          />
          {(history.length >= historyLimit || adjustmentHistory.length >= historyLimit) && (
            <button
              type="button"
              onClick={() => {
                const next = historyLimit + HISTORY_PAGE;
                setHistoryLimit(next);
                loadSite(selectedSiteId, next);
              }}
              className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-muted hover:bg-white/5"
            >
              Muat lebih banyak
            </button>
          )}
        </div>
      )}
    </div>
  );
}
