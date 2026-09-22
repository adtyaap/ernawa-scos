import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatKg } from '../../lib/format';
import type { FefoRiskRow, Product, Track } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

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

// Laporan Risiko FEFO lintas-site + Kelola Target Holding (migration 0032).
// Badge "lewat ambang holding" sudah ada sejak migration 0008
// (get_available_batch_lines), tapi cuma per-site di dalam form Alokasi &
// Kirim -- tidak ada ringkasan "produk apa saja yang berisiko sekarang" di
// SELURUH site sekaligus, dan ambangnya sendiri (product_holding_policy)
// sama sekali tidak ada UI untuk diubah owner (cuma bisa lewat SQL manual).
//
// PENTING: sebelum halaman ini ada, product_holding_policy KOSONG di
// produksi -- artinya fitur "lewat ambang holding" belum pernah benar-benar
// aktif (max_holding_hours selalu NULL -> is_overdue selalu false di mana
// pun). Owner WAJIB mengisi target di bawah dulu supaya laporan ini berguna.
export function FefoRiskReportPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [riskRows, setRiskRows] = useState<FefoRiskRow[]>([]);
  const [loadingRisk, setLoadingRisk] = useState(true);
  const [riskError, setRiskError] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);

  const [formProductId, setFormProductId] = useState('');
  const [formTrack, setFormTrack] = useState<Track>('trading');
  const [formHours, setFormHours] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

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

  useEffect(() => {
    async function loadMaster() {
      const { data } = await supabase.from('products').select('id, name').order('name');
      setProducts((data as Product[]) ?? []);
    }
    loadMaster();
    loadRisk();
    loadPolicies();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const hours = Number(formHours);
    if (!formProductId || !hours || hours <= 0 || submitting) return;

    setSubmitting(true);
    setFormFeedback(null);

    const { error } = await supabase
      .from('product_holding_policy')
      .upsert(
        { product_id: formProductId, track: formTrack, max_holding_hours: Math.round(hours) },
        { onConflict: 'product_id,track' },
      );

    setSubmitting(false);

    if (error) {
      setFormFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFormFeedback({ variant: 'success', message: 'Target holding berhasil disimpan.' });
    setFormHours('');
    await Promise.all([loadPolicies(), loadRisk()]);
  }

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
                ? 'Belum ada target holding diset — isi dulu di bawah supaya laporan ini bisa mendeteksi risiko.'
                : 'Tidak ada stok yang lewat ambang holding saat ini.'
          }
        />
      </div>

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel p-4">
        <h2 className="text-sm font-semibold text-app-text">Kelola Target Holding</h2>
        <p className="text-xs text-app-muted">
          Batas maksimum jam sebuah batch boleh mengendap sebelum ditandai berisiko, per produk per track.
        </p>

        {isOwner && (
          <>
            {formFeedback && (
              <AlertBanner
                variant={formFeedback.variant}
                title={formFeedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}
              >
                {formFeedback.message}
              </AlertBanner>
            )}
            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-app-muted">Produk *</span>
                <select value={formProductId} onChange={(e) => setFormProductId(e.target.value)} className={inputClass}>
                  <option value="">Pilih produk</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-app-muted">Track *</span>
                <select value={formTrack} onChange={(e) => setFormTrack(e.target.value as Track)} className={inputClass}>
                  <option value="trading">Trading</option>
                  <option value="budidaya">Budidaya</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-app-muted">Max Jam *</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={formHours}
                  onChange={(e) => setFormHours(e.target.value)}
                  className={inputClass}
                  placeholder="Mis. 48"
                />
              </label>
              <button
                type="submit"
                disabled={!formProductId || !formHours || submitting}
                className="rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
              >
                {submitting ? 'Menyimpan...' : 'Simpan'}
              </button>
            </form>
          </>
        )}

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
