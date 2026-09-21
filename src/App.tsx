import { lazy, Suspense, type ComponentType } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/authContext';
import { RequireAuth } from './components/auth/RequireAuth';
import { AppShell } from './components/layout/AppShell';
import { ComingSoonPage } from './components/shared/ComingSoonPage';

// Setiap halaman dimuat saat pertama dibuka (code-splitting), bukan semuanya
// di bundle awal — supaya login dan halaman pertama tetap ringan walau jumlah
// halaman terus bertambah. Halaman memakai named export, jadi dibungkus
// menjadi default export untuk React.lazy.
function lazyPage<T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T) {
  return lazy(async () => ({ default: (await loader())[name] as ComponentType }));
}

const HomePage = lazyPage(() => import('./features/home/HomePage'), 'HomePage');
const SourcePage = lazyPage(() => import('./features/source/SourcePage'), 'SourcePage');
const InventoryIndexPage = lazyPage(() => import('./features/inventory/InventoryIndexPage'), 'InventoryIndexPage');
const TerimaCepatPage = lazyPage(() => import('./features/inventory/TerimaCepatPage'), 'TerimaCepatPage');
const StokMortalitasPage = lazyPage(() => import('./features/inventory/StokMortalitasPage'), 'StokMortalitasPage');
const InspeksiKualitasPage = lazyPage(() => import('./features/inventory/InspeksiKualitasPage'), 'InspeksiKualitasPage');
const RiwayatPenerimaanPage = lazyPage(() => import('./features/inventory/RiwayatPenerimaanPage'), 'RiwayatPenerimaanPage');
const KoreksiLedgerPage = lazyPage(() => import('./features/inventory/KoreksiLedgerPage'), 'KoreksiLedgerPage');
const DeliverPage = lazyPage(() => import('./features/deliver/DeliverPage'), 'DeliverPage');
const RiwayatDeliveryPage = lazyPage(() => import('./features/deliver/RiwayatDeliveryPage'), 'RiwayatDeliveryPage');
const CustomerPage = lazyPage(() => import('./features/customers/CustomerPage'), 'CustomerPage');
const DemandPage = lazyPage(() => import('./features/demands/DemandPage'), 'DemandPage');
const AlokasiKirimPage = lazyPage(() => import('./features/deliver/AlokasiKirimPage'), 'AlokasiKirimPage');
const KonfirmasiTimbangPage = lazyPage(() => import('./features/deliver/KonfirmasiTimbangPage'), 'KonfirmasiTimbangPage');
const SettlementPage = lazyPage(() => import('./features/deliver/SettlementPage'), 'SettlementPage');
const FinancePage = lazyPage(() => import('./features/finance/FinancePage'), 'FinancePage');
const PiutangPage = lazyPage(() => import('./features/finance/PiutangPage'), 'PiutangPage');
const GantiKatasandiPage = lazyPage(() => import('./features/account/GantiKatasandiPage'), 'GantiKatasandiPage');
const ManajemenUserPage = lazyPage(() => import('./features/admin/ManajemenUserPage'), 'ManajemenUserPage');
const AuditLogPage = lazyPage(() => import('./features/admin/AuditLogPage'), 'AuditLogPage');

export default function App() {
  return (
    <AuthProvider>
      <RequireAuth>
        <AppShell>
          <Suspense fallback={<p className="text-sm text-app-muted">Memuat halaman...</p>}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/source" element={<SourcePage />} />
              <Route path="/inventory" element={<InventoryIndexPage />} />
              <Route path="/inventory/terima-cepat" element={<TerimaCepatPage />} />
              <Route path="/inventory/stok" element={<StokMortalitasPage />} />
              <Route path="/inventory/inspeksi-kualitas" element={<InspeksiKualitasPage />} />
              <Route path="/inventory/riwayat" element={<RiwayatPenerimaanPage />} />
              <Route path="/inventory/koreksi" element={<KoreksiLedgerPage />} />
              <Route path="/deliver/riwayat" element={<RiwayatDeliveryPage />} />
              <Route path="/deliver" element={<DeliverPage />} />
              <Route path="/deliver/customer" element={<CustomerPage />} />
              <Route path="/deliver/demand-baru" element={<DemandPage />} />
              <Route path="/deliver/alokasi-kirim" element={<AlokasiKirimPage />} />
              <Route path="/deliver/konfirmasi-timbang" element={<KonfirmasiTimbangPage />} />
              <Route path="/deliver/settlement" element={<SettlementPage />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/finance/piutang" element={<PiutangPage />} />
              <Route path="/akun/katasandi" element={<GantiKatasandiPage />} />
              <Route path="/admin" element={<ComingSoonPage title="Admin" />} />
              <Route path="/admin/user" element={<ManajemenUserPage />} />
              <Route path="/admin/audit" element={<AuditLogPage />} />
            </Routes>
          </Suspense>
        </AppShell>
      </RequireAuth>
    </AuthProvider>
  );
}
