import { NavLink, useLocation } from 'react-router-dom';
import { NAV_TABS } from '../../config/navigation';

function findActiveTab(pathname: string) {
  const sorted = [...NAV_TABS].sort((a, b) => b.path.length - a.path.length);
  return sorted.find((tab) => (tab.path === '/' ? pathname === '/' : pathname.startsWith(tab.path))) ?? NAV_TABS[0];
}

// Desain Stitch tidak punya sidebar, tapi submenu per modul (sampai 9 item di
// Inventory) tetap butuh tempat -- jadi dipertahankan sebagai daftar samping
// terang bergaya Fiori. Tab modul yang tidak punya submenu (Home) tidak
// menampilkan sidebar sama sekali, supaya kontennya full-width seperti Stitch.
export function Sidebar() {
  const location = useLocation();
  const activeTab = findActiveTab(location.pathname);

  if (activeTab.submenu.length === 0) return null;

  return (
    <aside className="w-56 shrink-0 overflow-y-auto border-r border-app-border bg-app-panel">
      <div className="space-y-0.5 p-3">
        <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-app-muted">{activeTab.label}</p>
        {activeTab.submenu.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              [
                'block rounded-md border-l-2 px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'border-app-accent bg-app-soft font-semibold text-app-accent'
                  : 'border-transparent text-app-text hover:bg-app-soft',
              ].join(' ')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
