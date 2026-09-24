import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, Boxes, ClipboardList, Scale } from 'lucide-react';
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
  TradingDeliveryMargin,
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

const TRACKS: { key: Track; label: string }[] = [
  { key: 'trading', label: 'Trading' },
  { key: 'budidaya', label: 'Budidaya' },
];

// Dashboard operasional dari data nyata. Stok dihitung dari ledger lewat RPC
// get_available_batch_lines per site (CLAUDE.md #2) dan SELALU dipisah per
// track — tidak ada angka gabungan trading+budidaya (CLAUDE.md #1).
//
// [REVISI] Sebelumnya sengaja tidak menampilkan nilai uang sama sekali
// ("itu tugas halaman Finance"). Diubah atas keputusan eksplisit user saat
// membangun Panel Peringatan Aktif (dibandingkan thd artifact lama "Lobster
// Trading Control Tower") -- piutang lewat tempo & margin di bawah target
// TERMASUK nominal Rp ditampilkan di sini juga, supaya jadi satu tempat
// lihat SEMUA yang butuh perhatian tanpa buka banyak halaman. Tetap per
// track (tidak melanggar aturan #1), detail lengkap tetap ada di halaman
// Finance/Piutang masing-masing.
export function HomePage() {
  const { profile } = useAuth();
  // Investor hanya punya akses Finance (migration 0022); dashboard operasional
  // ini akan kosong untuk mereka, jadi langsung diarahkan ke Finance.
  if (profile?.role === 'investor') return <Navigate to="/finance" replace />;
  return <HomeDashboard />;
}

