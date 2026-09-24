import { NavLink } from 'react-router-dom';
import { NAV_TABS } from '../../config/navigation';
import { useAuth } from '../../lib/authContext';

export function TabMenu() {
  const { profile } = useAuth();
  // Investor hanya punya akses data Finance (migration 0022): tab lain
  // disembunyikan supaya tidak menampilkan halaman kosong. Penjaga sesungguhnya
  // tetap RLS di DB.
  const visibleTabs =
    profile?.role === 'investor'
      ? NAV_TABS.filter((tab) => tab.key === 'finance')
      : NAV_TABS.filter((tab) => !tab.ownerOnly || profile?.role === 'owner');

  return (
    <nav className="flex h-full items-center gap-4">
      {visibleTabs.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.path}
          end={tab.path === '/'}
          className={({ isActive }) =>
            [
              'flex h-full items-center border-b-2 px-1 text-[15px] tracking-tight transition-colors',
              isActive
                ? 'border-app-accent font-semibold text-app-accent'
                : 'border-transparent font-medium text-app-muted hover:text-app-text',
            ].join(' ')
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
