import { useEffect, useMemo, useState } from 'react';
import { Landmark, RefreshCw, TrendingUp, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { KPICard } from '../../components/shared/KPICard';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency, formatNumber } from '../../lib/format';
import type { TradingDeliveryPnl, TradingFinanceSummary, TradingMortalityCost } from '../../types/domain';

interface Props {
  isInvestor: boolean;
  ccc: number | null;
  arTotal: number;
}

interface TopRow {
  key: string;
  label: string;
  revenue: number;
  gp: number;
}

interface MonthRow {
  month: string;
  count: number;
  revenue: number;
  cost: number;
  gp: number;
}

function pct(value: number | null): string {
  return value === null ? '-' : `${formatNumber(Math.round(value * 10) / 10)}%`;
}

function Bar({ label, value, total, hint }: { label: string; value: number; total: number; hint: string }) {
  const width = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-app-text">{label}</span>
        <span className="text-xs text-app-muted tabular-nums">{hint}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-app-soft-strong">
        <div className="h-full rounded-full bg-app-accent" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function topBy(rows: TradingDeliveryPnl[], keyOf: (r: TradingDeliveryPnl) => { key: string; label: string } | null): TopRow[] {
  const map = new Map<string, TopRow>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const t = map.get(k.key) ?? { key: k.key, label: k.label, revenue: 0, gp: 0 };
    t.revenue += r.revenue;
    t.gp += r.gross_profit;
    map.set(k.key, t);
  }
  return [...map.values()].sort((a, b) => b.gp - a.gp).slice(0, 5);
}

