import { NavLink, useLocation } from 'react-router-dom';
import {
  Tag,
  TrendingUp,
  Package,
  Inbox,
  Upload,
  ArrowLeftRight,
  Box,
  Activity,
  HeartPulse,
  AlertTriangle,
  ClipboardCheck,
  History,
  FilePenLine,
  Users,
  ClipboardList,
  PackageCheck,
  Route,
  Scale,
  Receipt,
  LineChart,
  Wallet,
  HandCoins,
  Banknote,
  FileCheck2,
  Landmark,
  Target,
  Tags,
  KeyRound,
  SlidersHorizontal,
  UserCog,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import { NAV_TABS } from '../../config/navigation';

function findActiveTab(pathname: string) {
  const sorted = [...NAV_TABS].sort((a, b) => b.path.length - a.path.length);
  return sorted.find((tab) => (tab.path === '/' ? pathname === '/' : pathname.startsWith(tab.path))) ?? NAV_TABS[0];
}

// Ikon per submenu, murni dekoratif (bukan library baru -- tetap lucide-react
// spy tidak perlu migrasi icon set) supaya lebih mendekati kepadatan visual
// proyek Stitch "Web ERP System Design" (sidebar-nya per-item punya ikon).
const ITEM_ICON: Record<string, LucideIcon> = {
  '/source/acuan-harga': Tag,
  '/source/perkiraan-pasokan': TrendingUp,
  '/source/produk': Package,
  '/inventory/terima-cepat': Inbox,
  '/inventory/import-terima-cepat': Upload,
  '/inventory/handover': ArrowLeftRight,
  '/inventory/tank': Box,
  '/inventory/live': Activity,
  '/inventory/stok': HeartPulse,
  '/inventory/risiko-fefo': AlertTriangle,
  '/inventory/inspeksi-kualitas': ClipboardCheck,
  '/inventory/riwayat': History,
  '/inventory/koreksi': FilePenLine,
  '/deliver/customer': Users,
  '/deliver/demand-baru': ClipboardList,
  '/deliver/alokasi-kirim': PackageCheck,
  '/deliver/logistics': Route,
  '/deliver/konfirmasi-timbang': Scale,
  '/deliver/settlement': Receipt,
  '/deliver/riwayat': History,
  '/finance/profitability': LineChart,
  '/finance/piutang': Wallet,
  '/finance/utang-pemasok': HandCoins,
  '/finance/kas-panjar': Banknote,
  '/finance/rekonsiliasi-kas': FileCheck2,
  '/finance/kas-bank': Landmark,
  '/finance/anggaran-realisasi': Target,
  '/finance/kategori-opex': Tags,
  '/akun/katasandi': KeyRound,
  '/admin/pengaturan-ambang': SlidersHorizontal,
  '/admin/user': UserCog,
  '/admin/audit': ScrollText,
};

// Lebar 256px + pill fill aktif (bukan border-l tipis) mengikuti proyek
// Stitch "Web ERP System Design". Tab modul tanpa submenu (Home) tidak
// menampilkan sidebar sama sekali, supaya kontennya full-width.
export function Sidebar() {
  const location = useLocation();
  const activeTab = findActiveTab(location.pathname);

  if (activeTab.submenu.length === 0) return null;

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-app-border bg-app-panel">
      <div className="space-y-0.5 p-3">
        <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-app-muted">{activeTab.label}</p>
        {activeTab.submenu.map((item) => {
          const Icon = ITEM_ICON[item.path];
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-app-accent font-semibold text-white shadow-sm'
                    : 'text-app-text hover:bg-app-soft',
                ].join(' ')
              }
            >
              {Icon && <Icon size={17} strokeWidth={1.75} className="shrink-0" />}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </aside>
  );
}
