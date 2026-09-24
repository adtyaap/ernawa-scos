import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatKg } from '../../lib/format';
import type { Site, SiteForecastRow } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

const LOW_CONFIDENCE_THRESHOLD = 3;

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

// Perkiraan Pasokan per Site (PRD-MASTER site_forecast, migration 0035).
//
// SENGAJA proyeksi SEDERHANA: rata-rata harian dari riwayat penerimaan N
// hari terakhir, diekstrapolasi ke depan -- BUKAN model time-series/statistik
// canggih. Dikonfirmasi eksplisit dengan user (setelah dijelaskan tradeoff
// per item: trading masih volume pilot, budidaya belum beroperasi sama
// sekali) bahwa proyeksi kasar ini tetap dibangun sekarang sebagai basis
// awal, bukan ditunda sampai ada "cukup data" -- karena "cukup data" itu
// sendiri baru bisa dinilai kalau sudah mulai dikumpulkan/dilihat.
//
// `data_points` SENGAJA ditonjolkan (bukan disembunyikan di balik satu angka
// forecast yang terlihat pasti) -- kalau cuma 1-2 transaksi dalam periode
// riwayat, itu bukan basis yang layak dipakai untuk keputusan, dan halaman
// ini menandainya jelas lewat badge "Data sangat sedikit".
export function PerkiraanPasokanPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [siteId, setSiteId] = useState('');
  const [historyDays, setHistoryDays] = useState('30');
  const [forecastDays, setForecastDays] = useState('7');

  const [rows, setRows] = useState<SiteForecastRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);

  useEffect(() => {
    async function loadSites() {
      const { data } = await supabase.from('sites').select('id, name, type').order('name');
      setSites((data as Site[]) ?? []);
      setLoadingMaster(false);
    }
    loadSites();
  }, []);

  async function handleCheck() {
    if (!siteId) return;
    setLoading(true);
    setLoadError(null);
    setHasQueried(true);

    const { data, error } = await supabase.rpc('get_site_forecast', {
      p_site_id: siteId,
      p_history_days: Number(historyDays) || 30,
      p_forecast_days: Number(forecastDays) || 7,
    });

    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      setRows((data as SiteForecastRow[]) ?? []);
    }
    setLoading(false);
  }

  const columns: DataTableColumn<SiteForecastRow>[] = [
    { key: 'product_name', header: 'Produk' },
    {
      key: 'data_points',
      header: 'Basis Data',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <span>{row.data_points} transaksi</span>
          {row.data_points < LOW_CONFIDENCE_THRESHOLD && <StatusBadge label="Data sangat sedikit" tone="warning" />}
        </div>
      ),
    },
    { key: 'total_received_kg', header: `Total ${historyDays} Hari`, render: (row) => formatKg(row.total_received_kg) },
    { key: 'avg_daily_kg', header: 'Rata-rata/Hari', render: (row) => formatKg(row.avg_daily_kg) },
    { key: 'forecast_kg', header: `Proyeksi ${forecastDays} Hari`, render: (row) => formatKg(row.forecast_kg) },
    {
      key: 'periode',
      header: 'Periode Data',
      render: (row) => `${formatDate(row.first_received_at)} — ${formatDate(row.last_received_at)}`,
    },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Source &gt; Perkiraan Pasokan</h1>
        <p className="text-sm text-app-muted">
          Proyeksi kasar kebutuhan pasokan per site, dari rata-rata riwayat penerimaan — BUKAN model prediksi
          canggih. Perhatikan kolom "Basis Data": proyeksi dari sedikit transaksi tidak layak dijadikan keputusan.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Site *</span>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass} disabled={loadingMaster}>
              <option value="">Pilih site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.type})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Riwayat (hari)</span>
            <input type="number" min="1" step="1" value={historyDays} onChange={(e) => setHistoryDays(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Proyeksi ke Depan (hari)</span>
            <input type="number" min="1" step="1" value={forecastDays} onChange={(e) => setForecastDays(e.target.value)} className={inputClass} />
          </label>
        </div>

        <button
          type="button"
          onClick={handleCheck}
          disabled={!siteId || loading}
          className="rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {loading ? 'Menghitung...' : 'Hitung Perkiraan'}
        </button>
      </div>

      {loadError && (
        <AlertBanner variant="danger" title="Gagal menghitung">
          {loadError}
        </AlertBanner>
      )}

      {hasQueried && !loading && !loadError && (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.product_id}
          emptyLabel="Belum ada riwayat penerimaan di site ini pada periode yang dipilih — tidak bisa diproyeksikan (budidaya yang belum beroperasi akan selalu kosong di sini)."
        />
      )}
    </div>
  );
}
