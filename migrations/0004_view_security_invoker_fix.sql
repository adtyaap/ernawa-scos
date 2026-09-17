-- =============================================================================
-- Lobster SC OS (Ernawa) — Fix: View Harus Menghormati RLS (security_invoker)
-- =============================================================================
-- CELAH YANG DITUTUP: v_batch_line_balance, v_inventory_ledger_with_track,
-- dan v_cash_ledger_with_track dibuat di migration 0001 TANPA
-- security_invoker=true. Default Postgres (security_invoker=false) membuat
-- view berjalan dengan hak akses PEMILIK view (biasanya role superuser yang
-- menjalankan migration), BUKAN hak akses user yang melakukan query — dan
-- superuser/pemilik tabel BYPASS RLS sepenuhnya. Karena Supabase secara
-- default meng-GRANT akses ke role `authenticated` untuk objek baru di
-- schema public, ini berarti SIAPA PUN yang authenticated bisa
-- `SELECT * FROM v_cash_ledger_with_track` dan melihat SELURUH isi
-- cash_ledger lintas semua site — padahal migration 0003 sudah membatasi
-- cash_ledger cuma untuk role owner. RLS di tabel asli jadi percuma kalau
-- diakses lewat view ini.
--
-- FIX:
--   1. ALTER VIEW ... SET (security_invoker = true) di ketiganya — sekarang
--      view mengevaluasi RLS SEBAGAI user yang melakukan query, memakai
--      policy yang SUDAH ada di tabel asli (inventory_ledger, cash_ledger).
--      Butuh Postgres 15+ (opsi ini tidak ada di versi lebih lama — Supabase
--      hosted Postgres sudah 15+ sejak lama, tapi tetap dicek dulu sebelum
--      dijalankan kalau project ini pakai versi custom/lama).
--   2. REVOKE + GRANT eksplisit ke role `authenticated` saja (bukan PUBLIC/
--      anon), supaya gerbang akses Postgres-level konsisten dengan tabel
--      aslinya. CATATAN PENTING: 'owner'/'lead_lapangan'/'staf_lapangan'/
--      'investor' adalah nilai kolom users.role di level aplikasi, BUKAN
--      Postgres ROLE — jadi tidak ada mekanisme GRANT SELECT ... TO owner
--      di level Postgres. Pembatasan per-role aplikasi (mis. cash_ledger
--      cuma owner) SEPENUHNYA bergantung pada RLS policy tabel asli, yang
--      sekarang baru benar-benar berlaku di view berkat security_invoker.
--      GRANT ke `authenticated` di sini cuma gerbang kasar (blok anon),
--      RLS-lah yang menyaring baris per role aplikasi.
--
-- Migration ini HANYA mengubah opsi view (ALTER VIEW) dan privilege
-- (REVOKE/GRANT). Tidak ada perubahan data atau tabel. JANGAN dieksekusi ke
-- database sebelum direview oleh pengguna.
-- =============================================================================

alter view v_batch_line_balance set (security_invoker = true);
alter view v_inventory_ledger_with_track set (security_invoker = true);
alter view v_cash_ledger_with_track set (security_invoker = true);

-- REVOKE eksplisit dari public, anon, DAN authenticated (bukan cuma public):
-- default privilege Supabase biasanya meng-GRANT langsung ke role anon &
-- authenticated (bukan lewat pseudo-role PUBLIC), jadi "revoke ... from
-- public" saja tidak menghapus grant itu. Setelah bersih, baru GRANT SELECT
-- ulang ke authenticated saja.
revoke all on v_batch_line_balance from public, anon, authenticated;
revoke all on v_inventory_ledger_with_track from public, anon, authenticated;
revoke all on v_cash_ledger_with_track from public, anon, authenticated;

-- SELECT hasil akhir ke masing-masing view tetap ditentukan oleh RLS tabel
-- asli (sekarang benar-benar berlaku berkat security_invoker=true):
--   - v_batch_line_balance & v_inventory_ledger_with_track → mengikuti RLS
--     inventory_ledger (SELECT: owner + lead_lapangan + staf_lapangan).
--   - v_cash_ledger_with_track → mengikuti RLS cash_ledger (SELECT: owner
--     saja). lead_lapangan/staf_lapangan/investor akan mendapat 0 baris
--     walau granted SELECT di level Postgres, karena tidak ada RLS policy
--     yang cocok untuk mereka di cash_ledger.
grant select on v_batch_line_balance to authenticated;
grant select on v_inventory_ledger_with_track to authenticated;
grant select on v_cash_ledger_with_track to authenticated;
