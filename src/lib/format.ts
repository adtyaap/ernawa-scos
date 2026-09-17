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
