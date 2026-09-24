import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatKg } from '../../lib/format';
import type { FefoRiskRow, Track } from '../../types/domain';

interface PolicyRow {
  id: string;
  product_id: string;
  track: Track;
  max_holding_hours: number;
  product: { name: string } | null;
}

function formatAge(ageHours: number | null): string {
  if (ageHours === null) return '-';
  if (ageHours < 24) return `${Math.round(ageHours)} jam`;
  return `${Math.round(ageHours / 24)} hari`;
}

// Laporan Risiko FEFO lintas-site (migration 0032). Badge "lewat ambang
// holding" sudah ada sejak migration 0008 (get_available_batch_lines), tapi
// cuma per-site di dalam form Alokasi & Kirim -- halaman ini menyatukan
// "produk apa saja yang berisiko sekarang" di SELURUH site sekaligus.
//
// Target holding (product_holding_policy) READ-ONLY di sini -- edit
// dipindah ke Admin > Pengaturan Ambang (halaman terpusat) supaya cuma ada
// SATU tempat yang bisa mengubah baris config ini.
export function FefoRiskReportPage() {
  const [riskRows, setRiskRows] = useState<FefoRiskRow[]>([]);
  const [loadingRisk, setLoadingRisk] = useState(true);
  const [riskError, setRiskError] = useState<string | null>(null);

  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);

  useEffect(() => {
    async function loadRisk() {
      setLoadingRisk(true);
      setRiskError(null);
      const { data, error } = await supabase.rpc('get_fefo_risk_report');
      if (error) {
        setRiskError(error.message);
        setRiskRows([]);
      } else {
        setRiskRows((data as FefoRiskRow[]) ?? []);
      }
      setLoadingRisk(false);
    }

    async function loadPolicies() {
      setLoadingPolicies(true);
      const { data } = await supabase
        .from('product_holding_policy')
        .select('id, product_id, track, max_holding_hours, product:products(name)')
        .order('track');
      setPolicies((data as unknown as PolicyRow[]) ?? []);
      setLoadingPolicies(false);
    }

    loadRisk();
    loadPolicies();
  }, []);

  const riskColumns: DataTableColumn<FefoRiskRow>[] = [
    { key: 'site', header: 'Site', render: (row) => `${row.site_name} (${row.tank_name})` },
    {
      key: 'track',
      header: 'Track',
      render: (row) => <StatusBadge label={row.track === 'trading' ? 'Trading' : 'Budidaya'} tone={row.track === 'trading' ? 'info' : 'success'} />,
    },
    { key: 'product_name', header: 'Produk' },
    { key: 'balance_kg', header: 'Stok', render: (row) => formatKg(row.balance_kg) },
    { key: 'age_hours', header: 'Umur', render: (row) => formatAge(row.age_hours) },
    { key: 'max_holding_hours', header: 'Ambang', render: (row) => (row.max_holding_hours !== null ? `${row.max_holding_hours} jam` : '-') },
  ];

  const policyColumns: DataTableColumn<PolicyRow>[] = [
    { key: 'product', header: 'Produk', render: (row) => row.product?.name ?? '-' },
    {
      key: 'track',
      header: 'Track',
      render: (row) => <StatusBadge label={row.track === 'trading' ? 'Trading' : 'Budidaya'} tone={row.track === 'trading' ? 'info' : 'success'} />,
    },
    { key: 'max_holding_hours', header: 'Max Holding', render: (row) => `${row.max_holding_hours} jam` },
  ];

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Laporan Risiko FEFO</h1>
        <p className="text-sm text-app-muted">
          Ringkasan stok yang sudah lewat ambang holding, lintas semua site yang bisa Anda akses.
        </p>
      </div>

      {riskError && (
        <AlertBanner variant="danger" title="Gagal memuat laporan">
          {riskError}
        </AlertBanner>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-app-text">Stok Berisiko (Lewat Ambang Holding)</h2>
        <DataTable
          columns={riskColumns}
          rows={riskRows}
          getRowId={(row) => row.batch_line_id}
          emptyLabel={
            loadingRisk
              ? 'Memuat...'
              : policies.length === 0
                ? 'Belum ada target holding diset — atur di Admin > Pengaturan Ambang supaya laporan ini bisa mendeteksi risiko.'
                : 'Tidak ada stok yang lewat ambang holding saat ini.'
          }
        />
      </div>

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <div>
          <h2 className="text-sm font-semibold text-app-text">Target Holding Saat Ini</h2>
          <p className="text-xs text-app-muted">
            Batas maksimum jam sebuah batch boleh mengendap sebelum ditandai berisiko, per produk per track. Untuk
            mengubah, buka <span className="text-app-text">Admin &gt; Pengaturan Ambang</span>.
          </p>
        </div>

        <DataTable
          columns={policyColumns}
          rows={policies}
          getRowId={(row) => row.id}
          emptyLabel={loadingPolicies ? 'Memuat...' : 'Belum ada target holding diset untuk produk manapun.'}
        />
      </div>
    </div>
  );
}
