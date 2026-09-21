import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import type { AppUser, Site, UserRole } from '../../types/domain';

const inputClass =
  'rounded-md border border-app-border bg-app-bg px-2 py-1 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  lead_lapangan: 'Lead Lapangan',
  staf_lapangan: 'Staf Lapangan',
  investor: 'Investor',
};

// Penugasan site (user_sites, migration 0016/0017): Lead/Staf Lapangan hanya
// melihat dan menulis data untuk site yang dicentang di sini; Owner selalu
// semua site; Investor tidak punya akses data operasional. User lapangan
// tanpa satu pun site tidak melihat data apa pun (gagal-tertutup).
//
// Halaman ini mengubah role dan penugasan site user yang SUDAH punya akun. Membuat akun
// baru (auth.users) butuh Supabase Admin API / service_role key yang TIDAK
// BOLEH ada di frontend (CLAUDE.md #5) — untuk saat ini akun baru tetap
// dibuat manual lewat dashboard Supabase Auth + insert ke public.users. UI
// undangan user butuh Edge Function server-side, itu scope terpisah.
//
// Owner tidak bisa mengubah role dirinya sendiri di sini supaya tidak
// kehilangan akses owner secara tidak sengaja. Trigger fn_users_protect_role
// (0003/0012) tetap jadi penjaga sesungguhnya di DB.
export function ManajemenUserPage() {
  const { profile, session } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [users, setUsers] = useState<AppUser[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingSiteKey, setSavingSiteKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadUsers() {
    setLoading(true);
    setLoadError(null);
    const [{ data, error }, { data: siteData }, { data: assignmentData }] = await Promise.all([
      supabase.from('users').select('id, full_name, role, created_at').order('created_at'),
      supabase.from('sites').select('id, name, type').order('name'),
      supabase.from('user_sites').select('user_id, site_id'),
    ]);
    if (error) {
      setLoadError(error.message);
    } else {
      setUsers((data as AppUser[]) ?? []);
    }
    setSites((siteData as Site[]) ?? []);
    setAssigned(
      new Set(((assignmentData as { user_id: string; site_id: string }[] | null) ?? []).map((a) => `${a.user_id}:${a.site_id}`)),
    );
    setLoading(false);
  }

  async function handleSiteToggle(user: AppUser, site: Site, nextChecked: boolean) {
    if (savingSiteKey) return;
    const key = `${user.id}:${site.id}`;
    setSavingSiteKey(key);
    setFeedback(null);

    const request = nextChecked
      ? supabase.from('user_sites').insert({ user_id: user.id, site_id: site.id }).select('user_id')
      : supabase.from('user_sites').delete().eq('user_id', user.id).eq('site_id', site.id).select('user_id');
    const { data, error } = await request;

    setSavingSiteKey(null);

    if (error || !data || data.length === 0) {
      setFeedback({
        variant: 'danger',
        message: error?.message ?? 'Tidak ada data yang berubah. Kemungkinan Anda tidak punya izin.',
      });
      return;
    }

    setFeedback({
      variant: 'success',
      message: `${user.full_name} ${nextChecked ? 'ditugaskan ke' : 'tidak lagi ditugaskan ke'} ${site.name}.`,
    });
    await loadUsers();
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleRoleChange(user: AppUser, nextRole: UserRole) {
    if (nextRole === user.role || savingId) return;

    setSavingId(user.id);
    setFeedback(null);

    const { data, error } = await supabase.from('users').update({ role: nextRole }).eq('id', user.id).select('id');

    setSavingId(null);

    if (error || !data || data.length === 0) {
      setFeedback({
        variant: 'danger',
        message: error?.message ?? 'Tidak ada data yang berubah. Kemungkinan Anda tidak punya izin.',
      });
      return;
    }

    setFeedback({
      variant: 'success',
      message: `Role ${user.full_name} diubah menjadi ${ROLE_LABELS[nextRole]}.`,
    });
    await loadUsers();
  }

  if (!isOwner) {
    return (
      <div className="max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-app-text">Admin &gt; Manajemen User</h1>
        <AlertBanner variant="warning" title="Akses terbatas">
          Halaman ini hanya bisa diakses oleh Owner.
        </AlertBanner>
      </div>
    );
  }

  const columns: DataTableColumn<AppUser>[] = [
    { key: 'full_name', header: 'Nama' },
    {
      key: 'role',
      header: 'Role',
      render: (row) => {
        const isSelf = row.id === session?.user.id;
        return (
          <div className="flex items-center gap-2">
            <select
              value={row.role ?? ''}
              onChange={(e) => handleRoleChange(row, e.target.value as UserRole)}
              disabled={isSelf || savingId !== null}
              className={inputClass}
            >
              {row.role === null && <option value="">(belum diatur)</option>}
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            {isSelf && <StatusBadge label="Akun Anda" tone="info" />}
          </div>
        );
      },
    },
    {
      key: 'sites',
      header: 'Akses Site',
      render: (row) => {
        if (row.role === 'owner') return <StatusBadge label="Semua site" tone="info" />;
        if (row.role !== 'lead_lapangan' && row.role !== 'staf_lapangan') {
          return <span className="text-xs text-app-muted">Tidak ada akses data operasional</span>;
        }
        const assignedCount = sites.filter((s) => assigned.has(`${row.id}:${s.id}`)).length;
        return (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {sites.map((site) => {
                const key = `${row.id}:${site.id}`;
                return (
                  <label key={site.id} className="flex items-center gap-1.5 text-xs text-app-text">
                    <input
                      type="checkbox"
                      checked={assigned.has(key)}
                      disabled={savingSiteKey !== null}
                      onChange={(e) => handleSiteToggle(row, site, e.target.checked)}
                    />
                    {site.name}
                  </label>
                );
              })}
            </div>
            {assignedCount === 0 && (
              <StatusBadge label="Belum ditugaskan: tidak melihat data apa pun" tone="warning" />
            )}
          </div>
        );
      },
    },
    {
      key: 'created_at',
      header: 'Dibuat',
      render: (row) => new Date(row.created_at).toLocaleDateString('id-ID', { dateStyle: 'medium' }),
    },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Admin &gt; Manajemen User</h1>
        <p className="text-sm text-app-muted">
          Ubah role dan penugasan site user yang sudah punya akun. Akun baru dibuat lewat dashboard Supabase Auth, lalu
          didaftarkan ke tabel users.
        </p>
      </div>

      <AlertBanner variant="info" title="Catatan akses">
        Lead Lapangan dan Staf Lapangan hanya melihat dan mencatat data untuk site yang ditugaskan. Track mengikuti tipe
        site. Perubahan penugasan langsung berlaku dan tercatat di audit log.
      </AlertBanner>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
          {feedback.message}
        </AlertBanner>
      )}

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat daftar user">
          {loadError}
        </AlertBanner>
      )}

      <DataTable
        columns={columns}
        rows={users}
        getRowId={(row) => row.id}
        emptyLabel={loading ? 'Memuat...' : 'Belum ada user.'}
      />
    </div>
  );
}
