import type { LucideIcon } from 'lucide-react';

interface KPICardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  deltaLabel?: string;
  deltaTone?: 'positive' | 'negative';
  // Catatan netral di bawah delta (mis. "Berdasarkan 3 delivery") — beda
  // dari deltaLabel yang selalu berwarna hijau/merah, note ini abu-abu,
  // dipakai untuk konteks data (jumlah transaksi yang mendasari), bukan
  // penilaian baik/buruk.
  note?: string;
}

export function KPICard({ icon: Icon, label, value, deltaLabel, deltaTone = 'positive', note }: KPICardProps) {
  return (
    <div className="rounded-lg border border-app-border bg-app-panel p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-app-muted">{label}</span>
        <Icon size={18} className="text-app-accent" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-app-text">{value}</p>
      {deltaLabel && (
        <p
          className={`mt-1 text-xs font-medium ${
            deltaTone === 'positive' ? 'text-app-success' : 'text-app-danger'
          }`}
        >
          {deltaLabel}
        </p>
      )}
      {note && <p className="mt-1 text-xs text-app-muted">{note}</p>}
    </div>
  );
}
