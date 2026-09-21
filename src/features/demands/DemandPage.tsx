import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge, type BadgeTone } from '../../components/shared/StatusBadge';
import { formatCurrency, formatKg } from '../../lib/format';
import type { Customer, Product } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

type CustomerOption = Pick<Customer, 'id' | 'name'>;

const DEMAND_STATUSES = ['open', 'partial', 'allocated', 'fulfilled', 'cancelled'] as const;
type DemandStatus = (typeof DEMAND_STATUSES)[number];

const STATUS_LABEL: Record<DemandStatus, string> = {
  open: 'Open',
  partial: 'Sebagian',
  allocated: 'Allocated',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<DemandStatus, BadgeTone> = {
  open: 'neutral',
  partial: 'info',
  allocated: 'warning',
  fulfilled: 'success',
  cancelled: 'danger',
};

interface DemandRow {
  id: string;
  requested_qty_kg: number;
  expected_price_per_kg: number | null;
  needed_by: string | null;
  status: string;
  allocated_kg?: number;
  customer: { name: string } | null;
  product: { name: string } | null;
}

// CATATAN (dari pengguna): demands TIDAK punya site_id — pemilihan
// site/track baru terjadi di tahap Alokasi & Kirim nanti, bukan di sini.
// Form ini murni: customer, produk, qty, harga ekspektasi (opsional),
// tanggal dibutuhkan (opsional). Status transisi ('allocated'/'fulfilled')
// seharusnya didorong otomatis oleh tahap Alokasi & Kirim / Konfirmasi
// Timbang nanti — bukan diedit manual di sini. Field status di form edit
// cuma untuk OWNER (mis. koreksi/pembatalan manual), non-owner tidak
// pernah melihat form edit sama sekali (pola sama seperti Supplier/Customer
// Management).
export function DemandPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  const [demands, setDemands] = useState<DemandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formCustomerId, setFormCustomerId] = useState('');
  const [formProductId, setFormProductId] = useState('');
  const [formQtyKg, setFormQtyKg] = useState('');
  const [formExpectedPrice, setFormExpectedPrice] = useState('');
  const [formNeededBy, setFormNeededBy] = useState('');
  const [formStatus, setFormStatus] = useState<DemandStatus>('open');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  useEffect(() => {
    async function loadMaster() {
      const [{ data: customerData }, { data: productData }] = await Promise.all([
        supabase.from('customers').select('id, name').eq('status', 'aktif').order('name'),
        supabase.from('products').select('id, name').order('name'),
      ]);

      setCustomers(customerData ?? []);
      setProducts(productData ?? []);
      setLoadingMaster(false);
    }

    loadMaster();
  }, []);

  async function loadDemands() {
    setLoading(true);
    setLoadError(null);

    const [{ data, error }, { data: fulfillmentData }] = await Promise.all([
      supabase
        .from('demands')
        .select('id, requested_qty_kg, expected_price_per_kg, needed_by, status, customer:customers(name), product:products(name)')
        .order('created_at', { ascending: false }),
      // Total teralokasi dihitung di DB (v_demands_with_fulfillment, migration
      // 0019) — demand global tapi alokasi ter-scope per site, jadi tidak
      // boleh dijumlahkan di browser dari data yang terlihat user.
      supabase.from('v_demands_with_fulfillment').select('demand_id, allocated_kg'),
    ]);

    if (error) {
      setLoadError(error.message);
    } else {
      const allocated = new Map(
        ((fulfillmentData as { demand_id: string; allocated_kg: number }[] | null) ?? []).map((f) => [f.demand_id, Number(f.allocated_kg)]),
      );
      const rows = ((data as unknown as DemandRow[]) ?? []).map((row) => ({ ...row, allocated_kg: allocated.get(row.id) }));
      setDemands(rows);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadDemands();
  }, []);

  function resetForm() {
    setEditingId(null);
    setFormCustomerId('');
    setFormProductId('');
    setFormQtyKg('');
    setFormExpectedPrice('');
    setFormNeededBy('');
    setFormStatus('open');
  }

  function cancelEdit() {
    resetForm();
    setFormFeedback(null);
  }

  async function startEdit(id: string) {
    // Ambil baris mentah (bukan hasil join) supaya field form terisi id,
    // bukan nama hasil embed.
    const { data, error } = await supabase
      .from('demands')
      .select('id, customer_id, product_id, requested_qty_kg, expected_price_per_kg, needed_by, status')
      .eq('id', id)
      .single();

    if (error || !data) {
      setFormFeedback({ variant: 'danger', message: error?.message ?? 'Gagal memuat data demand.' });
      return;
    }

    setEditingId(data.id);
    setFormCustomerId(data.customer_id);
    setFormProductId(data.product_id);
    setFormQtyKg(String(data.requested_qty_kg));
    setFormExpectedPrice(data.expected_price_per_kg ? String(data.expected_price_per_kg) : '');
    setFormNeededBy(data.needed_by ? data.needed_by.slice(0, 10) : '');
    setFormStatus((data.status as DemandStatus) ?? 'open');
    setFormFeedback(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const qty = Number(formQtyKg);
    if (!formCustomerId || !formProductId || !formQtyKg.trim() || qty <= 0) {
      setFormFeedback({
        variant: 'danger',
        message: 'Customer, produk, dan qty (harus lebih dari 0) wajib diisi.',
      });
      return;
    }

    // Mencerminkan CHECK (expected_price_per_kg IS NULL OR expected_price_per_kg > 0)
    let expectedPrice: number | null = null;
    if (formExpectedPrice.trim()) {
      const parsedPrice = Number(formExpectedPrice);
      if (parsedPrice <= 0) {
        setFormFeedback({ variant: 'danger', message: 'Harga ekspektasi harus lebih dari 0 kalau diisi.' });
        return;
      }
      expectedPrice = parsedPrice;
    }

    setSubmitting(true);
    setFormFeedback(null);

    const { data: userData } = await supabase.auth.getUser();

    const payload = {
      customer_id: formCustomerId,
      product_id: formProductId,
      requested_qty_kg: qty,
      expected_price_per_kg: expectedPrice,
      needed_by: formNeededBy || null,
    };

    // Edit: cuma owner yang pernah sampai ke sini (tombol Edit owner-only),
    // dan trigger fn_demands_restrict_field_update mengizinkan owner mengubah
    // kolom apa saja termasuk status.
    const { error } = editingId
      ? await supabase.from('demands').update({ ...payload, status: formStatus }).eq('id', editingId)
      : await supabase.from('demands').insert({ ...payload, created_by: userData.user?.id });

    if (error) {
      setFormFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    setFormFeedback({
      variant: 'success',
      message: editingId ? 'Demand berhasil diperbarui.' : 'Demand berhasil dicatat.',
    });
    resetForm();
    setSubmitting(false);

    // Reload dari Supabase, BUKAN optimistic update lokal.
    await loadDemands();
  }

  const columns: DataTableColumn<DemandRow>[] = [
    { key: 'customer', header: 'Customer', render: (row) => row.customer?.name ?? '-' },
    { key: 'product', header: 'Produk', render: (row) => row.product?.name ?? '-' },
    { key: 'requested_qty_kg', header: 'Qty', render: (row) => formatKg(row.requested_qty_kg) },
    {
      key: 'allocated_kg',
      header: 'Teralokasi',
      render: (row) =>
        row.allocated_kg === undefined
          ? '-'
          : `${formatKg(row.allocated_kg)}${row.allocated_kg < row.requested_qty_kg && row.allocated_kg > 0 ? ` (sisa ${formatKg(row.requested_qty_kg - row.allocated_kg)})` : ''}`,
    },
    {
      key: 'expected_price_per_kg',
      header: 'Harga Ekspektasi',
      render: (row) => (row.expected_price_per_kg ? `${formatCurrency(row.expected_price_per_kg)}/kg` : '-'),
    },
    {
      key: 'needed_by',
      header: 'Dibutuhkan',
      render: (row) =>
        row.needed_by
          ? new Date(row.needed_by).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
          : '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const status = (row.status as DemandStatus) in STATUS_LABEL ? (row.status as DemandStatus) : null;
        return status ? (
          <StatusBadge label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />
        ) : (
          <StatusBadge label={row.status} tone="neutral" />
        );
      },
    },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: DemandRow) => (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => startEdit(row.id)}
                  className="rounded px-2 py-1 text-xs font-medium text-app-accent hover:bg-app-accent/10"
                >
                  Edit
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Deliver &gt; Demand Baru</h1>
        <p className="text-sm text-app-muted">
          Catat permintaan dari customer. Pemilihan site/track dilakukan belakangan di tahap Alokasi & Kirim.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4">
        <h2 className="text-sm font-semibold text-app-text">{editingId ? 'Edit Demand' : 'Tambah Demand Baru'}</h2>

        {formFeedback && (
          <AlertBanner
            variant={formFeedback.variant}
            title={formFeedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}
          >
            {formFeedback.message}
          </AlertBanner>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Customer *</span>
              <select
                value={formCustomerId}
                onChange={(e) => setFormCustomerId(e.target.value)}
                className={inputClass}
                disabled={loadingMaster}
              >
                <option value="">Pilih customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Produk *</span>
              <select
                value={formProductId}
                onChange={(e) => setFormProductId(e.target.value)}
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

            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Qty (kg) *</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={formQtyKg}
                onChange={(e) => setFormQtyKg(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Harga Ekspektasi/kg</span>
              <input
                type="number"
                min="0"
                step="1"
                value={formExpectedPrice}
                onChange={(e) => setFormExpectedPrice(e.target.value)}
                className={inputClass}
                placeholder="Opsional"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Tanggal Dibutuhkan</span>
              <input
                type="date"
                value={formNeededBy}
                onChange={(e) => setFormNeededBy(e.target.value)}
                className={inputClass}
              />
            </label>

            {editingId && (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-app-muted">Status (owner)</span>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as DemandStatus)}
                  className={inputClass}
                >
                  {DEMAND_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!formCustomerId || !formProductId || !formQtyKg.trim() || submitting}
              className="flex items-center gap-1.5 rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              {!editingId && <Plus size={14} />}
              {submitting ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Tambah'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md border border-app-border px-4 py-2 text-sm font-medium text-app-muted hover:bg-white/5"
              >
                Batal
              </button>
            )}
          </div>
        </form>
      </div>

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat daftar demand">
          {loadError}
        </AlertBanner>
      )}

      <DataTable
        columns={columns}
        rows={demands}
        getRowId={(row) => row.id}
        emptyLabel={loading ? 'Memuat...' : 'Belum ada demand.'}
      />
    </div>
  );
}
