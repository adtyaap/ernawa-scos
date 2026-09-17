import { LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';

// Profil (full_name, role) sekarang datang dari AuthProvider (satu sumber
// kebenaran, dipakai juga oleh halaman lain yang butuh cek role) — kartu
// ini tinggal menampilkannya, plus tombol keluar untuk ganti akun saat
// testing role berbeda.
export function UserInfoCard() {
  const { profile, profileLoading } = useAuth();

  return (
    <div className="border-t border-app-border p-3">
      {profileLoading ? (
        <p className="text-xs text-app-muted">Memuat sesi...</p>
      ) : profile ? (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-app-text">{profile.full_name}</p>
            <p className="text-xs capitalize text-app-muted">{profile.role ?? 'Tanpa role'}</p>
          </div>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            title="Keluar"
            className="shrink-0 rounded p-1.5 text-app-muted hover:bg-white/5 hover:text-app-danger"
          >
            <LogOut size={14} />
          </button>
        </div>
      ) : (
        <p className="text-xs text-app-muted">Belum login</p>
      )}
    </div>
  );
}
