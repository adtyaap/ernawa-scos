import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface CategoryRow {
  id: string;
  name: string;
}

// Kategori opex (sewa, gaji, listrik, dll) dikelola Owner sendiri lewat UI
// ini, bukan daftar tetap di-hardcode (migration 0042) -- pola identik
// KelolaTankPage/KelolaProdukPage: siapa saja bisa lihat (dropdown di Kas &
// Bank Perusahaan), cuma Owner yang bisa tambah/ubah nama. Tidak ada aksi
// hapus (tidak ada policy DELETE), konsisten pola master-data lain.
export function KelolaKategoriOpexPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadCategories() {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase.from('opex_categories').select('id, name').order('name');

    if (error) {
      setLoadError(error.message);
    } else {
      setCategories((data as CategoryRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCategories();
  }, []);

  function resetForm() {
    setEditingId(null);
    setFormName('');
  }

  function startEdit(row: CategoryRow) {
    setEditingId(row.id);
    setFormName(row.name);
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
      ? await supabase.from('opex_categories').update({ name: trimmedName }).eq('id', editingId)
      : await supabase.from('opex_categories').insert({ name: trimmedName });

    if (error) {
      setFormFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    setFormFeedback({
      variant: 'success',
      message: editingId ? 'Kategori berhasil diperbarui.' : 'Kategori berhasil ditambahkan.',
    });
    resetForm();
    setSubmitting(false);
    await loadCategories();
  }

  const columns: DataTableColumn<CategoryRow>[] = [
    { key: 'name', header: 'Nama Kategori' },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: CategoryRow) => (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => startEdit(row)}
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
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Kelola Kategori Opex</h1>
        <p className="text-sm text-app-muted">
          Daftar kategori biaya operasional (sewa, gaji, listrik, dst). Dipakai saat mencatat transaksi Opex di Kas &amp; Bank Perusahaan.
        </p>
      </div>

      {isOwner && (
        <div className="space-y-3 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
          <h2 className="text-sm font-semibold text-app-text">{editingId ? 'Ubah Nama Kategori' : 'Tambah Kategori Baru'}</h2>

          {formFeedback && (
            <AlertBanner variant={formFeedback.variant} title={formFeedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
              {formFeedback.message}
            </AlertBanner>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Nama Kategori *</span>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className={inputClass}
                placeholder="Mis. Sewa Kantor"
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
        <AlertBanner variant="danger" title="Gagal memuat daftar kategori">
          {loadError}
        </AlertBanner>
      )}

      <DataTable columns={columns} rows={categories} getRowId={(row) => row.id} emptyLabel={loading ? 'Memuat...' : 'Belum ada kategori.'} />
    </div>
  );
}
