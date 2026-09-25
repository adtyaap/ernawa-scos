import { useEffect, useMemo, useState } from 'react';
import { Coins, Percent, Receipt, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { KPICard } from '../../components/shared/KPICard';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency, formatNumber } from '../../lib/format';
import type { TradingDeliveryPnl, TradingMortalityCost } from '../../types/domain';

type TabKey = 'produk' | 'pelanggan' | 'segmen' | 'pemasok' | 'site' | 'order';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'produk', label: 'Per Produk' },
  { key: 'pelanggan', label: 'Per Pelanggan' },
  { key: 'segmen', label: 'Per Segmen' },
  { key: 'pemasok', label: 'Per Pemasok' },
  { key: 'site', label: 'Per Site' },
  { key: 'order', label: 'Per Order' },
];

const SEGMENT_LABEL: Record<string, string> = {
  restoran: 'Restoran',
  eksportir: 'Eksportir',
  lainnya: 'Lainnya',
  belum_diklasifikasi: 'Belum Diklasifikasi',
};

interface GroupRow {
  key: string;
  label: string;
  count: number;
  revenue: number;
  cogs: number;
  logistics: number;
  gp: number;
  mixed?: boolean;
}

function pct(value: number | null): string {
  return value === null ? '-' : `${formatNumber(Math.round(value * 10) / 10)}%`;
}

function group(rows: TradingDeliveryPnl[], keyOf: (r: TradingDeliveryPnl) => { key: string; label: string } | null): GroupRow[] {
  const map = new Map<string, GroupRow>();
  const mixed: GroupRow = { key: '__mixed', label: '', count: 0, revenue: 0, cogs: 0, logistics: 0, gp: 0, mixed: true };
  for (const r of rows) {
    const k = keyOf(r);
    const target = k ? map.get(k.key) ?? { key: k.key, label: k.label, count: 0, revenue: 0, cogs: 0, logistics: 0, gp: 0 } : mixed;
    target.count += 1;
    target.revenue += r.revenue;
    target.cogs += r.cogs;
    target.logistics += r.logistics_cost;
    target.gp += r.gross_profit;
    if (k) map.set(k.key, target);
  }
  const out = [...map.values()].sort((a, b) => b.gp - a.gp);
  if (mixed.count > 0) out.push(mixed);
  return out;
}

