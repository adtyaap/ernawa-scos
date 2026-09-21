import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { todayLocalDate } from '../../lib/format';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import type { Product, Site, Supplier, Tank } from '../../types/domain';

// Halaman ini cuma butuh id+name supplier untuk dropdown (tidak perlu
// created_at), jadi pakai Pick daripada memaksa fetch kolom yang tidak dipakai.
type SupplierOption = Pick<Supplier, 'id' | 'name'>;

interface LotDraft {
  key: string;
  product_id: string;
  qty_kg: string;
  buy_price_per_kg: string;
}

function newLotDraft(): LotDraft {
  return { key: crypto.randomUUID(), product_id: '', qty_kg: '', buy_price_per_kg: '' };
}

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-app-muted">{label}</span>
      {children}
    </label>
  );
}

// Form "Terima Cepat": mencatat receiving_transactions + receiving_lots
// (bisa >1 produk per transaksi), lalu membentuk batch dan batch_lines
// seperlunya.
//
// CATATAN: form ini menambahkan field "Tank" yang tidak disebut eksplisit
// di permintaan awal ("pilih supplier, site, tanggal") — tapi wajib ada
// karena batches.tank_id NOT NULL dan get_or_create_batch() butuh
// p_tank_id. Tanpa ini alur tidak bisa jalan sama sekali.
//
// ATOMIK (migration 0010): submit ini SATU panggilan RPC
// create_receiving_with_batch — insert receiving_transactions,
// receiving_lots, get_or_create_batch(), dan batch_lines semuanya jadi satu
// transaksi DB all-or-nothing. Gap non-atomicity yang dulu dicatat di
// CLAUDE.md "Catatan Tech Debt" sudah ditutup lewat ini — tidak ada lagi
// kemungkinan data parsial (transaksi tanpa lot/batch_lines) kalau gagal
// di tengah jalan.
export function TerimaCepatPage() {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [supplierId, setSupplierId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [tankId, setTankId] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayLocalDate);
  const [lots, setLots] = useState<LotDraft[]>([newLotDraft()]);

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  useEffect(() => {
    async function loadMaster() {
      const [{ data: supplierData }, { data: siteData }, { data: productData }] = await Promise.all([
        supabase.from('suppliers').select('id, name').eq('status', 'aktif').order('name'),
        supabase.from('sites').select('id, name, type').order('name'),
        supabase.from('products').select('id, name').order('name'),
      ]);

      setSuppliers(supplierData ?? []);
      setSites(siteData ?? []);
      setProducts(productData ?? []);
      setLoadingMaster(false);
    }

    loadMaster();
  }, []);

  useEffect(() => {
    if (!siteId) {
      setTanks([]);
      setTankId('');
      return;
    }

    async function loadTanks() {
      const { data } = await supabase.from('tanks').select('id, site_id, name').eq('site_id', siteId).order('name');
      setTanks(data ?? []);
      setTankId('');
    }

    loadTanks();
  }, [siteId]);

  const validLots = useMemo(
    () => lots.filter((lot) => lot.product_id && Number(lot.qty_kg) > 0 && Number(lot.buy_price_per_kg) > 0),
    [lots],
  );

  const isFormValid = Boolean(supplierId && siteId && tankId && transactionDate && validLots.length > 0);

  function updateLot(key: string, patch: Partial<LotDraft>) {
    setLots((prev) => prev.map((lot) => (lot.key === key ? { ...lot, ...patch } : lot)));
  }

  function addLotRow() {
    setLots((prev) => [...prev, newLotDraft()]);
  }

  function removeLotRow(key: string) {
    setLots((prev) => (prev.length > 1 ? prev.filter((lot) => lot.key !== key) : prev));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isFormValid || submitting) return;

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.rpc('create_receiving_with_batch', {
      p_supplier_id: supplierId,
      p_site_id: siteId,
      p_tank_id: tankId,
      p_transaction_date: transactionDate,
      p_lots: validLots.map((lot) => ({
        product_id: lot.product_id,
        qty_kg: Number(lot.qty_kg),
        buy_price_per_kg: Number(lot.buy_price_per_kg),
      })),
    });

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    setFeedback({ variant: 'success', message: 'Penerimaan berhasil dicatat.' });
    setLots([newLotDraft()]);
    setSubmitting(false);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Terima Cepat</h1>
        <p className="text-sm text-app-muted">
          Catat penerimaan dari nelayan/pengepul. Batch dibentuk otomatis oleh sistem.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
          {feedback.message}
        </AlertBanner>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-app-border bg-app-panel p-4 sm:grid-cols-2">
          <Field label="Supplier">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={inputClass}
              disabled={loadingMaster}
            >
              <option value="">Pilih supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Site">
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass} disabled={loadingMaster}>
              <option value="">Pilih site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.type})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tank">
            <select value={tankId} onChange={(e) => setTankId(e.target.value)} className={inputClass} disabled={!siteId}>
              <option value="">{siteId ? 'Pilih tank' : 'Pilih site dulu'}</option>
              {tanks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tanggal Terima">
            <input
              type="date"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-app-text">Produk Diterima</h2>
            <button
              type="button"
              onClick={addLotRow}
              className="flex items-center gap-1 text-xs font-medium text-app-accent hover:underline"
            >
              <Plus size={14} /> Tambah produk
            </button>
          </div>

          {lots.map((lot) => (
            <div
              key={lot.key}
              className="grid grid-cols-1 gap-3 border-t border-app-border pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[2fr_1fr_1fr_auto]"
            >
              <select
                value={lot.product_id}
                onChange={(e) => updateLot(lot.key, { product_id: e.target.value })}
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
              <input
                type="number"
                min="0"
                step="0.001"
                placeholder="Qty (kg)"
                value={lot.qty_kg}
                onChange={(e) => updateLot(lot.key, { qty_kg: e.target.value })}
                className={inputClass}
              />
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Harga beli/kg"
                value={lot.buy_price_per_kg}
                onChange={(e) => updateLot(lot.key, { buy_price_per_kg: e.target.value })}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => removeLotRow(lot.key)}
                disabled={lots.length === 1}
                className="flex items-center justify-center rounded-md border border-app-border p-2 text-app-danger hover:bg-app-danger/10 disabled:opacity-30"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={!isFormValid || submitting}
          className="rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {submitting ? 'Menyimpan...' : 'Simpan Penerimaan'}
        </button>
      </form>
    </div>
  );
}