function HomeDashboard() {
  const [rows, setRows] = useState<SiteStockRow[]>([]);
  const [openDemands, setOpenDemands] = useState<number | null>(null);
  const [awaitingWeigh, setAwaitingWeigh] = useState<number | null>(null);
  const [fefoRisk, setFefoRisk] = useState<FefoRiskRow[]>([]);
  const [overdueSettlements, setOverdueSettlements] = useState<SettlementAgingRow[]>([]);
  const [marginAlerts, setMarginAlerts] = useState<ActiveAlert[]>([]);
  const [mortalityRates, setMortalityRates] = useState<MortalityRateRow[]>([]);
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

      const [stockResults, demandResult, deliveryResult, fefoResult, agingResult, marginResult, targetResult, mortalityResult] =
        await Promise.all([
          Promise.all(sites.map((site) => supabase.rpc('get_available_batch_lines', { p_site_id: site.id }))),
          supabase.from('demands').select('id', { count: 'exact', head: true }).in('status', ['open', 'partial']),
          supabase
            .from('deliveries')
            .select('id', { count: 'exact', head: true })
            .is('actual_weight_kg', null)
            .is('cancelled_at', null),
          supabase.rpc('get_fefo_risk_report'),
          supabase.from('v_settlements_aging').select('*').is('settled_at', null).lt('days_until_due', 0),
          supabase.from('v_trading_delivery_margin').select('*'),
          supabase.from('finance_targets').select('track, margin_target_pct'),
          supabase.rpc('get_mortality_rates', { p_days: 30 }),
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
      setOverdueSettlements((agingResult.data as SettlementAgingRow[]) ?? []);
      setMortalityRates(((mortalityResult.data as MortalityRateRow[]) ?? []).filter((r) => r.is_overdue));

      // Margin di bawah target, per track -- cuma trading yang punya view
      // sumber (v_trading_delivery_margin), budidaya belum beroperasi jadi
      // tidak pernah menghasilkan alert (bukan bug, konsisten dgn placeholder
      // "belum ada data operasional" di halaman Finance).
      const marginRows = (marginResult.data as TradingDeliveryMargin[]) ?? [];
      const targets = (targetResult.data as { track: string; margin_target_pct: number }[]) ?? [];
      const totalRevenue = marginRows.reduce((sum, r) => sum + r.revenue, 0);
      const totalMargin = marginRows.reduce((sum, r) => sum + r.margin, 0);
      const tradingMarginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : null;
      const tradingTarget = targets.find((t) => t.track === 'trading')?.margin_target_pct ?? null;
      const newMarginAlerts: ActiveAlert[] = [];
      if (tradingMarginPct !== null && tradingTarget !== null && tradingMarginPct < tradingTarget) {
        const gap = tradingMarginPct - tradingTarget;
        newMarginAlerts.push({
          id: 'margin-trading',
          severity: gap < -5 ? 'kritis' : 'peringatan',
          title: 'Margin Trading di bawah target',
          body: `Realisasi ${formatNumber(Math.round(tradingMarginPct * 10) / 10)}% vs target ${formatNumber(tradingTarget)}% (gap ${formatNumber(Math.round(gap * 10) / 10)}pp).`,
        });
      }
      setMarginAlerts(newMarginAlerts);

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

  // Panel Peringatan Aktif: gabungan batch tertahan (get_fefo_risk_report),
  // piutang lewat tempo (v_settlements_aging), dan margin di bawah target
  // (v_trading_delivery_margin + finance_targets) -- tiga sumber data yang
  // sebelumnya tersebar di 3 halaman terpisah (FefoRiskReportPage,
  // PiutangPage, FinancePage). Severity 'kritis' vs 'peringatan' murni
  // heuristik tampilan (bukan nilai baru di DB): batch >2x ambang holding,
  // piutang >60 hari lewat tempo, margin gap >5pp.
  const fefoAlerts: ActiveAlert[] = fefoRisk.map((row) => {
    const ratio = row.max_holding_hours && row.age_hours ? row.age_hours / row.max_holding_hours : 0;
    return {
      id: `fefo-${row.batch_line_id}`,
      severity: ratio > 2 ? 'kritis' : 'peringatan',
      title: `${row.product_name} tertahan ${formatNumber(Math.round(row.age_hours ?? 0))} jam`,
      body: `${row.site_name} (${row.tank_name}) — sisa ${formatKg(row.balance_kg)}, ambang ${row.max_holding_hours} jam.`,
    };
  });
  const arAlerts: ActiveAlert[] = overdueSettlements.map((row) => {
    const overdueDays = row.days_until_due !== null ? Math.abs(row.days_until_due) : 0;
    return {
      id: `ar-${row.settlement_id}`,
      severity: overdueDays > 60 ? 'kritis' : 'peringatan',
      title: `Piutang lewat tempo ${formatNumber(overdueDays)} hari`,
      body: `${row.customer_name} — ${formatCurrency(row.amount)}.`,
    };
  });
  const mortalityAlerts: ActiveAlert[] = mortalityRates.map((row) => {
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

  const columns: DataTableColumn<SiteStockRow>[] = [
    { key: 'site', header: 'Site', render: (row) => row.site.name },
    {
      key: 'track',
      header: 'Track',
      render: (row) => (
        <StatusBadge
          label={row.site.type === 'trading' ? 'Trading' : 'Budidaya'}
          tone={row.site.type === 'trading' ? 'info' : 'success'}
        />
      ),
    },
    { key: 'totalKg', header: 'Stok Tersedia', render: (row) => formatKg(row.totalKg) },
    { key: 'lineCount', header: 'Jumlah Batch Line', render: (row) => formatNumber(row.lineCount) },
    {
      key: 'overdue',
      header: 'Lewat Ambang',
      render: (row) =>
        row.overdueCount > 0 ? (
          <StatusBadge label={`${row.overdueCount} lewat ambang`} tone="danger" />
        ) : (
          <StatusBadge label="Aman" tone="success" />
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Home</h1>
        <p className="text-sm text-app-muted">Ringkasan operasional. Stok dipisah per track, tidak digabung.</p>
      </div>

      {error && (
        <AlertBanner variant="danger" title="Sebagian data gagal dimuat">
          {error}
        </AlertBanner>
      )}

      <div className="space-y-2">
        <h2 className="flex items-center justify-between text-sm font-semibold text-app-muted">
          <span className="flex items-center gap-2">
            <AlertTriangle size={14} /> Peringatan Aktif
          </span>
          {!loading && <span className="text-xs font-normal">{activeAlerts.length} item</span>}
        </h2>
        {loading ? (
          <p className="text-xs text-app-muted">Memuat...</p>
        ) : activeAlerts.length === 0 ? (
          <div className="rounded-lg border border-app-border bg-app-panel px-4 py-3 text-xs text-app-muted">
            Tidak ada peringatan aktif saat ini.
          </div>
        ) : (
          <div className="space-y-1.5">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-lg border-l-4 bg-app-panel px-3 py-2 ${
                  alert.severity === 'kritis' ? 'border-l-app-danger' : 'border-l-app-warning'
                }`}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TRACKS.map(({ key, label }) => (
          <KPICard
            key={key}
            icon={Boxes}
            label={`Stok ${label}`}
            value={loading ? '...' : formatKg(summaryByTrack[key].totalKg)}
            note={
              loading
                ? undefined
                : summaryByTrack[key].siteCount === 0
                  ? 'Belum ada site'
                  : `${summaryByTrack[key].siteCount} site`
            }
          />
        ))}
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
        <h2 className="flex items-center gap-2 text-sm font-semibold text-app-muted">
          <AlertTriangle size={14} /> Stok per Site
        </h2>
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.site.id}
          emptyLabel={loading ? 'Memuat...' : 'Belum ada site.'}
        />
      </div>
    </div>
  );
}
