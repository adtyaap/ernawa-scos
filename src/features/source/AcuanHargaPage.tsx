import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge, type BadgeTone } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency, todayLocalDate } from '../../lib/format';
import type { Product, Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

type PriceSource = 'override' | 'vwap7_site' | 'vwap7_all_site' | 'vwap30_all_site' | 'none';

const SOURCE_LABEL: Record<PriceSource, string> = {
  override: 'Override manual hari ini',
  vwap7_site: 'VWAP 7 hari (site ini)',
  vwap7_all_site: 'VWAP 7 hari (semua site)',
  vwap30_all_site: 'VWAP 30 hari (semua site)',
  none: 'Belum ada data',
};

const SOURCE_TONE: Record<PriceSource, BadgeTone> = {
  override: 'info',
  vwap7_site: 'success',
  vwap7_all_site: 'success',
  vwap30_all_site: 'warning',
  none: 'danger',
};

interface TodayOverrideRow {
  id: string;
  price: number;
  product: { name: string } | null;
  site: { name: string } | null;
}

// Acuan harga BELI, dihitung dari riwayat penerimaan (receiving_lots), BUKAN
// dari transaksi jual — satu delivery bisa berisi lebih dari satu produk
// sekaligus (migration 0026), jadi tidak ada cara akurat memecah nilai jual
// per produk tanpa mengarang asumsi. Fallback chain (ref_price(), migration
// 0028): override manual hari ini -> VWAP7 site ini -> VWAP7 semua site ->
// VWAP30 semua site -> tidak ada data (NULL, bukan 0). "Harga katalog statis"
// SENGAJA tidak ada — tidak ada tabel katalog harga di skema ini, menambahkan
// nilai isian akan jadi karangan tanpa data riil.
export function AcuanHargaPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [sites, setSites] = useState<Site[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [todayOverrides, setTodayOverrides] = useState<TodayOverrideRow[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [siteId, setSiteId] = useState('');
  const [productId, setProductId] = useState('');
  const [result, setResult] = useState<{ price: number | null; source: PriceSource } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [overrideAmount, setOverrideAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadOverridesToday() {
    const { data } = await supabase
      .from('price_today')
      .select('id, price, product:products(name), site:sites(name)')
      .eq('effective_date', todayLocalDate())
      .order('created_at', { ascending: false });
    setTodayOverrides((data as unknown as TodayOverrideRow[]) ?? []);
  }

  useEffect(() => {
    async function loadMaster() {
      const [{ data: siteData }, { data: productData }] = await Promise.all([
        supabase.from('sites').select('id, name, type').order('name'),
        supabase.from('products').select('id, name').order('name'),
      ]);
      setSites((siteData as Site[]) ?? []);
      setProducts((productData as Product[]) ?? []);
      setLoadingMaster(false);
    }
    loadMaster();
    loadOverridesToday();
  }, []);

  async function handleCheck() {
    if (!siteId || !productId || checking) return;
    setChecking(true);
    setCheckError(null);
    setResult(null);

    const { data, error } = await supabase.rpc('ref_price', { p_product_id: productId, p_site_id: siteId }).single();

    setChecking(false);

    if (error) {
      setCheckError(error.message);
      return;
    }
    setResult(data as { price: number | null; source: PriceSource });
  }

  async function handleSetOverride() {
    const amount = Number(overrideAmount);
    if (!siteId || !productId || !amount || submitting) return;

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase
      .from('price_today')
      .upsert(
        { product_id: productId, site_id: siteId, price: amount, effective_date: todayLocalDate() },
        { onConflict: 'product_id,site_id,effective_date' },
      );

    setSubmitting(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: `Override hari ini diset ke ${formatCurrency(amount)}/kg.` });
    setOverrideAmount('');
    await Promise.all([loadOverridesToday(), handleCheck()]);
  }

  const overrideColumns: DataTableColumn<TodayOverrideRow>[] = [
    { key: 'product', header: 'Produk', render: (row) => row.product?.name ?? '-' },
    { key: 'site', header: 'Site', render: (row) => row.site?.name ?? '-' },
    { key: 'price', header: 'Harga/kg', render: (row) => formatCurrency(row.price) },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Source &gt; Acuan Harga</h1>
        <p className="text-sm text-app-muted">
          Acuan harga beli per produk per site, dari override manual hari ini atau rata-rata tertimbang (VWAP)
          transaksi penerimaan terkini.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
          {feedback.message}
        </AlertBanner>
      )}

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Site *</span>
            <select
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                setResult(null);
              }}
              className={inputClass}
              disabled={loadingMaster}
            >
              <option value="">Pilih site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.type})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Produk *</span>
            <select
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setResult(null);
              }}
              className={inputClass}
              disabled={loadingMaster}
            >
              <option value="">Pilih produk</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={handleCheck}
          disabled={!siteId || !productId || checking}
          className="rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {checking ? 'Menghitung...' : 'Cek Acuan Harga'}
        </button>

        {checkError && (
          <AlertBanner variant="danger" title="Gagal menghitung">
            {checkError}
          </AlertBanner>
        )}

        {result && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-app-border p-3">
            <span className="text-lg font-semibold text-app-text">
              {result.price !== null ? `${formatCurrency(result.price)}/kg` : 'Tidak ada data'}
            </span>
            <StatusBadge label={SOURCE_LABEL[result.source]} tone={SOURCE_TONE[result.source]} />
          </div>
        )}

        {isOwner && siteId && productId && (
          <div className="space-y-2 border-t border-app-border pt-3">
            <span className="text-xs font-medium text-app-muted">Set Override Manual Hari Ini (Rp/kg)</span>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                step="1"
                value={overrideAmount}
                onChange={(e) => setOverrideAmount(e.target.value)}
                className={inputClass}
                placeholder="Mis. 350000"
              />
              <button
                type="button"
                onClick={handleSetOverride}
                disabled={!overrideAmount || submitting}
                className="whitespace-nowrap rounded-md border border-app-border px-4 py-2 text-sm font-medium text-app-text hover:bg-app-soft disabled:opacity-40"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Override'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-app-text">Override Manual Aktif Hari Ini</h2>
        <DataTable
          columns={overrideColumns}
          rows={todayOverrides}
          getRowId={(row) => row.id}
          emptyLabel="Belum ada override manual hari ini — acuan dihitung dari VWAP."
        />
      </div>
    </div>
  );
}
