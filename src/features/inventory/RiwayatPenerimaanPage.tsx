import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency, formatKg } from '../../lib/format';
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
  lots: { qty_kg: number; buy_price_per_kg: number; product: { name: string } | null }[];
}

function rowTotals(row: ReceivingRow) {
  return {
    kg: row.lots.reduce((sum, lot) => sum + Number(lot.qty_kg), 0),
    value: row.lots.reduce((sum, lot) => sum + Number(lot.qty_kg) * Number(lot.buy_price_per_kg), 0),
  };
}

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
  const [rows, setRows] = useState<ReceivingRow[]>([]);
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
          'id, transaction_date, created_at, supplier:suppliers(name), site:sites(name, type), creator:users!receiving_transactions_created_by_fkey(full_name), lots:receiving_lots(qty_kg, buy_price_per_kg, product:products(name))',
        )
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100);

      if (siteId) query = query.eq('site_id', siteId);
      if (dateFrom) query = query.gte('transaction_date', dateFrom);
      if (dateTo) query = query.lte('transaction_date', dateTo);

      const { data, error: queryError } = await query;
      if (!active) return;

      if (queryError) {
        setError(queryError.message);
        setRows([]);
      } else {
        setRows((data as unknown as ReceivingRow[]) ?? []);
      }
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [siteId, dateFrom, dateTo]);

  const perTrack: Record<Track, { count: number; kg: number; value: number }> = {
    trading: { count: 0, kg: 0, value: 0 },
    budidaya: { count: 0, kg: 0, value: 0 },
  };
  for (const row of rows) {
    if (!row.site) continue;
    const totals = rowTotals(row);
    const bucket = perTrack[row.site.type];
    bucket.count += 1;
    bucket.kg += totals.kg;
    bucket.value += totals.value;
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
          {row.lots.map((lot, index) => (
            <li key={index}>
              {lot.product?.name ?? '-'} · {formatKg(Number(lot.qty_kg))} · {formatCurrency(Number(lot.buy_price_per_kg))}/kg
            </li>
          ))}
        </ul>
      ),
    },
    { key: 'kg', header: 'Total Qty', render: (row) => formatKg(rowTotals(row).kg) },
    { key: 'value', header: 'Total Nilai', render: (row) => formatCurrency(rowTotals(row).value) },
    { key: 'creator', header: 'Dicatat oleh', render: (row) => row.creator?.full_name ?? '-' },
  ];

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Riwayat Penerimaan</h1>
        <p className="text-sm text-app-muted">Daftar penerimaan dari supplier. Menampilkan maksimal 100 transaksi terbaru.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-app-border bg-app-panel p-4 sm:grid-cols-3">
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
            <div key={track} className="rounded-lg border border-app-border bg-app-panel p-3 text-sm">
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
    </div>
  );
}
