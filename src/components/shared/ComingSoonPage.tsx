export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-lg font-semibold text-app-text">{title}</p>
      <p className="text-sm text-app-muted">Halaman ini akan menyusul.</p>
    </div>
  );
}
