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

---

## Catatan Tech Debt

Bagian ini BUKAN aturan mengikat seperti nomor 1-8 di atas — ini gap yang diketahui dan SENGAJA ditunda, dicatat di sini supaya tidak lupa dan tidak diselesaikan setengah-setengah (mis. dibetulkan di satu halaman tapi lupa di halaman lain yang punya gap identik).

- **[SELESAI — migration 0010]** ~~Non-atomicity di alur multi-insert dari client (Terima Cepat & Alokasi/Kirim)~~: `Inventory > Terima Cepat` (insert `receiving_transactions` → `receiving_lots` → RPC `get_or_create_batch()` → insert `batch_lines`) dan `Deliver > Alokasi & Kirim` (insert `deliveries` → insert `delivery_allocations`) sama-sama dieksekusi sebagai beberapa panggilan Supabase berurutan dari client, BUKAN satu transaksi database yang atomik. Kalau gagal di tengah jalan, bisa tersisa data parsial/"nyangkut" (mis. `deliveries` tanpa `delivery_allocations`, tidak bisa di-rollback karena kedua tabel tidak punya policy DELETE). Ini GAP YANG SAMA di kedua alur, bukan dua masalah terpisah — begitu volume transaksi bertambah, keduanya WAJIB dibungkus jadi RPC/stored procedure atomik dalam SATU migration, bukan dibetulkan satu-satu per halaman secara terpisah.
  **Resolusi**: migration 0010 menambahkan `create_receiving_with_batch()` dan `create_delivery_with_allocations()` (keduanya SECURITY INVOKER, 1 transaksi all-or-nothing masing-masing). `TerimaCepatPage.tsx` dan `AlokasiKirimPage.tsx` diupdate untuk memanggil RPC ini, pola retry/orphan-delivery yang lama sudah dihapus dari `AlokasiKirimPage.tsx`.
- **[SELESAI — migration 0010]** ~~Validasi qty vs saldo batch_line di Alokasi & Kirim cuma client-side, belum ada DB-level guard terhadap race condition~~: `AlokasiKirimPage` mengecek `qty <= balance_kg` di JavaScript sebelum submit (pakai saldo yang di-fetch lewat `get_available_batch_lines` beberapa saat sebelumnya), tapi tidak ada CHECK/trigger di database yang re-verifikasi saldo pada saat `INSERT INTO delivery_allocations` benar-benar terjadi. Kalau 2 user mengalokasikan dari `batch_line_id` yang sama secara bersamaan (concurrent), keduanya bisa lolos validasi client (karena masing-masing membaca saldo "lama" yang sama-sama masih terlihat cukup), dan hasil akhirnya stok bisa over-allocated (`inventory_ledger` boleh saja jadi negatif — tidak ada CHECK yang melarang saldo negatif). WAJIB ditangani (constraint atau trigger yang re-check `SUM(inventory_ledger.qty_kg)` sisa terhadap `qty_kg` yang mau diinsert, di level DB) sebelum ada lebih dari satu user aktif input alokasi secara bersamaan.
  **Resolusi**: `create_delivery_with_allocations()` (migration 0010) mengunci baris `batch_lines` terkait (`SELECT ... FOR UPDATE OF bl`, diurutkan by `batch_line_id` untuk cegah deadlock) sebelum menghitung ulang `SUM(inventory_ledger.qty_kg)` dan membandingkannya dengan qty yang diminta — dalam transaksi yang sama dengan insert `deliveries`/`delivery_allocations`, jadi race condition maupun kegagalan validasi sama-sama rollback total.
  **KOREKSI (migration 0013)**: resolusi di atas ternyata KELIRU untuk role lapangan. `SELECT ... FOR UPDATE` di tabel ber-RLS juga mensyaratkan lolos policy UPDATE, dan `batch_lines_update` owner-only — jadi untuk `lead_lapangan`/`staf_lapangan` baris tersaring diam-diam dan RPC melempar "batch_line_id tidak ditemukan" (hanya owner yang bisa alokasi). Terverifikasi lewat simulasi role di DB produksi. Migration 0013 mengganti row-lock dengan `pg_advisory_xact_lock` per batch_line (tetap SECURITY INVOKER, tanpa policy UPDATE baru). PELAJARAN: setiap klaim "RLS aman" untuk sebuah function WAJIB diuji dengan simulasi SETIAP role yang memanggilnya (set local role authenticated + request.jwt.claims), bukan cuma owner.
