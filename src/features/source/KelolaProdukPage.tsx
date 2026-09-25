import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import type { Product } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

// Produk (jenis lobster) dipakai di hampir semua modul (Terima Cepat, Import
// Excel, Demand, Alokasi & Kirim, Acuan Harga, dst.) tapi sebelumnya cuma bisa
// dibaca (dropdown) -- tidak ada UI untuk menambah jenis baru, sama seperti
// gap Kelola Tank sebelum halaman itu dibuat. RLS insert/update owner-only
// (products_insert/products_update, sudah ada sejak awal, tidak perlu
// migration baru). Tidak ada policy DELETE dan tidak ada kolom status --
// tidak ada aksi hapus, cuma ubah nama (Edit), konsisten dengan pola
// Kelola Tank/Customer/Supplier Management.
export function KelolaProdukPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [formName, setFormName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadProducts() {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase.from('products').select('id, name').order('name');

    if (error) {
      setLoadError(error.message);
    } else {
      setProducts((data as Product[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
  }, []);

  function resetForm() {
    setEditingId(null);
    setFormName('');
  }

  function startEdit(product: Product) {
    setEditingId(product.id);
    setFormName(product.name);
    setFormFeedback(null);
  }

  function cancelEdit() {
    resetForm();
    setFormFeedback(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = formName.trim();
    if (!trimmedName || submitting) return;

    setSubmitting(true);
    setFormFeedback(null);

    const { error } = editingId
      ? await supabase.from('products').update({ name: trimmedName }).eq('id', editingId)
      : await supabase.from('products').insert({ name: trimmedName });

    if (error) {
      setFormFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    setFormFeedback({
      variant: 'success',
      message: editingId ? 'Produk berhasil diperbarui.' : 'Produk berhasil ditambahkan.',
    });
    resetForm();
    setSubmitting(false);
    await loadProducts();
  }

  const columns: DataTableColumn<Product>[] = [
    { key: 'name', header: 'Nama Produk' },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: Product) => (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  className="rounded px-3 py-2 text-xs font-medium text-app-accent hover:bg-app-accent/10"
                >
                  Edit
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const visibleProducts = products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Source &gt; Kelola Produk</h1>
        <p className="text-sm text-app-muted">
          Daftar jenis produk (lobster). Dipakai di Terima Cepat, Import Excel, Demand, Alokasi & Kirim, dan Acuan
          Harga.
        </p>
      </div>

      {isOwner && (
        <div className="space-y-3 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
          <h2 className="text-sm font-semibold text-app-text">{editingId ? 'Ubah Nama Produk' : 'Tambah Produk Baru'}</h2>

          {formFeedback && (
            <AlertBanner
              variant={formFeedback.variant}
              title={formFeedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}
            >
              {formFeedback.message}
            </AlertBanner>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Nama Produk *</span>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className={inputClass}
                placeholder="Mis. LOBSTER MUTIARA SIZE 300-500 (LIVE)"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!formName.trim() || submitting}
                className="flex items-center gap-1.5 rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {!editingId && <Plus size={14} />}
                {submitting ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Tambah'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-md border border-app-border px-4 py-2 text-sm font-medium text-app-muted hover:bg-app-soft"
                >
                  Batal
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat daftar produk">
          {loadError}
        </AlertBanner>
      )}

      <label className="block max-w-sm space-y-1">
        <span className="text-xs font-medium text-app-muted">Cari produk</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={inputClass}
          placeholder="Mis. BAMBU 200-300"
        />
      </label>

      <DataTable
        columns={columns}
        rows={visibleProducts}
        getRowId={(row) => row.id}
        emptyLabel={loading ? 'Memuat...' : search ? 'Tidak ada produk yang cocok.' : 'Belum ada produk.'}
      />
    </div>
  );
}
