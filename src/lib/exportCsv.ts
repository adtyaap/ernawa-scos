// Ekspor CSV generik dipakai di beberapa halaman laporan (PRD-MASTER Bagian
// 13, kolom "Export" ditandai [OPEN QUESTION format] -- dikonfirmasi user:
// CSV). Angka ditulis MENTAH (tanpa pemisah ribuan/desimal ala Indonesia dari
// lib/format.ts) -- format tampilan itu urusan UI, CSV harus portable ke
// spreadsheet app manapun tanpa terikat asumsi locale pembacanya.
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  const header = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvCell(c.value(row))).join(','));
  const csv = [header, ...body].join('\r\n');

  // BOM UTF-8 supaya Excel Windows tidak salah baca karakter non-ASCII.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
