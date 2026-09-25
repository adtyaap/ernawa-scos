import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import type { Supplier } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

// Kolom suppliers: id/name/contact_person/phone/address/status/created_at
// (migrations/0001 + 0005). Masih TIDAK ADA policy DELETE untuk role
// manapun — status ('aktif'/'nonaktif') adalah pengganti resmi fungsi
// delete (lihat komentar migration 0005), jadi tidak ada tombol Hapus di
// halaman ini, diganti toggle Nonaktifkan/Aktifkan.
//
// CATATAN DESAIN: toggle butuh label dinamis per baris ("Nonaktifkan" vs
// "Aktifkan"), yang tidak didukung DataTable.onEdit/onDelete (label-nya
// hardcoded "Edit"/"Hapus"). Mengubah DataTable.tsx di luar scope task ini,
// jadi kolom "Aksi" (Edit + toggle) dibangun manual lewat `render` pada satu
// kolom kustom, dimasukkan ke array `columns` HANYA kalau isOwner — hasil
// akhirnya sama seperti pola onEdit sebelumnya (kolom itu benar-benar tidak
// ada untuk role lain, bukan cuma disembunyikan/didisable).
export function SourcePage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formContactPerson, setFormContactPerson] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPaymentTermDays, setFormPaymentTermDays] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  const [tableFeedback, setTableFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function loadSuppliers() {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('suppliers')
      .select('id, name, contact_person, phone, address, status, created_at, payment_term_days')
      .order('created_at', { ascending: false });

    if (error) {
      setLoadError(error.message);
    } else {
      setSuppliers((data as Supplier[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadSuppliers();
  }, []);

  function resetForm() {
    setEditingId(null);
    setFormName('');
    setFormContactPerson('');
    setFormPhone('');
    setFormAddress('');
    setFormPaymentTermDays('');
  }

  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    setFormName(supplier.name);
    setFormContactPerson(supplier.contact_person ?? '');
    setFormPhone(supplier.phone ?? '');
    setFormAddress(supplier.address ?? '');
    setFormPaymentTermDays(supplier.payment_term_days !== null ? String(supplier.payment_term_days) : '');
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

    const payload = {
      name: trimmedName,
      contact_person: formContactPerson.trim() || null,
      phone: formPhone.trim() || null,
      address: formAddress.trim() || null,
      payment_term_days: formPaymentTermDays.trim() === '' ? null : Number(formPaymentTermDays),
    };

    const { error } = editingId
      ? await supabase.from('suppliers').update(payload).eq('id', editingId)
      : await supabase.from('suppliers').insert(payload);

    if (error) {
      // Termasuk kasus RLS menolak (mis. field staff mencoba UPDATE) —
      // pesan error Supabase/Postgres ditampilkan apa adanya, bukan silent fail.
      setFormFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    setFormFeedback({
      variant: 'success',
      message: editingId ? 'Supplier berhasil diperbarui.' : 'Supplier berhasil ditambahkan.',
    });
    resetForm();
    setSubmitting(false);

    // Reload dari Supabase, BUKAN optimistic update lokal.
    await loadSuppliers();
  }

  async function handleToggleStatus(supplier: Supplier) {
    if (togglingId) return;
    const nextStatus: Supplier['status'] = supplier.status === 'aktif' ? 'nonaktif' : 'aktif';

    setTogglingId(supplier.id);
    setTableFeedback(null);

    const { error } = await supabase.from('suppliers').update({ status: nextStatus }).eq('id', supplier.id);

    if (error) {
      setTableFeedback({ variant: 'danger', message: error.message });
      setTogglingId(null);
      return;
    }

    setTableFeedback({
      variant: 'success',
      message: `Supplier "${supplier.name}" berhasil di${nextStatus === 'nonaktif' ? 'nonaktifkan' : 'aktifkan'}.`,
    });
    setTogglingId(null);

    // Reload dari Supabase, BUKAN optimistic update lokal.
    await loadSuppliers();
  }

  const columns: DataTableColumn<Supplier>[] = [
    { key: 'name', header: 'Nama Supplier' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge label={row.status === 'aktif' ? 'Aktif' : 'Nonaktif'} tone={row.status === 'aktif' ? 'success' : 'neutral'} />,
    },
    { key: 'contact_person', header: 'Kontak', render: (row) => row.contact_person ?? '-' },
    { key: 'phone', header: 'Telepon', render: (row) => row.phone ?? '-' },
    {
      key: 'payment_term_days',
      header: 'Termin Bayar',
      render: (row) => (row.payment_term_days !== null ? `${row.payment_term_days} hari` : 'Belum diklasifikasi'),
    },
    {
      key: 'created_at',
      header: 'Terdaftar',
      render: (row) =>
        new Date(row.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
    },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: Supplier) => (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  className="rounded px-3 py-2 text-xs font-medium text-app-accent hover:bg-app-accent/10"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleStatus(row)}
                  disabled={togglingId === row.id}
                  className={`rounded px-3 py-2 text-xs font-medium hover:bg-app-soft disabled:opacity-40 ${
                    row.status === 'aktif' ? 'text-app-danger' : 'text-app-success'
                  }`}
                >
                  {togglingId === row.id ? 'Memproses...' : row.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Source &gt; Supplier Management</h1>
        <p className="text-sm text-app-muted">Kelola daftar supplier/nelayan/pengepul.</p>
      </div>

      <div className="space-y-3 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <h2 className="text-sm font-semibold text-app-text">{editingId ? 'Edit Supplier' : 'Tambah Supplier Baru'}</h2>

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
              <span className="text-xs font-medium text-app-muted">Nama *</span>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className={inputClass}
                placeholder="Mis. Koperasi Nelayan Cilincing"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Kontak</span>
              <input
                type="text"
                value={formContactPerson}
                onChange={(e) => setFormContactPerson(e.target.value)}
                className={inputClass}
                placeholder="Nama narahubung (opsional)"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Telepon</span>
              <input
                type="tel"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                className={inputClass}
                placeholder="0812xxxxxxx (opsional)"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Alamat</span>
              <input
                type="text"
                value={formAddress}
                onChange={(e) => setFormAddress(e.target.value)}
                className={inputClass}
                placeholder="Opsional"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Termin Bayar (hari)</span>
              <input
                type="number"
                min="0"
                step="1"
                value={formPaymentTermDays}
                onChange={(e) => setFormPaymentTermDays(e.target.value)}
                className={inputClass}
                placeholder="0 = tunai di tempat, kosong = belum diklasifikasi"
              />
            </label>
          </div>

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

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat daftar supplier">
          {loadError}
        </AlertBanner>
      )}

      {tableFeedback && (
        <AlertBanner
          variant={tableFeedback.variant}
          title={tableFeedback.variant === 'success' ? 'Berhasil' : 'Gagal memperbarui status'}
        >
          {tableFeedback.message}
        </AlertBanner>
      )}

      <DataTable
        columns={columns}
        rows={suppliers}
        getRowId={(row) => row.id}
        emptyLabel={loading ? 'Memuat...' : 'Belum ada supplier.'}
      />
    </div>
  );
}
