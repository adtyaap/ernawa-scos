-- =============================================================================
-- Lobster SC OS (Ernawa) — Seed Data Awal (Dev/Testing)
-- =============================================================================
-- Data di file ini adalah FIXTURE DEMO untuk mulai dev/testing lokal, BUKAN
-- data produksi. Ganti/hapus sebelum go-live. UUID dibuat tetap (bukan
-- gen_random_uuid()) supaya bisa direferensikan dengan predictable di
-- migration/seed lanjutan atau di test.
--
-- Tidak ada baris di-insert ke `users` — tabel itu 1:1 dengan auth.users
-- (auth.uid()) dan hanya bisa terisi lewat flow Supabase Auth sungguhan,
-- bukan lewat migration SQL.
--
-- Migration ini HANYA insert (tidak destruktif). JANGAN dieksekusi ke
-- database sebelum direview oleh pengguna.
-- =============================================================================

-- =============================================================================
-- SITES — satu site trading, satu site budidaya (belum beroperasi)
-- =============================================================================

insert into sites (id, name, type, monthly_cost) values
  ('00000000-0000-0000-0000-000000000001', 'Ernawa Trading (Demo)', 'trading', 0),
  ('00000000-0000-0000-0000-000000000002', 'Ernawa Budidaya Cimahi (Demo)', 'budidaya', 0);

-- =============================================================================
-- TANKS
-- =============================================================================
-- Trading: satu tank untuk refreshment/penampungan sementara (jam-hari).
-- Budidaya: beberapa tank untuk tahap grow-out berbeda (10-20 bulan).

insert into tanks (id, site_id, name) values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Tank Refreshment 1'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000002', 'Kolam Grow-out 1'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000002', 'Kolam Grow-out 2');

-- =============================================================================
-- SUPPLIERS & CUSTOMERS
-- =============================================================================

insert into suppliers (id, name) values
  ('00000000-0000-0000-0000-000000000021', 'Supplier Demo 1');

insert into customers (id, name, acceptance_policy, settlement_mode) values
  ('00000000-0000-0000-0000-000000000031', 'Customer Demo 1', '{}'::jsonb, 'cod');

-- =============================================================================
-- PRODUCTS & PRODUCT_HOLDING_POLICY
-- =============================================================================
-- max_holding_hours berbeda jauh antar track untuk produk yang sama:
--   trading  = refreshment, skala jam-hari (di sini: 48 jam / 2 hari)
--   budidaya = grow-out, skala bulan (di sini: 14.600 jam ~ 20 bulan)

insert into products (id, name) values
  ('00000000-0000-0000-0000-000000000041', 'Lobster (Demo)');

insert into product_holding_policy (product_id, track, max_holding_hours) values
  ('00000000-0000-0000-0000-000000000041', 'trading', 48),
  ('00000000-0000-0000-0000-000000000041', 'budidaya', 14600);
