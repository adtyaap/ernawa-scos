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
    <div className="rounded-lg border border-app-border bg-app-panel p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">{label}</span>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-app-soft text-app-accent">
          <Icon size={16} />
        </div>
      </div>
      <p className="mt-2 text-[28px] font-bold leading-9 tracking-tight tabular-nums text-app-text">{value}</p>
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
