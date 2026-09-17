// Konfigurasi tab atas + submenu sidebar. Tambah entri di sini saat halaman
// baru menyusul — Sidebar & TabMenu murni data-driven dari config ini.

export type TabKey = 'home' | 'source' | 'inventory' | 'deliver' | 'finance';

export interface SubmenuItem {
  label: string;
  path: string;
}

export interface TabConfig {
  key: TabKey;
  label: string;
  path: string;
  submenu: SubmenuItem[];
}

export const NAV_TABS: TabConfig[] = [
  { key: 'home', label: 'Home', path: '/', submenu: [] },
  { key: 'source', label: 'Source', path: '/source', submenu: [] },
  {
    key: 'inventory',
    label: 'Inventory',
    path: '/inventory',
    submenu: [{ label: 'Terima Cepat', path: '/inventory/terima-cepat' }],
  },
  {
    key: 'deliver',
    label: 'Deliver',
    path: '/deliver',
    // Customer Management ditaruh di sini (bukan tab baru / bukan di bawah
    // Source) karena simetris dengan Source > Supplier Management: Source =
    // sisi pembelian (supplier), Deliver = sisi penjualan (customer). Juga
    // rumah alami untuk submenu Deliver lain yang menyusul (Demand Baru,
    // Alokasi & Kirim, Konfirmasi Timbang, Settlement).
    submenu: [
      { label: 'Customer', path: '/deliver/customer' },
      { label: 'Demand Baru', path: '/deliver/demand-baru' },
      { label: 'Alokasi & Kirim', path: '/deliver/alokasi-kirim' },
      { label: 'Konfirmasi Timbang', path: '/deliver/konfirmasi-timbang' },
      { label: 'Settlement', path: '/deliver/settlement' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    path: '/finance',
    submenu: [{ label: 'Piutang & Aging', path: '/finance/piutang' }],
  },
];
