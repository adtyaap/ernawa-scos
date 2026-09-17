import { NavLink } from 'react-router-dom';
import { NAV_TABS } from '../../config/navigation';

export function TabMenu() {
  return (
    <nav className="flex items-center gap-1">
      {NAV_TABS.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.path}
          end={tab.path === '/'}
          className={({ isActive }) =>
            [
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive ? 'bg-app-accent/15 text-app-accent' : 'text-app-muted hover:bg-white/5 hover:text-app-text',
            ].join(' ')
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
