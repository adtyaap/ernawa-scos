import { useEffect, useState } from 'react';
import { AlertTriangle, Boxes, ClipboardList, Scale } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { KPICard } from '../../components/shared/KPICard';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatKg, formatNumber } from '../../lib/format';
import type { AvailableBatchLine, Site, Track } from '../../types/domain';

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
// track — tidak ada angka gabungan trading+budidaya (CLAUDE.md #1). Sengaja
// tidak menampilkan nilai uang (piutang/margin): itu tugas halaman Finance
// yang sudah memisahkan track secara eksplisit.
export function HomePage() {
  const [rows, setRows] = useState<SiteStockRow[]>([]);
  const [openDemands, setOpenDemands] = useState<number | null>(null);
  const [awaitingWeigh, setAwaitingWeigh] = useState<number | null>(null);
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

      const [stockResults, demandResult, deliveryResult] = await Promise.all([
        Promise.all(sites.map((site) => supabase.rpc('get_available_batch_lines', { p_site_id: site.id }))),
        supabase.from('demands').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('deliveries').select('id', { count: 'exact', head: true }).is('actual_weight_kg', null),
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
          note="Belum dialokasikan"
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