// Profitability Engine (migration 0048/0050): Revenue − (COGS + Logistik +
// Mortalitas) = Gross Profit, TRADING saja (aturan #1). Revenue per delivery
// satu angka settlement, jadi breakdown per Produk/Pemasok TIDAK memecah
// delivery campuran (>1 produk / >1 pemasok) — ditampilkan sbg baris
// "Campuran" terpisah (pola migration 0044, bukan prorata = mengarang harga).
// Mortalitas di site tidak bisa ditautkan ke satu delivery -> cuma di total.
export function ProfitabilityPage() {
  const { profile, profileLoading } = useAuth();
  const isInvestor = profile?.role === 'investor';

  const [rows, setRows] = useState<TradingDeliveryPnl[]>([]);
  const [mortality, setMortality] = useState<TradingMortalityCost | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('produk');

  useEffect(() => {
    if (profileLoading) return;
    async function load() {
      const [pnlRes, mortRes] = await Promise.all([
        isInvestor ? supabase.rpc('investor_trading_delivery_pnl') : supabase.from('v_trading_delivery_pnl').select('*'),
        isInvestor ? supabase.rpc('investor_trading_mortality_cost') : supabase.from('v_trading_mortality_cost').select('*'),
      ]);
      if (pnlRes.error || mortRes.error) {
        setLoadError((pnlRes.error ?? mortRes.error)?.message ?? 'Gagal memuat data.');
      } else {
        setRows((pnlRes.data as TradingDeliveryPnl[]) ?? []);
        setMortality(((mortRes.data as TradingMortalityCost[]) ?? [])[0] ?? null);
      }
      setLoading(false);
    }
    load();
  }, [profileLoading, isInvestor]);

  const totals = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const cogs = rows.reduce((s, r) => s + r.cogs, 0);
    const logistics = rows.reduce((s, r) => s + r.logistics_cost, 0);
    const mort = mortality?.mortality_cost ?? 0;
    const totalCost = cogs + logistics + mort;
    const gp = revenue - totalCost;
    return { revenue, cogs, logistics, mort, totalCost, gp, gm: revenue > 0 ? (gp / revenue) * 100 : null };
  }, [rows, mortality]);

  const grouped = useMemo(() => {
    switch (tab) {
      case 'produk':
        return group(rows, (r) => (r.n_products === 1 && r.sole_product_id ? { key: r.sole_product_id, label: r.sole_product_name ?? '-' } : null));
      case 'pemasok':
        return group(rows, (r) =>
          r.n_suppliers === 1
            ? { key: r.sole_supplier_id ?? 'serah_terima', label: r.sole_supplier_name ?? 'Asal Serah Terima' }
            : null,
        );
      case 'pelanggan':
        return group(rows, (r) => ({ key: r.customer_id, label: r.customer_name }));
      case 'segmen':
        return group(rows, (r) => ({ key: r.segment, label: SEGMENT_LABEL[r.segment] ?? r.segment }));
      case 'site':
        return group(rows, (r) => ({ key: r.site_id, label: r.site_name }));
      default:
        return [];
    }
  }, [rows, tab]);

  const groupColumns: DataTableColumn<GroupRow>[] = [
    {
      key: 'label',
      header: TABS.find((t) => t.key === tab)?.label.replace('Per ', '') ?? '',
      render: (g) =>
        g.mixed ? (
          <span className="text-app-muted">Campuran ({g.count} delivery, tidak dipecah)</span>
        ) : (
          <span className="font-medium">{g.label}</span>
        ),
    },
    { key: 'count', header: 'Delivery', render: (g) => formatNumber(g.count) },
    { key: 'revenue', header: 'Revenue', render: (g) => formatCurrency(g.revenue) },
    { key: 'cogs', header: 'COGS', render: (g) => formatCurrency(g.cogs) },
    { key: 'log', header: 'Logistik', render: (g) => formatCurrency(g.logistics) },
    {
      key: 'gp',
      header: 'Gross Profit',
      render: (g) => <span className={g.gp < 0 ? 'text-app-danger' : 'text-app-success'}>{formatCurrency(g.gp)}</span>,
    },
    { key: 'gm', header: 'GM%', render: (g) => pct(g.revenue > 0 ? (g.gp / g.revenue) * 100 : null) },
  ];

  const orderColumns: DataTableColumn<TradingDeliveryPnl>[] = [
    {
      key: 'date',
      header: 'Tanggal',
      render: (r) => (r.delivered_at ? new Date(r.delivered_at).toLocaleDateString('id-ID', { dateStyle: 'medium' }) : '-'),
    },
    { key: 'customer', header: 'Pelanggan', render: (r) => r.customer_name },
    { key: 'site', header: 'Site', render: (r) => r.site_name },
    { key: 'product', header: 'Produk', render: (r) => (r.n_products === 1 ? r.sole_product_name : `Campuran (${r.n_products} produk)`) },
    { key: 'revenue', header: 'Revenue', render: (r) => formatCurrency(r.revenue) },
    { key: 'cogs', header: 'COGS', render: (r) => formatCurrency(r.cogs) },
    { key: 'log', header: 'Logistik', render: (r) => formatCurrency(r.logistics_cost) },
    {
      key: 'gp',
      header: 'Gross Profit',
      render: (r) => <span className={r.gross_profit < 0 ? 'text-app-danger' : 'text-app-success'}>{formatCurrency(r.gross_profit)}</span>,
    },
    { key: 'gm', header: 'GM%', render: (r) => pct(r.revenue > 0 ? (r.gross_profit / r.revenue) * 100 : null) },
  ];

  const structure: [string, number, boolean?][] = [
    ['Revenue', totals.revenue],
    ['− Pembelian (COGS)', totals.cogs],
    ['− Logistik', totals.logistics],
    ['− Mortalitas di site', totals.mort],
    ['= Gross Profit', totals.gp, true],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Profitability</h1>
        <p className="text-sm text-app-muted">
          Revenue − (Pembelian + Logistik + Mortalitas) = Gross Profit, dianalisis per produk, pelanggan, segmen, pemasok,
          site, dan order. Track Trading saja.
        </p>
      </div>

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat data">
          {loadError}
        </AlertBanner>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard icon={Coins} label="Revenue" value={loading ? '…' : formatCurrency(totals.revenue)} note={`${rows.length} delivery`} />
        <KPICard icon={Receipt} label="Total Cost" value={loading ? '…' : formatCurrency(totals.totalCost)} note={`Termasuk mortalitas ${formatCurrency(totals.mort)}`} />
        <KPICard
          icon={TrendingUp}
          label="Gross Profit"
          value={loading ? '…' : formatCurrency(totals.gp)}
          deltaLabel={totals.gp < 0 ? 'Rugi' : undefined}
          deltaTone="negative"
        />
        <KPICard icon={Percent} label="Gross Margin" value={loading ? '…' : pct(totals.gm)} note="Setelah logistik & mortalitas" />
      </div>

      <div className="rounded-lg border border-app-border bg-app-panel p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-app-text">Struktur Biaya</h2>
        <dl className="space-y-1.5 text-sm">
          {structure.map(([label, value, strong]) => (
            <div key={label} className={`flex justify-between ${strong ? 'border-t border-app-border pt-1.5 font-semibold' : ''}`}>
              <dt className={strong ? 'text-app-text' : 'text-app-muted'}>{label}</dt>
              <dd className={`tabular-nums ${strong && value < 0 ? 'text-app-danger' : 'text-app-text'}`}>{formatCurrency(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-app-muted">
          Opex bulanan (gaji, sewa, dll.) tidak masuk sini — lihat EBITDA di halaman Finance. Mortalitas dinilai harga beli
          batch dan tidak bisa ditautkan ke satu order, jadi hanya muncul di total.
        </p>
      </div>

      <div className="space-y-3">
        <div className="inline-flex flex-wrap gap-1 rounded-md bg-app-soft p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                tab === t.key ? 'bg-app-panel font-semibold text-app-accent shadow-sm' : 'text-app-muted hover:text-app-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'order' ? (
          <DataTable columns={orderColumns} rows={rows} getRowId={(r) => r.delivery_id} emptyLabel={loading ? 'Memuat...' : 'Belum ada penjualan.'} />
        ) : (
          <DataTable columns={groupColumns} rows={grouped} getRowId={(g) => g.key} emptyLabel={loading ? 'Memuat...' : 'Belum ada penjualan.'} />
        )}
        {(tab === 'produk' || tab === 'pemasok') && (
          <p className="text-xs text-app-muted">
            Delivery berisi lebih dari satu {tab === 'produk' ? 'produk' : 'pemasok'} tidak dipecah (revenue tercatat satu
            angka per delivery) — dijumlahkan di baris "Campuran".
          </p>
        )}
      </div>

      <AlertBanner variant="info" title="Budidaya">
        Site budidaya belum beroperasi — belum ada penjualan yang bisa dihitung profitabilitasnya.
      </AlertBanner>
    </div>
  );
}
