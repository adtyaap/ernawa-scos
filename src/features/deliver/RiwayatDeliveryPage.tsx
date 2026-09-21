import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { StatusBadge, type BadgeTone } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency, formatKg, localDayEndISO, localDayStartISO } from '../../lib/format';
import type { Site, Track } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface SettlementInfo {
  mode: 'cod' | 'term';
  amount: number;
  settled_at: string | null;
}

interface DeliveryRow {
  id: string;
  created_at: string;
  planned_kg: number;
  actual_weight_kg: number | null;
  delivered_at: string | null;
  site: { name: string; type: Track } | null;
  demand: { customer: { name: string } | null; product: { name: string } | null } | null;
  allocations: { override_reason: string | null }[];
  settlements: SettlementInfo[] | SettlementInfo | null;
}

function firstSettlement(row: DeliveryRow): SettlementInfo | null {
  if (!row.settlements) return null;
  return Array.isArray(row.settlements) ? (row.settlements[0] ?? null) : row.settlements;
}

function statusOf(row: DeliveryRow): { label: string; tone: BadgeTone } {
  if (row.actual_weight_kg === null) return { label: 'Menunggu timbang', tone: 'warning' };
  const settlement = firstSettlement(row);
  if (!settlement) return { label: 'Menunggu settlement', tone: 'info' };
  if (settlement.settled_at) return { label: 'Lunas', tone: 'success' };
  return { label: settlement.mode === 'term' ? 'Piutang berjalan' : 'Belum lunas', tone: 'danger' };
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Riwayat delivery dari alokasi sampai settlement. Total kg dijumlahkan PER
// TRACK saja (CLAUDE.md #1). Nilai uang hanya ditampilkan per baris
// settlement; tidak ada total rupiah gabungan di halaman ini.
export function RiwayatDeliveryPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<DeliveryRow[]>([]);
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
        .from('deliveries')
        .select(
          'id, created_at, planned_kg, actual_weight_kg, delivered_at, site:sites(name, type), demand:demands(customer:customers(name), product:products(name)), allocations:delivery_allocations(override_reason), settlements(mode, amount, settled_at)',
        )
        .order('created_at', { ascending: false })
        .limit(100);

      if (siteId) query = query.eq('site_id', siteId);
      if (dateFrom) query = query.gte('created_at', localDayStartISO(dateFrom));
      if (dateTo) query = query.lte('created_at', localDayEndISO(dateTo));

      const { data, error: queryError } = await query;
      if (!active) return;

      if (queryError) {
        setError(queryError.message);
        setRows([]);
      } else {
        setRows((data as unknown as DeliveryRow[]) ?? []);
      }
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [siteId, dateFrom, dateTo]);

  const perTrack: Record<Track, { count: number; plannedKg: number; actualKg: number }> = {
    trading: { count: 0, plannedKg: 0, actualKg: 0 },
    budidaya: { count: 0, plannedKg: 0, actualKg: 0 },
  };
  for (const row of rows) {
    if (!row.site) continue;
    const bucket = perTrack[row.site.type];
    bucket.count += 1;
    bucket.plannedKg += Number(row.planned_kg);
    bucket.actualKg += Number(row.actual_weight_kg ?? 0);
  }

  const columns: DataTableColumn<DeliveryRow>[] = [
    { key: 'created_at', header: 'Dibuat', render: (row) => formatDateTime(row.created_at) },
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
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (row.demand ? `${row.demand.customer?.name ?? '-'} — ${row.demand.product?.name ?? '-'}` : 'Spot sale'),
    },
    { key: 'planned_kg', header: 'Rencana', render: (row) => formatKg(Number(row.planned_kg)) },
    {
      key: 'actual_weight_kg',
      header: 'Timbang Aktual',
      render: (row) => (row.actual_weight_kg === null ? '-' : formatKg(Number(row.actual_weight_kg))),
    },
    {
      key: 'settlement',
      header: 'Settlement',
      render: (row) => {
        const settlement = firstSettlement(row);
        return settlement ? `${settlement.mode === 'cod' ? 'COD' : 'Termin'} · ${formatCurrency(Number(settlement.amount))}` : '-';
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const status = statusOf(row);
        const hasOverride = row.allocations.some((a) => a.override_reason);
        return (
          <div className="flex flex-wrap gap-1">
            <StatusBadge label={status.label} tone={status.tone} />
            {hasOverride && <StatusBadge label="Override FEFO" tone="warning" />}
          </div>
        );
      },
    },
  ];

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Deliver &gt; Riwayat Delivery</h1>
        <p className="text-sm text-app-muted">
          Status setiap delivery dari alokasi sampai lunas. Menampilkan maksimal 100 delivery terbaru.
        </p>
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
                  ? 'Tidak ada delivery'
                  : `${perTrack[track].count} delivery · rencana ${formatKg(perTrack[track].plannedKg)} · aktual ${formatKg(perTrack[track].actualKg)}`}
              </p>
            </div>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyLabel={loading ? 'Memuat...' : 'Tidak ada delivery untuk filter ini.'}
      />
    </div>
  );
}
