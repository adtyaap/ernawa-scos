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
    <nav className="flex items-center gap-1.5">
      {visibleTabs.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.path}
          end={tab.path === '/'}
          className={({ isActive }) =>
            [
              'whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm transition-colors',
              isActive
                ? 'bg-app-accent font-semibold text-white shadow-sm'
                : 'font-medium text-app-muted hover:bg-app-soft hover:text-app-text',
            ].join(' ')
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
