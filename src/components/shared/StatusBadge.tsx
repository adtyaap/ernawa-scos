export type BadgeTone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const toneClasses: Record<BadgeTone, string> = {
  success: 'bg-app-success/15 text-app-success',
  danger: 'bg-app-danger/15 text-app-danger',
  warning: 'bg-app-warning/15 text-app-warning',
  neutral: 'bg-app-soft-strong text-app-muted',
  info: 'bg-app-accent/15 text-app-accent',
};

export function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}
