// Parser angka & tanggal untuk Import Excel (Inventory > Terima Cepat).
// Bug kelas v43 yang WAJIB dihindari di sini: "Rp520.000" (format Indonesia,
// titik = pemisah ribuan) pernah salah dibaca sebagai desimal (520). Aturan
// parser ini: SETIAP titik di teks angka dianggap pemisah ribuan (dibuang),
// koma (kalau ada) dianggap pemisah desimal. Sel yang sudah berupa number asli
// dari Excel (bukan teks) dipakai apa adanya — tidak pernah diproses ulang
// sebagai string, supaya tidak ada risiko salah tafsir dua kali.

export function parseIndonesianNumber(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') return null;

  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^Rp\s*/i, '').trim();
  if (!s) return null;

  const hasComma = s.includes(',');
  s = s.replace(/\./g, '');
  if (hasComma) s = s.replace(',', '.');

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Terima Date asli dari sel Excel (exceljs mem-parsing sel bertipe tanggal
// otomatis jadi Date), atau teks umum: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY.
// Mengembalikan string YYYY-MM-DD (format yang diterima kolom `date` Postgres)
// atau null kalau tidak bisa diparse.
export function parseFlexibleDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof raw === 'string') {
    const s = raw.trim();

    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  return null;
}

export function normalizeName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}
