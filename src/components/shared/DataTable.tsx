import type { ReactNode } from 'react';
import { StatusBadge, type BadgeTone } from './StatusBadge';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

export interface DataTableStatusConfig<T> {
  getLabel: (row: T) => string;
  getTone: (row: T) => BadgeTone;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  status?: DataTableStatusConfig<T>;
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  emptyLabel?: string;
}

// Komponen generik: tidak tahu-menahu soal tabel/permission tertentu.
// Halaman pemanggil yang menentukan apakah onEdit/onDelete relevan untuk
// data itu (banyak tabel di schema ini memang tidak punya policy DELETE
// sama sekali — jangan pasang onDelete kalau backend-nya tidak mengizinkan).
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  status,
  onEdit,
  onDelete,
  emptyLabel = 'Belum ada data.',
}: DataTableProps<T>) {
  const hasActions = Boolean(onEdit || onDelete);
  const colSpan = columns.length + (status ? 1 : 0) + (hasActions ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-app-border bg-app-panel shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-app-soft text-[11px] uppercase tracking-wider text-app-text">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-3 font-semibold">
                {col.header}
              </th>
            ))}
            {status && <th className="px-4 py-3 font-semibold">Status</th>}
            {hasActions && <th className="px-4 py-3 text-right font-semibold">Aksi</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-6 text-center text-app-muted">
                {emptyLabel}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={getRowId(row)} className="text-app-text transition-colors hover:bg-app-soft/60">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-2.5">
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
              {status && (
                <td className="px-4 py-2">
                  <StatusBadge label={status.getLabel(row)} tone={status.getTone(row)} />
                </td>
              )}
              {hasActions && (
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => onEdit(row)}
                        className="rounded px-2 py-1 text-xs font-medium text-app-accent hover:bg-app-accent/10"
                      >
                        Edit
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(row)}
                        className="rounded px-2 py-1 text-xs font-medium text-app-danger hover:bg-app-danger/10"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
