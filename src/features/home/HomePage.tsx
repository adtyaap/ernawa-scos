import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, Boxes, Clock, ClipboardList, HeartPulse, Percent, Receipt, RefreshCw, Scale, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { KPICard } from '../../components/shared/KPICard';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatCurrency, formatKg, formatNumber } from '../../lib/format';
import type {
  AvailableBatchLine,
  FefoRiskRow,
  MortalityRateRow,
  SettlementAgingRow,
  Site,
  Track,
  TradingCapitalLockup,
  TradingDeliveryMargin,
  TradingDpoInput,
  TradingMarginByProduct,
  TradingMarginBySegment,
  TradingMarginMixedSummary,
  TradingReceivableCycle,
  TrustSummary,
} from '../../types/domain';

interface ActiveAlert {
  id: string;
  severity: 'kritis' | 'peringatan';
  title: string;
  body: string;
}

interface SiteStockRow {
  site: Site;
  totalKg: number;
  lineCount: number;
  overdueCount: number;
}

interface TrackSummary {
  totalKg: number;
  overdueCount: number;
  siteCount: number;
}

const SEGMENT_DISPLAY_LABEL: Record<string, string> = {
  restoran: 'Restoran',
  eksportir: 'Eksportir',
  lainnya: 'Lainnya',
  belum_diklasifikasi: 'Belum Diklasifikasi',
};

const SPARSE_DATA_THRESHOLD = 5;

function formatDays(value: number): string {
  return `${formatNumber(Math.round(value * 10) / 10)} hari`;
}

// Dashboard operasional + finansial trading — direstrukturisasi mengikuti
// FORMAT artifact lama "Lobster Trading Control Tower" (banner target,
// grid KPI, Peringatan Aktif, breakdown margin 2-kolom, AR aging, footnote
// data trust), atas permintaan eksplisit user. Tipografi ikut artifact
// (Fraunces utk judul via `font-display`, IBM Plex Mono utk angka KPI via
// `font-mono` — lihat tailwind.config.ts) TAPI warna tetap palet gelap
// aplikasi yang sudah ada (app-bg/app-panel/app-accent/dst) — bukan tema
// terang "paper" artifact, supaya tidak pecah dari sisa aplikasi yang semua
// halaman lainnya masih gelap.
//
// KONSOLIDASI: metrik yang sebelumnya cuma ada di FinancePage (CCC, DPO,
// Margin %, Piutang, breakdown per Produk/Segmen, Data Trust) SEKARANG
// JUGA tampil di sini, read-only (edit target/ambang ada di Admin >
// Pengaturan Ambang — Home bukan tempat mengubah config, biar tidak ada
// dua tempat yang bisa mengubah baris config yang sama). SELALU per track
// (CLAUDE.md #1) — trading dapat isi penuh, budidaya tetap placeholder
// "belum ada data operasional" krn memang belum beroperasi.
//
// Investor TETAP diarahkan ke /finance (bukan halaman ini) -- investor
// cuma punya RLS ke data Finance (migration 0022), bukan Inventory/FEFO/
// mortalitas yang sekarang jadi bagian besar halaman ini; menampilkan Home
// versi ini ke investor akan kelihatan rusak/kosong separuh.
export function HomePage() {
  const { profile } = useAuth();
  if (profile?.role === 'investor') return <Navigate to="/finance" replace />;
  return <HomeDashboard />;
}

