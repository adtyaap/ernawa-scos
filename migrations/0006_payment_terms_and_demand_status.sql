-- =============================================================================
-- Lobster SC OS (Ernawa) — Termin Pembayaran & Kunci Nilai demands.status
-- =============================================================================
-- Non-destruktif: HANYA ALTER TABLE ... ADD COLUMN + ADD CONSTRAINT. Tidak
-- ada DROP TABLE/COLUMN, tidak ada UPDATE data existing.
--
-- SEBELUM DIEKSEKUSI — WAJIB DICEK MANUAL DULU (tidak bisa diverifikasi dari
-- sesi ini, tidak ada koneksi live ke database):
--   1. Bagian 2 (demands_status_check) akan GAGAL kalau ada baris `demands`
--      existing dengan status di luar ('open','allocated','fulfilled',
--      'cancelled'). Jalankan dulu:
--        select distinct status, count(*) from demands
--        where status not in ('open','allocated','fulfilled','cancelled')
--        group by status;
--      Tidak ada migration manapun (0001/0002/0004/0005) yang meng-INSERT ke
--      demands, jadi kalau ada baris begini sumbernya pasti dari testing
--      manual lewat app/SQL editor.
--   2. Bagian 1 (customers_term_days_check) akan GAGAL kalau ada baris
--      `customers` existing dengan settlement_mode='term' tapi belum punya
--      payment_term_days (otomatis NULL karena kolom baru), atau
--      settlement_mode='cod' — untuk 'cod' aman (kolom baru default NULL,
--      constraint mengizinkan cod+NULL). Yang perlu dicek: apakah ada
--      customer 'term' existing (dari seed 0002 atau testing manual) yang
--      akan langsung melanggar constraint begitu kolom ditambahkan. Cek:
--        select id, name from customers
--        where settlement_mode = 'term';
--      (baris ini butuh payment_term_days diisi manual SEBELUM constraint
--      ditambahkan, atau ADD CONSTRAINT akan gagal).
--   3. Bagian 1 (settlements_due_date_check): sama logikanya untuk baris
--      `settlements` existing dengan mode='term' tanpa due_date. Cek:
--        select id from settlements where mode = 'term';
--
-- CATATAN DESAIN (dari pengguna): payment_term_days di customers = default
-- termin per customer (dipakai hanya saat settlement_mode='term'). due_date
-- di settlements disimpan EKSPLISIT saat settlement dibuat (dihitung dari
-- tanggal delivery + payment_term_days customer SAAT ITU), bukan dihitung
-- ulang dari payment_term_days yang berlaku sekarang — supaya perubahan
-- termin customer di masa depan tidak mengubah riwayat piutang lama secara
-- retroaktif.
--
-- CATATAN GAP ALUR (belum diputuskan, lihat diskusi terpisah): 4 nilai
-- demands.status ('open'/'allocated'/'fulfilled'/'cancelled') belum
-- mengakomodasi pengiriman parsial (deliveries.demand_id nullable & bukan
-- UNIQUE — satu demand bisa punya banyak deliveries). Menambah 'partial' di
-- masa depan tidak perlu mengubah trigger fn_demands_restrict_field_update
-- (trigger itu tidak peduli nilai spesifik status), cukup migration kecil
-- mengganti CHECK constraint ini.
--
-- Migration ini HANYA menambah kolom & constraint. JANGAN dieksekusi ke
-- database sebelum direview oleh pengguna DAN dua query verifikasi di atas
-- sudah dijalankan.
-- =============================================================================

-- =============================================================================
-- BAGIAN 1 — Termin pembayaran
-- =============================================================================

alter table customers
  add column payment_term_days integer;

alter table customers
  add constraint customers_term_days_check
  check (
    (settlement_mode = 'term' and payment_term_days is not null and payment_term_days > 0)
    or
    (settlement_mode = 'cod' and payment_term_days is null)
  );

alter table settlements
  add column due_date date;

alter table settlements
  add constraint settlements_due_date_check
  check (
    (mode = 'term' and due_date is not null)
    or
    (mode = 'cod' and due_date is null)
  );

-- =============================================================================
-- BAGIAN 2 — Kunci nilai demands.status
-- =============================================================================

alter table demands
  add constraint demands_status_check
  check (status in ('open', 'allocated', 'fulfilled', 'cancelled'));
