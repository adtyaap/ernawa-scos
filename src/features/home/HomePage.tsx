import { Boxes, TrendingUp, Truck } from 'lucide-react';
import { KPICard } from '../../components/shared/KPICard';
import { DataTable } from '../../components/shared/DataTable';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { formatKg } from '../../lib/format';

interface SampleBatchRow {
  id: string;
  site: string;
  produk: string;
  umurJam: number;
}

const SAMPLE_ROWS: SampleBatchRow[] = [
  { id: '1', site: 'Ernawa Trading', produk: 'Lobster', umurJam: 12 },
  { id: '2', site: 'Ernawa Budidaya Cimahi', produk: 'Lobster', umurJam: 340 },
];

// Halaman ini sample/demo untuk memperlihatkan reusable component
// (KPICard, DataTable, AlertBanner) — BELUM tersambung ke data Supabase
// sungguhan. Ganti dengan query nyata saat dashboard Home dikerjakan.
export function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Home</h1>
        <p className="text-sm text-app-muted">Contoh tampilan komponen — data di bawah ini masih contoh statis.</p>
      </div>

      <AlertBanner variant="warning" title="Contoh: batch tertahan lama">
        2 batch di Ernawa Budidaya Cimahi sudah melewati ambang holding.
      </AlertBanner>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KPICard icon={Boxes} label="Stok Tersedia" value={formatKg(1250)} deltaLabel="+8% vs target" deltaTone="positive" />
        <KPICard
          icon={TrendingUp}
          label="Penjualan Hari Ini"
          value={formatKg(340)}
          deltaLabel="-4% vs target"
          deltaTone="negative"
        />
        <KPICard icon={Truck} label="Pengiriman Aktif" value="5" deltaLabel="+2 vs target" deltaTone="positive" />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-app-muted">Contoh DataTable</h2>
        <DataTable
          rows={SAMPLE_ROWS}
          getRowId={(row) => row.id}
          columns={[
            { key: 'site', header: 'Site' },
            { key: 'produk', header: 'Produk' },
          ]}
          status={{
            getLabel: (row) => (row.umurJam > 48 ? 'Tertahan Lama' : 'Normal'),
            getTone: (row) => (row.umurJam > 48 ? 'danger' : 'success'),
          }}
          onEdit={(row) => console.log('edit (demo, belum wired)', row)}
          onDelete={(row) => console.log('hapus (demo, belum wired)', row)}
        />
      </div>
    </div>
  );
}
