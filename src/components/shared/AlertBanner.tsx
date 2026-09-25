import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type AlertVariant = 'warning' | 'danger' | 'success' | 'info';

const variantConfig: Record<AlertVariant, { icon: LucideIcon; classes: string }> = {
  warning: { icon: AlertTriangle, classes: 'border-app-warning/30 bg-app-warning/10 text-app-warning' },
  danger: { icon: XCircle, classes: 'border-app-danger/30 bg-app-danger/10 text-app-danger' },
  success: { icon: CheckCircle2, classes: 'border-app-success/30 bg-app-success/10 text-app-success' },
  info: { icon: Info, classes: 'border-app-accent/30 bg-app-accent/10 text-app-accent' },
};

export function AlertBanner({
  variant,
  title,
  children,
}: {
  variant: AlertVariant;
  title: string;
  children?: ReactNode;
}) {
  const { icon: Icon, classes } = variantConfig[variant];
  // danger/warning butuh pengumuman segera (assertive) krn biasanya blocking
  // error; success/info cukup polite supaya tidak menyela screen reader.
  const isUrgent = variant === 'danger' || variant === 'warning';

  return (
    <div
      role={isUrgent ? 'alert' : 'status'}
      aria-live={isUrgent ? 'assertive' : 'polite'}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${classes}`}
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">{title}</p>
        {children && <p className="mt-0.5 text-app-muted">{children}</p>}
      </div>
    </div>
  );
}