function HomeDashboard() {
  const [rows, setRows] = useState<SiteStockRow[]>([]);
  const [openDemands, setOpenDemands] = useState<number | null>(null);
  const [awaitingWeigh, setAwaitingWeigh] = useState<number | null>(null);
  const [fefoRisk, setFefoRisk] = useState<FefoRiskRow[]>([]);
  const [overdueSettlements, setOverdueSettlements] = useState<SettlementAgingRow[]>([]);
  const [unpaidTermRows, setUnpaidTermRows] = useState<SettlementAgingRow[]>([]);
  const [mortalityRatesAll, setMortalityRatesAll] = useState<MortalityRateRow[]>([]);
  const [marginTargetPct, setMarginTargetPct] = useState<number | null>(null);
  const [arWatchDays, setArWatchDays] = useState<number | null>(null);

  const [marginRows, setMarginRows] = useState<TradingDeliveryMargin[]>([]);
  const [lockupRows, setLockupRows] = useState<TradingCapitalLockup[]>([]);
  const [receivableRows, setReceivableRows] = useState<TradingReceivableCycle[]>([]);
  const [dpoInputs, setDpoInputs] = useState<TradingDpoInput[]>([]);
  const [marginByProduct, setMarginByProduct] = useState<TradingMarginByProduct[]>([]);
  const [marginMixed, setMarginMixed] = useState<TradingMarginMixedSummary | null>(null);
  const [marginBySegment, setMarginBySegment] = useState<TradingMarginBySegment[]>([]);
  const [receivingTrust, setReceivingTrust] = useState<TrustSummary | null>(null);
  const [settlementTrust, setSettlementTrust] = useState<TrustSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: siteData, error: siteError } = await supabase.from('sites').select('id, name, type').order('name');
      if (siteError) {
        if (active) {
          setError(siteError.message);
          setLoading(false);
        }
        return;
      }
      const sites = (siteData as Site[]) ?? [];

      const [
        stockResults,
        demandResult,
        deliveryResult,
        fefoResult,
        agingResult,
        targetResult,
        mortalityResult,
        marginRes,
        lockupRes,
        receivableRes,
        dpoRes,
        byProductRes,
        mixedRes,
        bySegmentRes,
        receivingTrustRes,
        settlementTrustRes,
      ] = await Promise.all([
        Promise.all(sites.map((site) => supabase.rpc('get_available_batch_lines', { p_site_id: site.id }))),
        supabase.from('demands').select('id', { count: 'exact', head: true }).in('status', ['open', 'partial']),
        supabase
          .from('deliveries')
          .select('id', { count: 'exact', head: true })
          .is('actual_weight_kg', null)
          .is('cancelled_at', null),
        supabase.rpc('get_fefo_risk_report'),
        supabase.from('v_settlements_aging').select('*'),
        supabase.from('finance_targets').select('track, margin_target_pct, ar_watch_days'),
        supabase.rpc('get_mortality_rates', { p_days: 30 }),
        supabase.from('v_trading_delivery_margin').select('*'),
        supabase.from('v_trading_capital_lockup').select('*'),
        supabase.from('v_trading_receivable_cycle').select('*'),
        supabase.from('v_trading_dpo_inputs').select('*'),
        supabase.from('v_trading_margin_by_product').select('*'),
        supabase.from('v_trading_margin_mixed_summary').select('*'),
        supabase.from('v_trading_margin_by_segment').select('*'),
        supabase.from('v_receiving_trust').select('*'),
        supabase.from('v_settlement_trust').select('*'),
      ]);

      if (!active) return;

      const failed = stockResults.find((result) => result.error);
      if (failed?.error) {
        setError(failed.error.message);
      }

      setRows(
        sites.map((site, index) => {
          const lines = (stockResults[index].data as AvailableBatchLine[] | null) ?? [];
          return {
            site,
            totalKg: lines.reduce((sum, line) => sum + line.balance_kg, 0),
            lineCount: lines.length,
            overdueCount: lines.filter((line) => line.is_overdue).length,
          };
        }),
      );
      setOpenDemands(demandResult.count ?? 0);
      setAwaitingWeigh(deliveryResult.count ?? 0);
      setFefoRisk((fefoResult.data as FefoRiskRow[]) ?? []);

      const agingRows = (agingResult.data as SettlementAgingRow[]) ?? [];
      setOverdueSettlements(agingRows.filter((r) => r.settled_at === null && (r.days_until_due ?? 0) < 0));
      setUnpaidTermRows(agingRows.filter((r) => r.track === 'trading' && r.settled_at === null));

      const allMortality = (mortalityResult.data as MortalityRateRow[]) ?? [];
      setMortalityRatesAll(allMortality);

      const targets = (targetResult.data as { track: string; margin_target_pct: number; ar_watch_days: number | null }[]) ?? [];
      const tradingTargetRow = targets.find((t) => t.track === 'trading');
      setMarginTargetPct(tradingTargetRow ? Number(tradingTargetRow.margin_target_pct) : null);
      setArWatchDays(tradingTargetRow?.ar_watch_days ?? null);

      setMarginRows((marginRes.data as TradingDeliveryMargin[]) ?? []);
      setLockupRows((lockupRes.data as TradingCapitalLockup[]) ?? []);
      setReceivableRows((receivableRes.data as TradingReceivableCycle[]) ?? []);
      setDpoInputs((dpoRes.data as TradingDpoInput[]) ?? []);
      setMarginByProduct((byProductRes.data as TradingMarginByProduct[]) ?? []);
      setMarginMixed(((mixedRes.data as TradingMarginMixedSummary[]) ?? [])[0] ?? null);
      setMarginBySegment((bySegmentRes.data as TradingMarginBySegment[]) ?? []);
      setReceivingTrust(((receivingTrustRes.data as TrustSummary[]) ?? []).find((r) => r.track === 'trading') ?? null);
      setSettlementTrust(((settlementTrustRes.data as TrustSummary[]) ?? []).find((r) => r.track === 'trading') ?? null);

      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const summaryByTrack: Record<Track, TrackSummary> = {
    trading: { totalKg: 0, overdueCount: 0, siteCount: 0 },
    budidaya: { totalKg: 0, overdueCount: 0, siteCount: 0 },
  };
  for (const row of rows) {
    const summary = summaryByTrack[row.site.type];
    summary.totalKg += row.totalKg;
    summary.overdueCount += row.overdueCount;
    summary.siteCount += 1;
  }

  const overdueRows = rows.filter((row) => row.overdueCount > 0);

  // ---------- Metrik trading (pola & rumus SAMA PERSIS dgn FinancePage.tsx,
  // supaya kedua halaman tidak pernah menampilkan angka yang beda utk data
  // yang sama) ----------
  const marginPct = useMemo(() => {
    const totalRevenue = marginRows.reduce((sum, r) => sum + r.revenue, 0);
    const totalMargin = marginRows.reduce((sum, r) => sum + r.margin, 0);
    return totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : null;
  }, [marginRows]);

  const avgLockupDays = useMemo(() => {
    const totalQty = lockupRows.reduce((sum, r) => sum + r.qty_kg, 0);
    const weightedSum = lockupRows.reduce((sum, r) => sum + r.lockup_days * r.qty_kg, 0);
    return totalQty > 0 ? weightedSum / totalQty : null;
  }, [lockupRows]);

  const avgDaysToCollect = useMemo(() => {
    if (receivableRows.length === 0) return null;
    const total = receivableRows.reduce((sum, r) => sum + r.days_to_collect, 0);
    return total / receivableRows.length;
  }, [receivableRows]);

  const { dpoWeighted, dpoCoveragePct } = useMemo(() => {
    const totalValueAll = dpoInputs.reduce((sum, r) => sum + r.purchase_value, 0);
    const withTerm = dpoInputs.filter((r) => r.payment_term_days !== null);
    const totalValueWithTerm = withTerm.reduce((sum, r) => sum + r.purchase_value, 0);
    const weighted =
      totalValueWithTerm > 0 ? withTerm.reduce((sum, r) => sum + (r.payment_term_days ?? 0) * r.purchase_value, 0) / totalValueWithTerm : null;
    return { dpoWeighted: weighted, dpoCoveragePct: totalValueAll > 0 ? (totalValueWithTerm / totalValueAll) * 100 : null };
  }, [dpoInputs]);

  const ccc = avgLockupDays !== null ? avgLockupDays + (avgDaysToCollect ?? 0) - (dpoWeighted ?? 0) : null;

  const arBuckets = useMemo(() => {
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d60plus: 0, total: 0 };
    for (const row of unpaidTermRows) {
      buckets.total += row.amount;
      const days = row.days_until_due ?? 0;
      if (days >= 0) buckets.current += row.amount;
      else if (days >= -30) buckets.d1_30 += row.amount;
      else if (days >= -60) buckets.d31_60 += row.amount;
      else buckets.d60plus += row.amount;
    }
    return buckets;
  }, [unpaidTermRows]);

  // Mortalitas trading agregat (satu angka utk KPI utama, pola sama artifact
  // lama: total mortality/total received lintas site, BUKAN rata-rata dari
  // rata-rata tiap site) -- detail per-site tetap di Peringatan Aktif &
  // StokMortalitasPage.
  const mortalityTrading = useMemo(() => {
    const tradingRows = mortalityRatesAll.filter((r) => r.track === 'trading');
    const totalReceived = tradingRows.reduce((sum, r) => sum + r.received_kg, 0);
    const totalMortality = tradingRows.reduce((sum, r) => sum + r.mortality_kg, 0);
    return totalReceived > 0 ? (totalMortality / totalReceived) * 100 : null;
  }, [mortalityRatesAll]);

  const totalUnderlyingCount = marginRows.length + lockupRows.length + receivableRows.length;
  const isSparseData = totalUnderlyingCount < SPARSE_DATA_THRESHOLD;

  // ---------- Panel Peringatan Aktif (batch tertahan, piutang lewat tempo,
  // margin di bawah target, mortalitas di atas ambang) ----------
  const fefoAlerts: ActiveAlert[] = fefoRisk.map((row) => {
    const ratio = row.max_holding_hours && row.age_hours ? row.age_hours / row.max_holding_hours : 0;
    return {
      id: `fefo-${row.batch_line_id}`,
      severity: ratio > 2 ? 'kritis' : 'peringatan',
      title: `${row.product_name} tertahan ${formatNumber(Math.round(row.age_hours ?? 0))} jam`,
      body: `${row.site_name} (${row.tank_name}) — sisa ${formatKg(row.balance_kg)}, ambang ${row.max_holding_hours} jam.`,
    };
  });
  const arAlerts: ActiveAlert[] =
    arWatchDays === null
      ? []
      : overdueSettlements
          .filter((row) => row.track === 'trading' && (row.days_until_due !== null ? Math.abs(row.days_until_due) : 0) > arWatchDays)
          .map((row) => {
            const overdueDays = row.days_until_due !== null ? Math.abs(row.days_until_due) : 0;
            return {
              id: `ar-${row.settlement_id}`,
              severity: overdueDays > 60 ? 'kritis' : 'peringatan',
              title: `Piutang lewat tempo ${formatNumber(overdueDays)} hari`,
              body: `${row.customer_name} — ${formatCurrency(row.amount)} (ambang ${arWatchDays} hari).`,
            };
          });
  const marginAlerts: ActiveAlert[] = useMemo(() => {
    if (marginPct === null || marginTargetPct === null || marginPct >= marginTargetPct) return [];
    const gap = marginPct - marginTargetPct;
    return [
      {
        id: 'margin-trading',
        severity: gap < -5 ? 'kritis' : 'peringatan',
        title: 'Margin Trading di bawah target',
        body: `Realisasi ${formatNumber(Math.round(marginPct * 10) / 10)}% vs target ${formatNumber(marginTargetPct)}% (gap ${formatNumber(Math.round(gap * 10) / 10)}pp).`,
      },
    ];
  }, [marginPct, marginTargetPct]);
  const mortalityAlerts: ActiveAlert[] = mortalityRatesAll
    .filter((r) => r.is_overdue)
    .map((row) => {
      const ratio = row.threshold_pct && row.mortality_pct ? row.mortality_pct / row.threshold_pct : 0;
      return {
        id: `mortality-${row.site_id}`,
        severity: ratio > 1.5 ? 'kritis' : 'peringatan',
        title: `Mortalitas ${row.site_name} di atas ambang`,
        body: `${formatNumber(Math.round((row.mortality_pct ?? 0) * 10) / 10)}% dari ${formatKg(row.received_kg)} diterima (30 hari terakhir), ambang ${formatNumber(row.threshold_pct ?? 0)}%.`,
      };
    });
  const activeAlerts = [...fefoAlerts, ...arAlerts, ...marginAlerts, ...mortalityAlerts].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'kritis' ? -1 : 1,
  );

  // Banner target: gap margin realized vs target (metrik margin PER
  // TRANSAKSI yang sudah dikonfirmasi user, migration 0036 -- BUKAN target
  // ROI-berbasis-CCC 30%/bulan spt artifact lama; formulanya sengaja sudah
  // beda, cuma GAYA tampilan bannernya yang mengikuti pola artifact).
  const bannerTone: 'ok' | 'warn' | 'bad' | 'none' =
    marginPct === null || marginTargetPct === null ? 'none' : marginPct >= marginTargetPct ? 'ok' : marginPct - marginTargetPct >= -5 ? 'warn' : 'bad';
  const bannerClass =
    bannerTone === 'ok'
      ? 'border-app-success/40 bg-app-success/10'
      : bannerTone === 'warn'
        ? 'border-app-warning/40 bg-app-warning/10'
        : bannerTone === 'bad'
          ? 'border-app-danger/40 bg-app-danger/10'
          : 'border-app-border bg-app-panel';

  const columns: DataTableColumn<SiteStockRow>[] = [
    { key: 'site', header: 'Site', render: (row) => row.site.name },
    {
      key: 'track',
      header: 'Track',
      render: (row) => (
        <StatusBadge label={row.site.type === 'trading' ? 'Trading' : 'Budidaya'} tone={row.site.type === 'trading' ? 'info' : 'success'} />
      ),
    },
    { key: 'totalKg', header: 'Stok Tersedia', render: (row) => formatKg(row.totalKg) },
    { key: 'lineCount', header: 'Jumlah Batch Line', render: (row) => formatNumber(row.lineCount) },
    {
      key: 'overdue',
      header: 'Lewat Ambang',
      render: (row) =>
        row.overdueCount > 0 ? <StatusBadge label={`${row.overdueCount} lewat ambang`} tone="danger" /> : <StatusBadge label="Aman" tone="success" />,
    },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-app-accent">Langkah Pasti · Track Trading</p>
        <h1 className="font-display text-2xl font-semibold text-app-text">Home</h1>
        <p className="text-sm text-app-muted">Ringkasan operasional &amp; finansial. Stok dan metrik selalu dipisah per track, tidak digabung.</p>
      </div>

      {error && (
        <AlertBanner variant="danger" title="Sebagian data gagal dimuat">
          {error}
        </AlertBanner>
      )}

      <div className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-app-text">Trading</h2>

        {!loading && isSparseData && (
          <AlertBanner variant="warning" title="Data masih sangat sedikit">
            Metrik finansial di bawah ini berdasarkan data yang masih sedikit (kemungkinan besar hasil testing), belum representatif sebagai
            metrik bisnis sungguhan.
          </AlertBanner>
        )}

        {bannerTone !== 'none' && (
          <div className={`space-y-1 rounded-lg border p-4 ${bannerClass}`}>
            <h3 className="font-display text-base font-semibold text-app-text">
              {bannerTone === 'ok' ? '✓' : '⚠'} Margin Trading vs Target
            </h3>
            <p className="text-xs text-app-muted">
              Realisasi <span className="font-mono font-semibold text-app-text">{formatNumber(Math.round((marginPct ?? 0) * 10) / 10)}%</span> vs
              target <span className="font-mono font-semibold text-app-text">{formatNumber(marginTargetPct ?? 0)}%</span> — gap{' '}
              <span className="font-mono font-semibold text-app-text">
                {(marginPct ?? 0) - (marginTargetPct ?? 0) >= 0 ? '+' : ''}
                {formatNumber(Math.round(((marginPct ?? 0) - (marginTargetPct ?? 0)) * 10) / 10)}pp
              </span>
              {bannerTone === 'ok' ? '. Sesuai atau di atas target.' : '. Di bawah target, perlu perhatian.'}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard
            icon={RefreshCw}
            label="Cash Conversion Cycle"
            value={ccc !== null ? formatDays(ccc) : 'Belum ada data'}
            note="Inventory Days + Hari Piutang − DPO"
          />
          <KPICard
            icon={Percent}
            label="Margin %"
            value={marginPct !== null ? `${formatNumber(Math.round(marginPct * 10) / 10)}%` : 'Belum ada data'}
            deltaLabel={
              marginPct !== null && marginTargetPct !== null
                ? `Target: ${formatNumber(marginTargetPct)}% (${marginPct >= marginTargetPct ? 'tercapai' : 'di bawah target'})`
                : marginTargetPct === null
                  ? 'Target belum diset'
                  : undefined
            }
            deltaTone={marginPct !== null && marginTargetPct !== null && marginPct >= marginTargetPct ? 'positive' : 'negative'}
          />
          <KPICard
            icon={Wallet}
            label="Piutang Belum Tertagih"
            value={formatCurrency(arBuckets.total)}
            note={arBuckets.d31_60 + arBuckets.d60plus > 0 ? `${formatCurrency(arBuckets.d31_60 + arBuckets.d60plus)} berumur >30 hari` : undefined}
          />
          <KPICard
            icon={HeartPulse}
            label="Mortalitas (30 Hari)"
            value={mortalityTrading !== null ? `${formatNumber(Math.round(mortalityTrading * 10) / 10)}%` : 'Belum ada data'}
            note="Lihat per site di Peringatan Aktif"
          />
          <KPICard icon={Boxes} label="Stok Trading" value={loading ? '...' : formatKg(summaryByTrack.trading.totalKg)} note={`${summaryByTrack.trading.siteCount} site`} />
          <KPICard
            icon={Clock}
            label="Capital Lock-up"
            value={avgLockupDays !== null ? formatDays(avgLockupDays) : 'Belum ada data'}
            note={lockupRows.length > 0 ? `Berdasarkan ${lockupRows.length} alokasi` : undefined}
          />
          <KPICard
            icon={Receipt}
            label="DPO (Termin Supplier)"
            value={dpoWeighted !== null ? formatDays(dpoWeighted) : 'Belum ada data'}
            note={dpoCoveragePct !== null ? `Cakupan ${formatNumber(Math.round(dpoCoveragePct))}% nilai pembelian` : undefined}
          />
          <KPICard
            icon={ClipboardList}
            label="Demand Terbuka"
            value={openDemands === null ? '...' : formatNumber(openDemands)}
            note="Belum terpenuhi penuh"
          />
          <KPICard
            icon={Scale}
            label="Menunggu Timbang"
            value={awaitingWeigh === null ? '...' : formatNumber(awaitingWeigh)}
            note="Delivery belum dikonfirmasi"
          />
        </div>

        <div className="space-y-2">
          <h3 className="flex items-center justify-between font-display text-sm font-semibold text-app-text">
            <span className="flex items-center gap-2">
              <AlertTriangle size={14} /> Peringatan Aktif
            </span>
            {!loading && <span className="font-mono text-xs font-normal text-app-muted">{activeAlerts.length} item</span>}
          </h3>
          {loading ? (
            <p className="text-xs text-app-muted">Memuat...</p>
          ) : activeAlerts.length === 0 ? (
            <div className="rounded-lg border border-app-border bg-app-panel px-4 py-3 text-xs text-app-muted">Tidak ada peringatan aktif saat ini.</div>
          ) : (
            <div className="space-y-1.5">
              {activeAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-lg border-l-4 bg-app-panel px-3 py-2 ${alert.severity === 'kritis' ? 'border-l-app-danger' : 'border-l-app-warning'}`}
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge label={alert.severity === 'kritis' ? 'Kritis' : 'Peringatan'} tone={alert.severity === 'kritis' ? 'danger' : 'warning'} />
                    <span className="text-xs font-semibold text-app-text">{alert.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-app-muted">{alert.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {overdueRows.length > 0 && (
          <AlertBanner variant="warning" title="Stok melewati ambang holding">
            {overdueRows.map((row) => `${row.site.name} (${row.overdueCount} batch line)`).join(', ')}
          </AlertBanner>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-app-border bg-app-panel p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Margin per Produk</h3>
            {marginByProduct.length === 0 && !marginMixed ? (
              <p className="text-xs text-app-muted">Belum ada data.</p>
            ) : (
              <div className="space-y-1">
                {marginByProduct.map((row) => (
                  <div key={row.product_id} className="flex items-center justify-between text-xs">
                    <span className="text-app-text">{row.product_name}</span>
                    <span className="font-mono text-app-muted">
                      {formatCurrency(row.margin)} ({row.margin_pct !== null ? `${formatNumber(Math.round(row.margin_pct * 10) / 10)}%` : '-'})
                    </span>
                  </div>
                ))}
                {marginMixed && marginMixed.delivery_count > 0 && (
                  <div className="flex items-center justify-between border-t border-app-border pt-1 text-xs">
                    <span className="text-app-muted">Campuran ({marginMixed.delivery_count} delivery &gt;1 produk, tidak terpecah)</span>
                    <span className="font-mono text-app-muted">{formatCurrency(marginMixed.margin)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-app-border bg-app-panel p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Margin per Segmen Pelanggan</h3>
            {marginBySegment.length === 0 ? (
              <p className="text-xs text-app-muted">Belum ada data.</p>
            ) : (
              <div className="space-y-1">
                {marginBySegment.map((row) => (
                  <div key={row.segment} className="flex items-center justify-between text-xs">
                    <span className="text-app-text">{SEGMENT_DISPLAY_LABEL[row.segment] ?? row.segment}</span>
                    <span className="font-mono text-app-muted">
                      {formatCurrency(row.margin)} ({row.margin_pct !== null ? `${formatNumber(Math.round(row.margin_pct * 10) / 10)}%` : '-'})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-app-border bg-app-panel p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Aging Piutang</h3>
            <span className="font-mono text-sm font-semibold text-app-text">{formatCurrency(arBuckets.total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="text-xs">
              <p className="text-app-muted">Belum jatuh tempo</p>
              <p className="font-mono font-semibold text-app-text">{formatCurrency(arBuckets.current)}</p>
            </div>
            <div className="text-xs">
              <p className="text-app-muted">1–30 hari</p>
              <p className="font-mono font-semibold text-app-text">{formatCurrency(arBuckets.d1_30)}</p>
            </div>
            <div className="text-xs">
              <p className="text-app-muted">31–60 hari</p>
              <p className="font-mono font-semibold text-app-text">{formatCurrency(arBuckets.d31_60)}</p>
            </div>
            <div className="text-xs">
              <p className="text-app-muted">&gt;60 hari</p>
              <p className="font-mono font-semibold text-app-text">{formatCurrency(arBuckets.d60plus)}</p>
            </div>
          </div>
          <p className="text-xs text-app-muted">
            Ambang alert: {arWatchDays !== null ? `${arWatchDays} hari lewat tempo` : 'belum diatur'} — ubah di Admin &gt; Pengaturan Ambang.
          </p>
        </div>

        <div className="space-y-1 rounded-lg border border-app-border bg-app-panel p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Data Trust</h3>
          <p className="text-xs text-app-muted">
            % nilai transaksi yang sudah ditandai terverifikasi (dicocokkan bukti transfer/timbang/invoice) saat dicatat. DPO dihitung dari termin
            tercatat per supplier, bukan histori pembayaran aktual — anggap sebagai perkiraan, bukan angka final.
          </p>
          <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
            <div className="text-xs">
              <span className="text-app-muted">Penerimaan: </span>
              <span className="font-mono font-semibold text-app-text">
                {receivingTrust && receivingTrust.total_value > 0
                  ? `${formatNumber(Math.round((receivingTrust.verified_value / receivingTrust.total_value) * 1000) / 10)}%`
                  : 'Belum ada data'}
              </span>
            </div>
            <div className="text-xs">
              <span className="text-app-muted">Settlement: </span>
              <span className="font-mono font-semibold text-app-text">
                {settlementTrust && settlementTrust.total_value > 0
                  ? `${formatNumber(Math.round((settlementTrust.verified_value / settlementTrust.total_value) * 1000) / 10)}%`
                  : 'Belum ada data'}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-app-text">
            <AlertTriangle size={14} /> Stok per Site
          </h3>
          <DataTable columns={columns} rows={rows} getRowId={(row) => row.site.id} emptyLabel={loading ? 'Memuat...' : 'Belum ada site.'} />
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-app-text">Budidaya</h2>
        <AlertBanner variant="info" title="Belum ada data operasional">
          Site budidaya belum beroperasi — belum ada delivery/settlement/penerimaan yang bisa dihitung metriknya. Bagian ini akan terisi begitu
          ada transaksi budidaya sungguhan.
        </AlertBanner>
      </div>
    </div>
  );
}
