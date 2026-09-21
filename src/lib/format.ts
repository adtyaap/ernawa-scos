// Format angka & mata uang Indonesia (CLAUDE.md aturan #6):
// titik (.) pemisah ribuan, koma (,) pemisah desimal, mis. Rp520.000.

const numberFormatter = new Intl.NumberFormat('id-ID');
const currencyFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatKg(value: number): string {
  return `${numberFormatter.format(value)} kg`;
}

// Awal / akhir hari (zona waktu perangkat) dalam ISO UTC, untuk filter kolom
// timestamptz dari input tanggal YYYY-MM-DD.
export function localDayStartISO(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

export function localDayEndISO(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

// Tanggal hari ini menurut zona waktu perangkat (YYYY-MM-DD). JANGAN pakai
// new Date().toISOString().slice(0, 10): itu UTC, jadi user WIB (UTC+7) yang
// buka form jam 00:00-06:59 dapat default tanggal kemarin.
export function todayLocalDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
