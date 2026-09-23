-- Pencatatan Pajak (gap Finance #1 terakhir dari PRD v1 lama, Bagian 7.5:
-- "penanganan pajak PPN/PPh"). Dikonfirmasi user lewat pertanyaan eksplisit
-- sebelum dibangun (BUKAN ditebak, krn implikasi salah asumsi soal status
-- pajak bisa serius):
--   1. Ernawa BELUM/BUKAN PKP -> TIDAK ADA kewajiban PPN sama sekali saat
--      ini. Cuma PPh yang relevan -- TIDAK membangun apa pun terkait PPN
--      (tidak ada field harga-termasuk-pajak, tidak ada PPN Keluaran/
--      Masukan). Kalau status PKP berubah di masa depan, ini perlu
--      migration terpisah dgn keputusan desain baru, BUKAN diasumsikan dari
--      sekarang.
--   2. Cukup MENCATAT pajak yang sudah dihitung/dibayar (mis. oleh
--      akuntan) -- BUKAN menghitung kewajiban pajak otomatis dari transaksi.
--      Tidak ada logika hitung PPh Final UMKM 0.5% dari omzet atau semacamnya
--      di sistem ini.
--   3. Dipecah per JENIS pajak (PPh Final UMKM, PPh 21, PPh 23, Lainnya) --
--      TETAP/hardcode (CHECK constraint), BEDA dari opex_categories yang
--      dikelola Owner dinamis (migration 0042), karena jenis PPh ditentukan
--      ATURAN PAJAK yang berlaku umum, bukan preferensi bisnis Ernawa
--      sendiri -- tidak masuk akal kalau Owner bisa "menambah jenis PPh
--      baru" sesuka hati lewat UI.
--
-- Pola: kategori baru 'tax' di company_cash_ledger (migration 0040) --
-- pajak yang dibayar itu sendiri MEMANG kas keluar level perusahaan, jadi
-- cocok masuk ledger yang sama, bukan tabel terpisah. `tax_type` kolom baru
-- (CHECK, bukan FK ke tabel terpisah spt opex_category_id -- daftarnya
-- tetap/tidak berubah-ubah) wajib diisi kalau category='tax', pola CHECK
-- constraint identik migration 0042.

alter table company_cash_ledger drop constraint company_cash_ledger_category_check;
alter table company_cash_ledger add constraint company_cash_ledger_category_check
  check (category in (
    'settlement_in', 'kas_panjar_topup_out', 'supplier_payment',
    'opex', 'other_in', 'other_out', 'adjustment', 'tax'
  ));

alter table company_cash_ledger add column tax_type text
  constraint company_cash_ledger_tax_type_valid_check
  check (tax_type in ('pph_final_umkm', 'pph_21', 'pph_23', 'pph_lainnya'));

alter table company_cash_ledger add constraint company_cash_ledger_tax_type_required_check
  check (category <> 'tax' or tax_type is not null);

comment on column company_cash_ledger.tax_type is 'Wajib diisi kalau category=''tax''. Jenis PPh TETAP (bukan dikelola Owner spt opex_category_id) krn ditentukan aturan pajak, bukan preferensi bisnis. Ernawa belum/bukan PKP -- tidak ada jenis PPN di sini, sengaja.';