- **[SELESAI — migration 0016/0017]** ~~`users` belum punya site/track scoping (KETERBATASAN SENGAJA untuk fase pilot, BUKAN bug)~~: tabel `users` cuma punya kolom `id`, `full_name`, `role` — tidak ada `site_id` atau `track`. Konsekuensinya, SEMUA `lead_lapangan`/`staf_lapangan` otomatis bisa akses SEMUA site (trading maupun budidaya) lewat RLS yang ada sekarang — tidak ada mekanisme "staf ini cuma boleh site A" atau "staf ini cuma boleh track trading/budidaya". Ini keputusan sadar untuk tim pilot yang masih kecil dan saling percaya (sudah dicatat sejak komentar migration 0003, "Belum ada pembatasan per site pada fase pilot ini"). WAJIB direvisit (tambah kolom scoping di `users` + policy RLS yang memfilter berdasarkan itu, di semua tabel operasional yang relevan) SEBELUM: (a) tim bertambah di luar circle awal, atau (b) ada kebutuhan pemisahan akses per-track yang lebih ketat (mis. staf budidaya tidak boleh melihat data trading sama sekali) — jangan onboarding staf baru dengan asumsi scoping ini sudah ada, karena belum.
  **Resolusi**: migration 0016 menambah tabel `user_sites` (penugasan user ke site; track mengikuti `sites.type`) dan helper `user_can_access_site()` (SECURITY DEFINER, owner selalu true). Migration 0017 mengganti (ALTER POLICY) policy SELECT/INSERT di semua tabel operasional yang terikat site supaya lead/staf hanya bisa site yang ditugaskan; user lapangan tanpa penugasan tidak melihat apa pun (gagal-tertutup). Diuji dengan simulasi role (hanya-Sorong, hanya-Banggai, lintas-site) sebelum diterapkan. Halaman Manajemen User mengatur penugasan. SISA (sengaja): `demands`, `customers`, `suppliers`, `products` tetap global karena tidak punya `site_id`; pesan error mortalitas di site tak-ditugaskan berbunyi "saldo tidak cukup" (trigger guard jalan sebelum RLS) — tetap ditolak, hanya pesannya kurang tepat.
- **Trigger `fn_users_protect_role` (migration 0012) belum menganggap koneksi `service_role` sebagai trusted**: fix di 0012 membedakan "ada konteks request JWT" (`current_setting('request.jwt.claims', true) is not null`) vs "koneksi DB langsung tanpa JWT" (SQL Editor). Tapi panggilan lewat REST API pakai `service_role` key (mis. dari job otomatis/backend service di masa depan) **tetap punya konteks JWT** — `service_role` key itu sendiri adalah JWT dengan claim `role: "service_role"`, jadi `v_has_request_context` tetap `TRUE` untuk itu, BUKAN `FALSE` seperti koneksi SQL Editor. Konsekuensinya: kalau nanti ada backend service/cron job yang connect lewat REST API pakai `service_role` key (bukan raw SQL) dan mencoba insert/update `users.role`, trigger ini kemungkinan BESAR akan tetap menolaknya (karena `auth_user_role()` juga tidak akan bernilai `'owner'` untuk request service_role yang tidak terasosiasi user manapun) — padahal `service_role` seharusnya bisa bypass pembatasan semacam ini. WAJIB ditest eksplisit begitu backend service pertama yang pakai `service_role` key dibangun dan perlu menyentuh tabel `users`. Kalau ternyata bermasalah, kemungkinan perlu deteksi tambahan lewat `auth.role() = 'service_role'` (bukan cuma cek ada/tidaknya request context saja).
- **Manajemen User belum bisa membuat akun baru**: halaman `Admin > Manajemen User` hanya mengubah role user yang SUDAH punya akun. Membuat akun (auth.users) butuh Supabase Admin API / `service_role` key yang TIDAK BOLEH ada di frontend (aturan #5). Saat ini akun baru dibuat manual lewat dashboard Supabase Auth + insert ke `public.users`. Undangan user dari UI butuh Edge Function server-side (sekaligus menjadi kasus uji pertama untuk catatan `fn_users_protect_role` + `service_role` di atas).
- **`quality_inspections.grade` teks bebas**: skala grade (A/B/C, dsb.) belum ditetapkan, jadi form Inspeksi Kualitas tidak membatasi nilainya. Tetapkan skala + CHECK/enum sebelum ada laporan yang mengagregasi berdasarkan grade.
