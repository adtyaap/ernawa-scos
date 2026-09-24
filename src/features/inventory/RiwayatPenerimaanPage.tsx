import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency, formatKg, todayLocalDate } from '../../lib/format';
import { downloadCsv } from '../../lib/exportCsv';
import type { Site, Track } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface ReceivingRow {
  id: string;
  transaction_date: string;
  created_at: string;
  supplier: { name: string } | null;
  site: { name: string; type: Track } | null;
  creator: { full_name: string } | null;
  lots: { id: string; qty_kg: number; buy_price_per_kg: number; product: { name: string } | null }[];
}

// Total hanya menghitung lot yang MASIH berlaku: lot yang penerimaannya sudah
// direversal lewat Koreksi Ledger tidak boleh ikut menggelembungkan total.
function rowTotals(row: ReceivingRow, reversedLotIds: Set<string>) {
  const active = row.lots.filter((lot) => !reversedLotIds.has(lot.id));
  return {
    kg: active.reduce((sum, lot) => sum + Number(lot.qty_kg), 0),
    value: active.reduce((sum, lot) => sum + Number(lot.qty_kg) * Number(lot.buy_price_per_kg), 0),
    activeCount: active.length,
  };
}

const PAGE_SIZE = 50;

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

// Riwayat penerimaan (receiving_transactions + lots). Total nilai dan kg
// dijumlahkan PER TRACK saja — tidak pernah digabung lintas track
// (CLAUDE.md #1), walaupun filter site dikosongkan.
export function RiwayatPenerimaanPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [rows, setRows] = useState<ReceivingRow[]>([]);
  const [reversedLotIds, setReversedLotIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('sites')
      .select('id, name, type')
      .order('name')
      .then(({ data }) => setSites((data as Site[]) ?? []));
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('receiving_transactions')
        .select(
          'id, transaction_date, created_at, supplier:suppliers(name), site:sites(name, type), creator:users!receiving_transactions_created_by_fkey(full_name), lots:receiving_lots(id, qty_kg, buy_price_per_kg, product:products(name))',
        )
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);

      if (siteId) query = query.eq('site_id', siteId);
      if (dateFrom) query = query.gte('transaction_date', dateFrom);
      if (dateTo) query = query.lte('transaction_date', dateTo);

      const { data, error: queryError } = await query;
      if (!active) return;

      if (queryError) {
        setError(queryError.message);
        setRows([]);
        setReversedLotIds(new Set());
        setLoading(false);
        return;
      }

      const loaded = (data as unknown as ReceivingRow[]) ?? [];
      const lotIds = loaded.flatMap((row) => row.lots.map((lot) => lot.id));
      const reversed = new Set<string>();

      if (lotIds.length > 0) {
        const { data: lineData } = await supabase.from('batch_lines').select('id, receiving_lot_id').in('receiving_lot_id', lotIds);
        const lines = (lineData as { id: string; receiving_lot_id: string }[] | null) ?? [];

        if (lines.length > 0) {
          const { data: ledgerData } = await supabase
            .from('inventory_ledger')
            .select('id, batch_line_id, movement_type, reversal_of')
            .in('batch_line_id', lines.map((line) => line.id));
          const ledger =
            (ledgerData as { id: string; batch_line_id: string; movement_type: string; reversal_of: string | null }[] | null) ?? [];

          const reversedOriginalIds = new Set(ledger.filter((l) => l.reversal_of).map((l) => l.reversal_of as string));
          const reversedLineIds = new Set(
            ledger.filter((l) => l.movement_type === 'receive' && reversedOriginalIds.has(l.id)).map((l) => l.batch_line_id),
          );
          for (const line of lines) {
            if (reversedLineIds.has(line.id)) reversed.add(line.receiving_lot_id);
          }
        }
      }

      if (!active) return;
      setRows(loaded);
      setReversedLotIds(reversed);
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [siteId, dateFrom, dateTo, limit]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [siteId, dateFrom, dateTo]);

  const perTrack: Record<Track, { count: number; kg: number; value: number }> = {
    trading: { count: 0, kg: 0, value: 0 },
    budidaya: { count: 0, kg: 0, value: 0 },
  };
  for (const row of rows) {
    if (!row.site) continue;
    const totals = rowTotals(row, reversedLotIds);
    if (totals.activeCount === 0) continue;
    const bucket = perTrack[row.site.type];
    bucket.count += 1;
    bucket.kg += totals.kg;
    bucket.value += totals.value;
  }

  function handleExport() {
    const flat = rows.flatMap((row) =>
      row.lots.map((lot) => ({
        tanggal: row.transaction_date,
        site: row.site?.name ?? '-',
        track: row.site?.type ?? '-',
        supplier: row.supplier?.name ?? '-',
        produk: lot.product?.name ?? '-',
        qty_kg: Number(lot.qty_kg),
        harga_per_kg: Number(lot.buy_price_per_kg),
        nilai: Number(lot.qty_kg) * Number(lot.buy_price_per_kg),
        status: reversedLotIds.has(lot.id) ? 'Dikoreksi' : 'Berlaku',
        dicatat_oleh: row.creator?.full_name ?? '-',
      })),
    );
    downloadCsv(`riwayat-penerimaan-${todayLocalDate()}.csv`, flat, [
      { header: 'Tanggal', value: (r) => r.tanggal },
      { header: 'Site', value: (r) => r.site },
      { header: 'Track', value: (r) => r.track },
      { header: 'Supplier', value: (r) => r.supplier },
      { header: 'Produk', value: (r) => r.produk },
      { header: 'Qty (kg)', value: (r) => r.qty_kg },
      { header: 'Harga/kg (Rp)', value: (r) => r.harga_per_kg },
      { header: 'Nilai (Rp)', value: (r) => r.nilai },
      { header: 'Status', value: (r) => r.status },
      { header: 'Dicatat oleh', value: (r) => r.dicatat_oleh },
    ]);
  }

  const columns: DataTableColumn<ReceivingRow>[] = [
    { key: 'transaction_date', header: 'Tanggal Terima', render: (row) => formatDate(row.transaction_date) },
    {
      key: 'site',
      header: 'Site',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <span>{row.site?.name ?? '-'}</span>
          {row.site && (
            <StatusBadge
              label={row.site.type === 'trading' ? 'Trading' : 'Budidaya'}
              tone={row.site.type === 'trading' ? 'info' : 'success'}
            />
          )}
        </div>
      ),
    },
    { key: 'supplier', header: 'Supplier', render: (row) => row.supplier?.name ?? '-' },
    {
      key: 'lots',
      header: 'Produk',
      render: (row) => (
        <ul className="space-y-0.5 text-xs">
          {row.lots.map((lot) => (
            <li key={lot.id} className={reversedLotIds.has(lot.id) ? 'text-app-muted line-through' : undefined}>
              {lot.product?.name ?? '-'} · {formatKg(Number(lot.qty_kg))} · {formatCurrency(Number(lot.buy_price_per_kg))}/kg
            </li>
          ))}
        </ul>
      ),
    },
    { key: 'kg', header: 'Total Qty', render: (row) => formatKg(rowTotals(row, reversedLotIds).kg) },
    { key: 'value', header: 'Total Nilai', render: (row) => formatCurrency(rowTotals(row, reversedLotIds).value) },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const reversedCount = row.lots.filter((lot) => reversedLotIds.has(lot.id)).length;
        if (reversedCount === 0) return <StatusBadge label="Berlaku" tone="success" />;
        if (reversedCount === row.lots.length) return <StatusBadge label="Dikoreksi" tone="danger" />;
        return <StatusBadge label="Sebagian dikoreksi" tone="warning" />;
      },
    },
    { key: 'creator', header: 'Dicatat oleh', render: (row) => row.creator?.full_name ?? '-' },
  ];

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Riwayat Penerimaan</h1>
          <p className="text-sm text-app-muted">Daftar penerimaan dari supplier, terbaru di atas.</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={rows.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-xs font-medium text-app-muted hover:bg-app-soft disabled:opacity-40"
        >
          <Download size={14} /> Unduh CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-app-border bg-app-panel shadow-sm p-4 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Site</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass}>
            <option value="">Semua site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.type})
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Dari tanggal</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Sampai tanggal</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
        </label>
      </div>

      {error && (
        <AlertBanner variant="danger" title="Gagal memuat riwayat">
          {error}
        </AlertBanner>
      )}

      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['trading', 'budidaya'] as Track[]).map((track) => (
            <div key={track} className="rounded-lg border border-app-border bg-app-panel shadow-sm p-3 text-sm">
              <StatusBadge label={track === 'trading' ? 'Trading' : 'Budidaya'} tone={track === 'trading' ? 'info' : 'success'} />
              <p className="mt-2 text-app-text">
                {perTrack[track].count === 0
                  ? 'Tidak ada transaksi'
                  : `${perTrack[track].count} transaksi · ${formatKg(perTrack[track].kg)} · ${formatCurrency(perTrack[track].value)}`}
              </p>
            </div>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyLabel={loading ? 'Memuat...' : 'Tidak ada penerimaan untuk filter ini.'}
      />

      {rows.length >= limit && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setLimit(limit + PAGE_SIZE)}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-muted hover:bg-app-soft"
          >
            Muat lebih banyak
          </button>
          <span className="text-xs text-app-muted">
            Ringkasan per track hanya menghitung {rows.length} transaksi yang sudah dimuat.
          </span>
        </div>
      )}
    </div>
  );
}
