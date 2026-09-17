import { Search, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TabMenu } from './TabMenu';

export function TopNavbar() {
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
    <header className="border-b border-app-border bg-app-panel">
      <div className="flex items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-app-text">
            Lobster SC<span className="text-app-accent">.OS</span>
          </span>
          <span className="text-xs text-app-muted">Ernawa</span>
        </div>

        <TabMenu />

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 rounded-md border border-app-border bg-app-bg px-3 py-1.5 md:flex">
            <Search size={14} className="text-app-muted" />
            <input
              type="text"
              placeholder="Cari..."
              className="w-40 bg-transparent text-sm text-app-text placeholder:text-app-muted focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            {online ? (
              <Wifi size={14} className="text-app-success" />
            ) : (
              <WifiOff size={14} className="text-app-danger" />
            )}
            <span className={online ? 'text-app-success' : 'text-app-danger'}>{online ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
