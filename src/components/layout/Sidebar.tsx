import { NavLink, useLocation } from 'react-router-dom';
import { NAV_TABS } from '../../config/navigation';
import { UserInfoCard } from './UserInfoCard';

function findActiveTab(pathname: string) {
  const sorted = [...NAV_TABS].sort((a, b) => b.path.length - a.path.length);
  return sorted.find((tab) => (tab.path === '/' ? pathname === '/' : pathname.startsWith(tab.path))) ?? NAV_TABS[0];
}

export function Sidebar() {
  const location = useLocation();
  const activeTab = findActiveTab(location.pathname);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-app-border bg-app-panel">
      <div className="flex-1 space-y-1 p-3">
        <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-app-muted">{activeTab.label}</p>
        {activeTab.submenu.length === 0 && <p className="px-2 text-sm text-app-muted">Belum ada submenu.</p>}
        {activeTab.submenu.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              [
                'block rounded-md px-2 py-1.5 text-sm transition-colors',
                isActive ? 'bg-app-accent/15 text-app-accent' : 'text-app-text hover:bg-white/5',
              ].join(' ')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      <UserInfoCard />
    </aside>
  );
}
