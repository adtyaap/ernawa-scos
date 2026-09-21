import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/authContext';
import { RequireAuth } from './components/auth/RequireAuth';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './features/home/HomePage';
import { SourcePage } from './features/source/SourcePage';
import { InventoryIndexPage } from './features/inventory/InventoryIndexPage';
import { TerimaCepatPage } from './features/inventory/TerimaCepatPage';
import { StokMortalitasPage } from './features/inventory/StokMortalitasPage';
import { InspeksiKualitasPage } from './features/inventory/InspeksiKualitasPage';
import { ManajemenUserPage } from './features/admin/ManajemenUserPage';
import { ComingSoonPage } from './components/shared/ComingSoonPage';
import { DeliverPage } from './features/deliver/DeliverPage';
import { CustomerPage } from './features/customers/CustomerPage';
import { DemandPage } from './features/demands/DemandPage';
import { AlokasiKirimPage } from './features/deliver/AlokasiKirimPage';
import { KonfirmasiTimbangPage } from './features/deliver/KonfirmasiTimbangPage';
import { SettlementPage } from './features/deliver/SettlementPage';
import { FinancePage } from './features/finance/FinancePage';
import { PiutangPage } from './features/finance/PiutangPage';

export default function App() {
  return (
    <AuthProvider>
      <RequireAuth>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/source" element={<SourcePage />} />
            <Route path="/inventory" element={<InventoryIndexPage />} />
            <Route path="/inventory/terima-cepat" element={<TerimaCepatPage />} />
            <Route path="/inventory/stok" element={<StokMortalitasPage />} />
            <Route path="/inventory/inspeksi-kualitas" element={<InspeksiKualitasPage />} />
            <Route path="/deliver" element={<DeliverPage />} />
            <Route path="/deliver/customer" element={<CustomerPage />} />
            <Route path="/deliver/demand-baru" element={<DemandPage />} />
            <Route path="/deliver/alokasi-kirim" element={<AlokasiKirimPage />} />
            <Route path="/deliver/konfirmasi-timbang" element={<KonfirmasiTimbangPage />} />
            <Route path="/deliver/settlement" element={<SettlementPage />} />
            <Route path="/finance" element={<FinancePage />} />
            <Route path="/finance/piutang" element={<PiutangPage />} />
            <Route path="/admin" element={<ComingSoonPage title="Admin" />} />
            <Route path="/admin/user" element={<ManajemenUserPage />} />
          </Routes>
        </AppShell>
      </RequireAuth>
    </AuthProvider>
  );
}
