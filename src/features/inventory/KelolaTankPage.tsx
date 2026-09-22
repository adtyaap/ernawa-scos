import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import type { Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface TankRow {
  id: string;
  site_id: string;
  name: string;
  site: { name: string } | null;
}

// Tank adalah lokasi fisik di dalam site (dipakai Terima Cepat, Serah Terima,
// dan pembentukan batch lewat get_or_create_batch). Ditemukan lewat uji
// Playwright end-to-end (lihat CLAUDE.md Catatan Tech Debt) bahwa site selain
// Banggai TIDAK PUNYA tank sama sekali di data produksi -- sebelum halaman ini
// ada, satu-satunya cara menambah tank adalah insert manual lewat SQL.
//
// Owner-only untuk tambah/ubah (tanks_insert/tanks_update RLS, sudah ada
// sejak migration awal -- tidak perlu migration baru). Tidak ada policy
// DELETE dan tidak ada kolom status di tabel ini, jadi tidak ada aksi
// hapus/nonaktifkan -- tank yang sudah dibuat bersifat permanen (bisa
// diganti nama lewat Edit, tidak bisa dihapus). Semua role dengan akses ke
// site terkait tetap bisa MELIHAT daftar tank (tanks_select), cuma
// tambah/ubah yang owner-only.
export function KelolaTankPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [sites, setSites] = useState<Site[]>([]);
  const [tanks, setTanks] = useState<TankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formSiteId, setFormSiteId] = useState('');
  const [formName, setFormName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadTanks() {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('tanks')
      .select('id, site_id, name, site:sites(name)')
      .order('name');

    if (error) {
      setLoadError(error.message);
    } else {
      setTanks((data as unknown as TankRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    async function loadMaster() {
      const { data } = await supabase.from('sites').select('id, name, type').order('name');
      setSites((data as Site[]) ?? []);
      await loadTanks();
    }
    loadMaster();
  }, []);

  function resetForm() {
    setEditingId(null);
    setFormSiteId('');
    setFormName('');
  }

  function startEdit(tank: TankRow) {
    setEditingId(tank.id);
    setFormSiteId(tank.site_id);
    setFormName(tank.name);
    setFormFeedback(null);
  }

  function cancelEdit() {
    resetForm();
    setFormFeedback(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = formName.trim();
    if (!formSiteId || !trimmedName || submitting) return;

    setSubmitting(true);
    setFormFeedback(null);

    // Rename saja yang boleh diedit -- site_id sengaja tidak ikut diupdate
    // (memindahkan tank fisik ke site lain bukan operasi "edit nama", dan
    // batches/batch_lines yang sudah ada mengasumsikan site tank-nya tetap).
    const { error } = editingId
      ? await supabase.from('tanks').update({ name: trimmedName }).eq('id', editingId)
      : await supabase.from('tanks').insert({ site_id: formSiteId, name: trimmedName });

    if (error) {
      setFormFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    setFormFeedback({
      variant: 'success',
      message: editingId ? 'Tank berhasil diperbarui.' : 'Tank berhasil ditambahkan.',
    });
    resetForm();
    setSubmitting(false);
    await loadTanks();
  }

  const columns: DataTableColumn<TankRow>[] = [
    { key: 'name', header: 'Nama Tank' },
    { key: 'site', header: 'Site', render: (row) => row.site?.name ?? '-' },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: TankRow) => (
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
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Kelola Tank</h1>
        <p className="text-sm text-app-muted">
          Daftar tank per site. Dipakai saat Terima Cepat, Import Excel, dan Serah Terima (tank tujuan).
        </p>
      </div>

      {isOwner && (
        <div className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4">
          <h2 className="text-sm font-semibold text-app-text">{editingId ? 'Ubah Nama Tank' : 'Tambah Tank Baru'}</h2>

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
                <span className="text-xs font-medium text-app-muted">Site *</span>
                <select
                  value={formSiteId}
                  onChange={(e) => setFormSiteId(e.target.value)}
                  className={inputClass}
                  disabled={Boolean(editingId)}
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
                <span className="text-xs font-medium text-app-muted">Nama Tank *</span>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className={inputClass}
                  placeholder="Mis. Tank 2"
                />
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!formSiteId || !formName.trim() || submitting}
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
      )}

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat daftar tank">
          {loadError}
        </AlertBanner>
      )}

      <DataTable
        columns={columns}
        rows={tanks}
        getRowId={(row) => row.id}
        emptyLabel={loading ? 'Memuat...' : 'Belum ada tank.'}
      />
    </div>
  );
}