// Bagian "Finance Dashboard" level perusahaan (migration 0048-0050), khusus
// Owner & Investor: opex & utang pemasok adalah data kas perusahaan
// (company_cash_ledger SELECT owner-only sejak 0040). TRADING saja (aturan #1).
// EBITDA memakai opex NYATA dari Kas & Bank Perusahaan (bukan asumsi manual),
// sepanjang waktu — sama periodenya dgn Gross Profit.
export function FinanceOverviewPanel({ isInvestor, ccc, arTotal }: Props) {
  const [summary, setSummary] = useState<TradingFinanceSummary | null>(null);
  const [pnl, setPnl] = useState<TradingDeliveryPnl[]>([]);
  const [mortality, setMortality] = useState<TradingMortalityCost | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [sumRes, pnlRes, mortRes] = await Promise.all([
        supabase.rpc('get_trading_finance_summary'),
        isInvestor ? supabase.rpc('investor_trading_delivery_pnl') : supabase.from('v_trading_delivery_pnl').select('*'),
        isInvestor ? supabase.rpc('investor_trading_mortality_cost') : supabase.from('v_trading_mortality_cost').select('*'),
      ]);
      const err = sumRes.error ?? pnlRes.error ?? mortRes.error;
      if (err) {
        setLoadError(err.message);
        return;
      }
      setSummary(((sumRes.data as TradingFinanceSummary[]) ?? [])[0] ?? null);
      setPnl((pnlRes.data as TradingDeliveryPnl[]) ?? []);
      setMortality(((mortRes.data as TradingMortalityCost[]) ?? [])[0] ?? null);
    }
    load();
  }, [isInvestor]);

  const pl = useMemo(() => {
    const revenue = pnl.reduce((s, r) => s + r.revenue, 0);
    const cogs = pnl.reduce((s, r) => s + r.cogs, 0);
    const logistics = pnl.reduce((s, r) => s + r.logistics_cost, 0);
    const mort = mortality?.mortality_cost ?? 0;
    const gp = revenue - cogs - logistics - mort;
    const opex = summary?.opex_total ?? 0;
    return { revenue, cogs, logistics, mort, gp, opex, ebitda: gp - opex };
  }, [pnl, mortality, summary]);

  const months = useMemo<MonthRow[]>(() => {
    const map = new Map<string, MonthRow>();
    for (const r of pnl) {
      if (!r.delivered_at) continue;
      const month = r.delivered_at.slice(0, 7);
      const m = map.get(month) ?? { month, count: 0, revenue: 0, cost: 0, gp: 0 };
      m.count += 1;
      m.revenue += r.revenue;
      m.cost += r.cogs + r.logistics_cost;
      m.gp += r.gross_profit;
      map.set(month, m);
    }
    return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
  }, [pnl]);

  const topCustomers = useMemo(() => topBy(pnl, (r) => ({ key: r.customer_id, label: r.customer_name })), [pnl]);
  const topSites = useMemo(() => topBy(pnl, (r) => ({ key: r.site_id, label: r.site_name })), [pnl]);
  const topProducts = useMemo(
    () => topBy(pnl, (r) => (r.n_products === 1 && r.sole_product_id ? { key: r.sole_product_id, label: r.sole_product_name ?? '-' } : null)),
    [pnl],
  );

  if (loadError) return <p className="text-sm text-app-danger">Gagal memuat ringkasan finance: {loadError}</p>;
  if (!summary) return null;

  const workingCapital = summary.inventory_value + arTotal - summary.ap_outstanding;
  const cycles = ccc !== null && ccc > 0 ? 30 / ccc : null;
  const apTotal = summary.ap_current + summary.ap_d1_30 + summary.ap_d31_60 + summary.ap_d60_plus;

  const plLines: [string, number, boolean?][] = [
    ['Revenue', pl.revenue],
    ['− Pembelian (COGS)', pl.cogs],
    ['− Logistik', pl.logistics],
    ['− Mortalitas di site', pl.mort],
    ['= Gross Profit', pl.gp, true],
    ['− Opex (Kas & Bank Perusahaan)', pl.opex],
    ['= EBITDA', pl.ebitda, true],
  ];

  const monthColumns: DataTableColumn<MonthRow>[] = [
    {
      key: 'month',
      header: 'Bulan',
      render: (m) => new Date(`${m.month}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
    },
    { key: 'count', header: 'Delivery', render: (m) => formatNumber(m.count) },
    { key: 'revenue', header: 'Revenue', render: (m) => formatCurrency(m.revenue) },
    { key: 'cost', header: 'COGS + Logistik', render: (m) => formatCurrency(m.cost) },
    { key: 'gp', header: 'Gross Profit', render: (m) => <span className={m.gp < 0 ? 'text-app-danger' : ''}>{formatCurrency(m.gp)}</span> },
    { key: 'gm', header: 'GM%', render: (m) => pct(m.revenue > 0 ? (m.gp / m.revenue) * 100 : null) },
  ];

  function TopCard({ title, rows }: { title: string; rows: TopRow[] }) {
    return (
      <div className="space-y-2 rounded-lg border border-app-border bg-app-panel p-4 shadow-sm">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">{title}</h3>
        {rows.length === 0 ? (
          <p className="text-xs text-app-muted">Belum ada data.</p>
        ) : (
          rows.map((t) => (
            <div key={t.key} className="border-b border-app-border pb-1.5 text-sm last:border-0 last:pb-0">
              <p className="text-app-text" title={t.label}>
                {t.label}
              </p>
              <p className={`text-xs tabular-nums ${t.gp < 0 ? 'text-app-danger' : 'text-app-muted'}`}>
                {formatCurrency(t.gp)} · GM {pct(t.revenue > 0 ? (t.gp / t.revenue) * 100 : null)}
              </p>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-app-text">P&amp;L, Modal Kerja &amp; Utang Pemasok</h2>
        <p className="text-xs text-app-muted">Level perusahaan, sepanjang waktu — hanya Owner &amp; Investor.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KPICard
          icon={TrendingUp}
          label="EBITDA"
          value={formatCurrency(pl.ebitda)}
          note={`GP ${formatCurrency(pl.gp)} − Opex ${formatCurrency(pl.opex)}`}
        />
        <KPICard icon={Landmark} label="Modal Kerja" value={formatCurrency(workingCapital)} note="Stok + Piutang − Utang Pemasok" />
        <KPICard
          icon={RefreshCw}
          label="Siklus Modal / Bulan"
          value={cycles !== null ? `${formatNumber(Math.round(cycles * 100) / 100)}×` : 'Belum ada data'}
          note="30 hari ÷ Cash Conversion Cycle"
        />
        <KPICard
          icon={Wallet}
          label="Utang Pemasok"
          value={formatCurrency(summary.ap_outstanding)}
          note={
            summary.ap_unclassified_count > 0
              ? `+ ${formatCurrency(summary.ap_unclassified_amount)} termin belum diisi`
              : 'Pembelian bertermin belum dibayar'
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-app-border bg-app-panel p-4 shadow-sm">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-app-muted">Struktur P&amp;L</h3>
          <dl className="space-y-1.5 text-sm">
            {plLines.map(([label, value, strong]) => (
              <div key={label} className={`flex justify-between gap-2 ${strong ? 'border-t border-app-border pt-1.5 font-semibold' : ''}`}>
                <dt className={strong ? 'text-app-text' : 'text-app-muted'}>{label}</dt>
                <dd className={`tabular-nums ${strong && value < 0 ? 'text-app-danger' : 'text-app-text'}`}>{formatCurrency(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-app-muted">
            Opex diambil dari catatan nyata kategori Opex di Kas &amp; Bank Perusahaan — kalau belum diinput, EBITDA terlihat
            lebih tinggi dari kenyataan.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4 shadow-sm">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">Struktur Biaya (% dari Revenue)</h3>
          {pl.revenue > 0 ? (
            <>
              {(
                [
                  ['Pembelian (COGS)', pl.cogs],
                  ['Logistik', pl.logistics],
                  ['Mortalitas', pl.mort],
                  ['Opex', pl.opex],
                ] as [string, number][]
              ).map(([label, value]) => (
                <Bar
                  key={label}
                  label={label}
                  value={value}
                  total={pl.revenue}
                  hint={`${formatCurrency(value)} · ${pct((value / pl.revenue) * 100)}`}
                />
              ))}
              <div className="flex justify-between border-t border-app-border pt-2 text-sm font-semibold">
                <span>Gross Margin</span>
                <span className={pl.gp < 0 ? 'text-app-danger' : 'text-app-success'}>{pct((pl.gp / pl.revenue) * 100)}</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-app-muted">Belum ada revenue.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4 shadow-sm">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">Modal Kerja — Di Mana Kas Tertahan</h3>
          {(
            [
              ['Stok hidup', summary.inventory_value],
              ['Piutang belum tertagih', arTotal],
            ] as [string, number][]
          ).map(([label, value]) => (
            <Bar
              key={label}
              label={label}
              value={value}
              total={summary.inventory_value + arTotal}
              hint={formatCurrency(value)}
            />
          ))}
          <div className="flex justify-between text-sm">
            <span className="text-app-muted">− Utang pemasok</span>
            <span className="tabular-nums">{formatCurrency(summary.ap_outstanding)}</span>
          </div>
          <div className="flex justify-between border-t border-app-border pt-2 text-sm font-semibold">
            <span>Modal Kerja</span>
            <span className="tabular-nums">{formatCurrency(workingCapital)}</span>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4 shadow-sm">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">Aging Utang Pemasok</h3>
          {apTotal > 0 ? (
            (
              [
                ['Belum jatuh tempo', summary.ap_current],
                ['1–30 hari lewat tempo', summary.ap_d1_30],
                ['31–60 hari lewat tempo', summary.ap_d31_60],
                ['>60 hari lewat tempo', summary.ap_d60_plus],
              ] as [string, number][]
            ).map(([label, value]) => <Bar key={label} label={label} value={value} total={apTotal} hint={formatCurrency(value)} />)
          ) : (
            <p className="text-xs text-app-muted">Tidak ada utang pemasok bertermin yang belum dibayar.</p>
          )}
          {summary.ap_unclassified_count > 0 && (
            <p className="text-xs text-app-warning">
              {summary.ap_unclassified_count} nota ({formatCurrency(summary.ap_unclassified_amount)}) belum bisa dinilai karena
              termin pemasok belum diisi di Supplier Management.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">Tren Bulanan</h3>
        <DataTable columns={monthColumns} rows={months} getRowId={(m) => m.month} emptyLabel="Belum ada penjualan." />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TopCard title="Top 5 Pelanggan (Gross Profit)" rows={topCustomers} />
        <TopCard title="Top 5 Site (Gross Profit)" rows={topSites} />
        <TopCard title="Top 5 Produk (Gross Profit)" rows={topProducts} />
      </div>
    </div>
  );
}
