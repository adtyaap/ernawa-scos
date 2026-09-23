// Konfigurasi tab atas + submenu sidebar. Tambah entri di sini saat halaman
// baru menyusul — Sidebar & TabMenu murni data-driven dari config ini.

export type TabKey = 'home' | 'source' | 'inventory' | 'deliver' | 'finance' | 'admin';

export interface SubmenuItem {
  label: string;
  path: string;
}

export interface TabConfig {
  key: TabKey;
  label: string;
  path: string;
  submenu: SubmenuItem[];
  // Cuma menyembunyikan tab di navigasi; penjaga sesungguhnya tetap RLS di DB.
  ownerOnly?: boolean;
}

export const NAV_TABS: TabConfig[] = [
  { key: 'home', label: 'Home', path: '/', submenu: [{ label: 'Ganti Katasandi', path: '/akun/katasandi' }] },
  {
    key: 'source',
    label: 'Source',
    path: '/source',
    submenu: [
      { label: 'Acuan Harga', path: '/source/acuan-harga' },
      { label: 'Perkiraan Pasokan', path: '/source/perkiraan-pasokan' },
      { label: 'Kelola Produk', path: '/source/produk' },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    path: '/inventory',
    submenu: [
      { label: 'Terima Cepat', path: '/inventory/terima-cepat' },
      { label: 'Import Terima Cepat', path: '/inventory/import-terima-cepat' },
      { label: 'Serah Terima', path: '/inventory/handover' },
      { label: 'Kelola Tank', path: '/inventory/tank' },
      { label: 'Stok & Mortalitas', path: '/inventory/stok' },
      { label: 'Laporan Risiko FEFO', path: '/inventory/risiko-fefo' },
      { label: 'Inspeksi Kualitas', path: '/inventory/inspeksi-kualitas' },
      { label: 'Riwayat Penerimaan', path: '/inventory/riwayat' },
      { label: 'Koreksi Ledger', path: '/inventory/koreksi' },
    ],
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
      { label: 'Riwayat Delivery', path: '/deliver/riwayat' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    path: '/finance',
    submenu: [
      { label: 'Piutang & Aging', path: '/finance/piutang' },
      { label: 'Kas Panjar', path: '/finance/kas-panjar' },
      { label: 'Rekonsiliasi Kas', path: '/finance/rekonsiliasi-kas' },
      { label: 'Kas & Bank Perusahaan', path: '/finance/kas-bank' },
      { label: 'Anggaran vs Realisasi', path: '/finance/anggaran-realisasi' },
      { label: 'Kelola Kategori Opex', path: '/finance/kategori-opex' },
    ],
  },
  {
    key: 'admin',
    label: 'Admin',
    path: '/admin',
    ownerOnly: true,
    submenu: [
      { label: 'Manajemen User', path: '/admin/user' },
      { label: 'Audit Log', path: '/admin/audit' },
    ],
  },
];
