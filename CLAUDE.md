# CLAUDE.md — Lobster SC OS (Ernawa)

Aturan berikut bersifat MENGIKAT untuk seluruh pekerjaan di repo ini. Jangan menyimpang dari aturan ini kecuali pengguna memberi instruksi eksplisit untuk kasus tertentu.

## 1. Pemisahan Dua Track Bisnis (Trading vs Budidaya)

Proyek ini punya DUA TRACK bisnis yang wajib dipisah total:

- **Trading** — Ernawa sebagai pengepul, modal lincah (cepat berputar).
- **Budidaya** — land-based di Cimahi, modal terkunci dalam biomassa.

Aturan:
- JANGAN PERNAH membuat unit economics gabungan (blended) antara dua track ini — di kode, query, maupun laporan mana pun.
- Setiap tabel dan kalkulasi finansial harus punya kolom/filter `track` yang eksplisit (mis. `track = 'trading' | 'budidaya'`).
- Setiap agregasi (revenue, margin, cash flow, dsb.) harus di-`GROUP BY`/difilter per track sebelum ditampilkan atau dijumlahkan lintas track. Jika sebuah laporan benar-benar butuh angka gabungan (mis. total kas perusahaan), tampilkan breakdown per track di sampingnya — jangan hanya angka blended.

## 2. Inventory sebagai Ledger Append-Only

Stok/inventory TIDAK BOLEH disimpan sebagai angka yang di-mutate langsung (tidak ada `UPDATE quantity` in place).

- Gunakan pola **Inventory Ledger append-only**: setiap pergerakan stok adalah baris baru.
- `movement_type` yang valid: `receive`, `mortality`, `shrinkage`, `delivery`, `reject`, `transfer_in`, `transfer_out`, `adjustment`.
- Stok yang tersedia SELALU dihitung sebagai `SUM()` dari ledger pada saat query — bukan dibaca dari kolom running-total yang tersimpan.

## 3. Koreksi Data via Reversal, Bukan UPDATE/DELETE

- Baris ledger yang sudah tersimpan TIDAK BOLEH di-`UPDATE` atau di-`DELETE`.
- Koreksi harus berupa baris **reversal** baru yang mereferensikan baris asal lewat kolom `reversal_of` (menunjuk ke id baris yang dikoreksi).

## 4. Row Level Security (RLS) Wajib Aktif

- RLS WAJIB aktif di semua tabel Postgres/Supabase sejak schema pertama dibuat.
- Jangan pernah menyarankan menonaktifkan RLS "untuk sementara" atau "biar gampang development" — termasuk saat debugging atau prototyping cepat.

## 5. Pemisahan Kunci Supabase

- `service_role` key Supabase TIDAK BOLEH pernah muncul di kode frontend/client-side, dan TIDAK BOLEH pernah di-commit ke git (termasuk di `.env` yang ter-tracked, config, atau contoh kode).
- `service_role` key hanya boleh dipakai di server-side / edge function.
- Kunci yang boleh ada di frontend hanyalah **anon public key**.

## 6. Bahasa dan Format Angka di UI

- Semua tampilan yang menghadap pengguna (user-facing) menggunakan **Bahasa Indonesia**.
- Format angka menggunakan format Indonesia: titik (`.`) sebagai pemisah ribuan, koma (`,`) sebagai pemisah desimal.
- Contoh format mata uang: `Rp520.000`.

## 7. Perubahan Skema via Migration File

- Setiap perubahan skema database harus berupa file migration bernomor urut di folder `migrations/`.
- Jangan pernah mengubah skema langsung lewat dashboard Supabase tanpa migration file yang tersimpan di git.

## 8. Konfirmasi Sebelum Migration Destruktif

- Sebelum menjalankan migration apa pun yang mengandung `DROP` atau perintah destruktif lain (termasuk `TRUNCATE`, `DELETE` massal, `ALTER ... DROP COLUMN`), tampilkan dulu isi lengkap migration tersebut ke pengguna.
- Minta konfirmasi eksplisit dari pengguna sebelum eksekusi — jangan pernah langsung menjalankannya.
