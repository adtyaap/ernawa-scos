import { LogOut, Search, Waves, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { TabMenu } from './TabMenu';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  lead_lapangan: 'Lead Lapangan',
  staf_lapangan: 'Staf Lapangan',
  investor: 'Investor',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

// Header dua baris mengikuti desain Stitch (gaya Fiori Horizon): baris atas
// logo + pencarian + status & profil, baris bawah tab modul bergaris bawah.
export function TopNavbar() {
  const { profile, profileLoading } = useAuth();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return (
    <header className="z-10 shrink-0 bg-app-panel shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
      <div className="flex h-14 items-center justify-between gap-4 px-6">
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-app-accent text-white">
            <Waves size={18} />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold tracking-tight text-app-text">Lobster SC.OS</span>
            <span className="text-sm font-medium text-app-accent">Ernawa</span>
          </div>
        </div>

        <div className="hidden max-w-2xl flex-1 px-3 md:block">
          <label htmlFor="topnav-search" className="sr-only">
            Cari
          </label>
          <div className="relative flex items-center">
            <Search size={16} className="pointer-events-none absolute left-3 text-app-muted" />
            <input
              id="topnav-search"
              type="text"
              placeholder="Cari..."
              className="w-full rounded-md bg-app-soft py-1.5 pl-9 pr-3 text-xs text-app-text placeholder:text-app-muted focus:bg-app-panel focus:outline-none focus:ring-2 focus:ring-app-accent"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs" title={online ? 'Terhubung' : 'Tidak ada koneksi'}>
            {online ? <Wifi size={14} className="text-app-success" /> : <WifiOff size={14} className="text-app-danger" />}
            <span className={online ? 'text-app-success' : 'text-app-danger'}>{online ? 'Online' : 'Offline'}</span>
          </div>

          <div className="h-6 w-px bg-app-border" />

          {profileLoading ? (
            <span className="text-xs text-app-muted">Memuat sesi...</span>
          ) : profile ? (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-app-soft-strong text-xs font-semibold text-app-accent">
                {initials(profile.full_name) || '?'}
              </div>
              <div className="hidden flex-col leading-tight xl:flex">
                <span className="text-[13px] font-semibold text-app-text">{profile.full_name}</span>
                <span className="text-[11px] font-medium text-app-muted">
                  {profile.role ? ROLE_LABEL[profile.role] ?? profile.role : 'Tanpa role'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => supabase.auth.signOut()}
                title="Keluar"
                aria-label="Keluar dari akun"
                className="rounded-md p-2 text-app-muted transition-colors hover:bg-app-soft hover:text-app-danger"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <span className="text-xs text-app-muted">Belum login</span>
          )}
        </div>
      </div>

      <div className="flex h-12 items-center px-6 shadow-[inset_0_1px_0_rgba(193,198,215,0.3)]">
        <TabMenu />
      </div>
    </header>
  );
}
