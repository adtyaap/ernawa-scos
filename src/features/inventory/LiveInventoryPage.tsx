import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Download, HeartPulse, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { KPICard } from '../../components/shared/KPICard';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency, formatKg, todayLocalDate } from '../../lib/format';
import { downloadCsv } from '../../lib/exportCsv';
import type { LiveInventoryRow, Track } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none';

function formatAge(ageHours: number | null): string {
  if (ageHours === null) return '-';
  if (ageHours < 24) return `${Math.round(ageHours)} jam`;
  return `${Math.round(ageHours / 24)} hari`;
}

// Live Inventory (migration 0050, get_live_inventory): stok per batch lintas
// site yang bisa diakses, dgn persamaan persediaan Masuk - Terkirim -
// Mortalitas - Susut/Reject - Transfer + Koreksi = Sisa. Semua dari ledger saat
// query (aturan #2). KPI SELALU per track yang dipilih (aturan #1) — tidak ada
// angka gabungan trading+budidaya.
export function LiveInventoryPage() {
  const [rows, setRows] = useState<LiveInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [track, setTrack] = useState<Track>('trading');
  const [siteId, setSiteId] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.rpc('get_live_inventory').then(({ data, error }) => {
      if (error) setLoadError(error.message);
      else setRows((data as LiveInventoryRow[]) ?? []);
      setLoading(false);
    });
  }, []);

  const trackRows = useMemo(() => rows.filter((r) => r.track === track), [rows, track]);
  const sites = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of trackRows) map.set(r.site_id, r.site_name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [trackRows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trackRows.filter(
      (r) =>
        (!siteId || r.site_id === siteId) &&
        (!q || r.product_name.toLowerCase().includes(q) || (r.supplier_name ?? '').toLowerCase().includes(q)),
    );
  }, [trackRows, siteId, search]);

  const totals = useMemo(
    () => ({
      kg: visible.reduce((s, r) => s + r.balance_kg, 0),
      value: visible.reduce((s, r) => s + r.stock_value, 0),
      overdue: visible.filter((r) => r.is_overdue).length,
      mortalityKg: visible.reduce((s, r) => s + r.mortality_kg, 0),
      mortalityValue: visible.reduce((s, r) => s + r.mortality_kg * r.buy_price_per_kg, 0),
    }),
    [visible],
  );

  function handleExport() {
    downloadCsv(`live-inventory-${track}-${todayLocalDate()}.csv`, visible, [
      { header: 'Site', value: (r) => r.site_name },
      { header: 'Tank', value: (r) => r.tank_name },
      { header: 'Produk', value: (r) => r.product_name },
      { header: 'Pemasok', value: (r) => r.supplier_name ?? (r.from_handover ? 'Serah Terima' : '') },
      { header: 'Diterima', value: (r) => r.received_at },
      { header: 'Masuk (kg)', value: (r) => r.in_kg },
      { header: 'Terkirim (kg)', value: (r) => r.delivered_kg },
      { header: 'Mortalitas (kg)', value: (r) => r.mortality_kg },
      { header: 'Susut/Reject (kg)', value: (r) => r.shrink_kg },
      { header: 'Transfer Keluar (kg)', value: (r) => r.transfer_out_kg },
      { header: 'Koreksi (kg)', value: (r) => r.correction_kg },
      { header: 'Sisa (kg)', value: (r) => r.balance_kg },
      { header: 'Harga Beli/kg', value: (r) => r.buy_price_per_kg },
      { header: 'Nilai (Rp)', value: (r) => r.stock_value },
    ]);
  }

  const columns: DataTableColumn<LiveInventoryRow>[] = [
    {
      key: 'batch',
      header: 'Batch',
      render: (r) => (
        <div className="min-w-[220px]">
          <p className="font-medium">{r.product_name}</p>
          <p className="text-xs text-app-muted">
            {r.site_name} · {r.tank_name} · {r.supplier_name ?? (r.from_handover ? 'Serah Terima' : '-')} · umur{' '}
            {formatAge(r.age_hours)}
          </p>
        </div>
      ),
    },
    { key: 'in', header: 'Masuk', render: (r) => <span className="whitespace-nowrap">{formatKg(r.in_kg)}</span> },
    { key: 'out', header: 'Terkirim', render: (r) => <span className="whitespace-nowrap">{formatKg(r.delivered_kg)}</span> },
    { key: 'mort', header: 'Mortalitas', render: (r) => <span className="whitespace-nowrap">{r.mortality_kg ? formatKg(r.mortality_kg) : '-'}</span> },
    { key: 'shrink', header: 'Susut/Reject', render: (r) => <span className="whitespace-nowrap">{r.shrink_kg ? formatKg(r.shrink_kg) : '-'}</span> },
    { key: 'transfer', header: 'Transfer', render: (r) => <span className="whitespace-nowrap">{r.transfer_out_kg ? formatKg(r.transfer_out_kg) : '-'}</span> },
    { key: 'corr', header: 'Koreksi', render: (r) => <span className="whitespace-nowrap">{r.correction_kg ? formatKg(r.correction_kg) : '-'}</span> },
    { key: 'balance', header: 'Sisa', render: (r) => <span className="whitespace-nowrap font-semibold">{formatKg(r.balance_kg)}</span> },
    {
      key: 'value',
      header: 'Nilai',
      render: (r) => (
        <div className="whitespace-nowrap">
          <p>{formatCurrency(r.stock_value)}</p>
          <p className="text-xs text-app-muted">@ {formatCurrency(r.buy_price_per_kg)}/kg</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.is_overdue ? (
          <StatusBadge label="Lewat ambang" tone="danger" />
        ) : r.max_holding_hours === null ? (
          <StatusBadge label="Tanpa ambang" tone="neutral" />
        ) : (
          <StatusBadge label="Aman" tone="success" />
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Live Inventory</h1>
          <p className="text-sm text-app-muted">
            Stok per batch dari ledger: Masuk − Terkirim − Mortalitas − Susut/Reject − Transfer + Koreksi = Sisa.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={visible.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-xs font-medium text-app-muted hover:bg-app-soft disabled:opacity-40"
        >
          <Download size={14} /> Unduh CSV
        </button>
      </div>

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat stok">
          {loadError}
        </AlertBanner>
      )}

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-app-border bg-app-panel p-4 shadow-sm sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Track</span>
          <select
            value={track}
            onChange={(e) => {
              setTrack(e.target.value as Track);
              setSiteId('');
            }}
            className={inputClass}
          >
            <option value="trading">Trading</option>
            <option value="budidaya">Budidaya</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Site</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass}>
            <option value="">Semua site</option>
            {sites.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Cari produk / pemasok</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} placeholder="Mis. BAMBU" />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard icon={Boxes} label="Stok Aktif" value={formatKg(totals.kg)} note={`${visible.length} batch`} />
        <KPICard icon={Wallet} label="Nilai Stok" value={formatCurrency(totals.value)} note="Sisa × harga beli batch" />
        <KPICard
          icon={AlertTriangle}
          label="Lewat Ambang Holding"
          value={String(totals.overdue)}
          note="Ambang diatur di Admin > Pengaturan Ambang"
        />
        <KPICard
          icon={HeartPulse}
          label="Mortalitas (batch aktif)"
          value={formatKg(totals.mortalityKg)}
          note={`${formatCurrency(totals.mortalityValue)} nilai hilang`}
        />
      </div>

      <DataTable
        columns={columns}
        rows={visible}
        getRowId={(r) => r.batch_line_id}
        emptyLabel={loading ? 'Memuat...' : `Tidak ada stok aktif di track ${track === 'trading' ? 'Trading' : 'Budidaya'}.`}
      />
    </div>
  );
}
