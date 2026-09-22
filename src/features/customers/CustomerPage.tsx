import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import type { Customer, SettlementMode } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

// Kolom customers yang relevan untuk MVP ini: name, settlement_mode,
// payment_term_days, notes (migrations/0001 + 0006 + 0025). `acceptance_policy`
// (jsonb) SENGAJA TETAP DILEWATI — itu untuk kriteria terstruktur yang
// divalidasi sistem, bukan kebutuhan sekarang. `notes` (migration 0025) adalah
// catatan bebas per customer, murni informasional, TIDAK divalidasi sistem.
//
// Tidak ada policy DELETE untuk customers (sama seperti suppliers), jadi
// status ('aktif'/'nonaktif', migration 0014) adalah pengganti resmi
// fungsi hapus — pola sama seperti Supplier Management. Edit dan toggle
// status owner-only (customers_update). Customer nonaktif tetap tampil di
// daftar ini (riwayat utuh) tapi tidak muncul di dropdown halaman lain.
export function CustomerPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formSettlementMode, setFormSettlementMode] = useState<SettlementMode>('cod');
  const [formPaymentTermDays, setFormPaymentTermDays] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadCustomers() {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('customers')
      .select('id, name, settlement_mode, payment_term_days, status, notes')
      .order('name');

    if (error) {
      setLoadError(error.message);
    } else {
      setCustomers((data as Customer[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  function resetForm() {
    setEditingId(null);
    setFormName('');
    setFormSettlementMode('cod');
    setFormPaymentTermDays('');
    setFormNotes('');
  }

  function startEdit(customer: Customer) {
    setEditingId(customer.id);
    setFormName(customer.name);
    setFormSettlementMode(customer.settlement_mode);
    setFormPaymentTermDays(customer.payment_term_days ? String(customer.payment_term_days) : '');
    setFormNotes(customer.notes ?? '');
    setFormFeedback(null);
  }

  function cancelEdit() {
    resetForm();
    setFormFeedback(null);
  }

  // Kalau balik ke 'cod' setelah sempat isi Termin Hari, kosongkan
  // nilainya sekarang juga (bukan cuma dipaksa null saat submit) — supaya
  // field yang disembunyikan tidak diam-diam menyimpan nilai basi.
  function handleSettlementModeChange(mode: SettlementMode) {
    setFormSettlementMode(mode);
    if (mode === 'cod') {
      setFormPaymentTermDays('');
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = formName.trim();
    if (!trimmedName || submitting) return;

    // Validasi client-side ini SENGAJA mencerminkan persis
    // customers_term_days_check di DB (migration 0006):
    //   (settlement_mode = 'term' AND payment_term_days IS NOT NULL AND payment_term_days > 0)
    //   OR (settlement_mode = 'cod' AND payment_term_days IS NULL)
    // supaya user dapat pesan jelas sebelum submit, bukan cuma error mentah
    // dari Postgres kalau constraint-nya kena.
    let paymentTermDays: number | null = null;
    if (formSettlementMode === 'term') {
      const parsed = Number(formPaymentTermDays);
      if (!formPaymentTermDays.trim() || !Number.isInteger(parsed) || parsed <= 0) {
        setFormFeedback({
          variant: 'danger',
          message: 'Termin Hari wajib diisi angka bulat lebih dari 0 kalau Mode Settlement adalah Termin.',
        });
        return;
      }
      paymentTermDays = parsed;
    }

    setSubmitting(true);
    setFormFeedback(null);

    const payload = {
      name: trimmedName,
      settlement_mode: formSettlementMode,
      payment_term_days: paymentTermDays,
      notes: formNotes.trim() || null,
    };

    const { error } = editingId
      ? await supabase.from('customers').update(payload).eq('id', editingId)
      : await supabase.from('customers').insert(payload);

    if (error) {
      // Termasuk kasus RLS menolak atau constraint DB kena — pesan
      // Supabase/Postgres ditampilkan apa adanya, bukan silent fail.
      setFormFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    setFormFeedback({
      variant: 'success',
      message: editingId ? 'Customer berhasil diperbarui.' : 'Customer berhasil ditambahkan.',
    });
    resetForm();
    setSubmitting(false);

    // Reload dari Supabase, BUKAN optimistic update lokal.
    await loadCustomers();
  }

  async function handleToggleStatus(customer: Customer) {
    const nextStatus: Customer['status'] = customer.status === 'aktif' ? 'nonaktif' : 'aktif';
    setFormFeedback(null);

    const { data, error } = await supabase
      .from('customers')
      .update({ status: nextStatus })
      .eq('id', customer.id)
      .select('id');

    if (error || !data || data.length === 0) {
      setFormFeedback({
        variant: 'danger',
        message: error?.message ?? 'Tidak ada data yang berubah. Kemungkinan Anda tidak punya izin.',
      });
      return;
    }

    setFormFeedback({
      variant: 'success',
      message: `Customer "${customer.name}" berhasil di${nextStatus === 'nonaktif' ? 'nonaktifkan' : 'aktifkan'}.`,
    });
    await loadCustomers();
  }

  const columns: DataTableColumn<Customer>[] = [
    { key: 'name', header: 'Nama' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge label={row.status === 'aktif' ? 'Aktif' : 'Nonaktif'} tone={row.status === 'aktif' ? 'success' : 'neutral'} />,
    },
    {
      key: 'settlement_mode',
      header: 'Mode',
      render: (row) => (
        <StatusBadge label={row.settlement_mode === 'cod' ? 'COD' : 'Termin'} tone={row.settlement_mode === 'cod' ? 'neutral' : 'info'} />
      ),
    },
    {
      key: 'payment_term_days',
      header: 'Termin',
      render: (row) => (row.settlement_mode === 'term' && row.payment_term_days ? `${row.payment_term_days} hari` : '-'),
    },
    {
      key: 'notes',
      header: 'Catatan',
      render: (row) => (row.notes ? <span className="line-clamp-2 max-w-xs text-xs text-app-muted">{row.notes}</span> : '-'),
    },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: Customer) => (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  className="rounded px-2 py-1 text-xs font-medium text-app-accent hover:bg-app-accent/10"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleStatus(row)}
                  className="rounded px-2 py-1 text-xs font-medium text-app-muted hover:bg-white/5"
                >
                  {row.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}
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
        <h1 className="text-xl font-semibold text-app-text">Deliver &gt; Customer Management</h1>
        <p className="text-sm text-app-muted">Kelola daftar customer/eksportir dan mode settlement-nya.</p>
      </div>

      <div className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4">
        <h2 className="text-sm font-semibold text-app-text">{editingId ? 'Edit Customer' : 'Tambah Customer Baru'}</h2>

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
                placeholder="Mis. PT Ekspor Lobster Nusantara"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Mode Settlement *</span>
              <select
                value={formSettlementMode}
                onChange={(e) => handleSettlementModeChange(e.target.value as SettlementMode)}
                className={inputClass}
              >
                <option value="cod">COD</option>
                <option value="term">Termin</option>
              </select>
            </label>

            {formSettlementMode === 'term' && (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-app-muted">Termin Hari *</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={formPaymentTermDays}
                  onChange={(e) => setFormPaymentTermDays(e.target.value)}
                  className={inputClass}
                  placeholder="Mis. 14"
                />
              </label>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Catatan (opsional)</span>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder="Mis. hanya menerima size 200-300 ke atas, kemasan khusus, dsb. — informasional, tidak divalidasi sistem"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!formName.trim() || submitting}
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
        <AlertBanner variant="danger" title="Gagal memuat daftar customer">
          {loadError}
        </AlertBanner>
      )}

      <DataTable
        columns={columns}
        rows={customers}
        getRowId={(row) => row.id}
        emptyLabel={loading ? 'Memuat...' : 'Belum ada customer.'}
      />
    </div>
  );
}
