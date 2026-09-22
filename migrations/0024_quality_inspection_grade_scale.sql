-- =============================================================================
-- Lobster SC OS (Ernawa) — Skala Grade Inspeksi Kualitas: A/B/C (PRD C2)
-- =============================================================================
-- KEPUTUSAN (dari pengguna): skala A/B/C dulu, bisa diperluas nanti (mis.
-- tambah Reject) kalau kebutuhan lapangan sudah jelas.
--
-- quality_inspections.grade sebelumnya teks bebas ("A", "a", "Grade A" semua
-- dianggap beda), sehingga tidak bisa diagregasi. Migration ini:
--   1. Normalisasi data lama: trim + uppercase, dan nilai yang TIDAK cocok
--      A/B/C diarahkan ke NULL (bukan dihapus barisnya — CLAUDE.md tidak
--      melarang UPDATE tabel non-ledger, dan ini cuma menstandarkan nilai,
--      bukan mengoreksi kejadian). Baris quality_inspections BUKAN ledger,
--      jadi bukan cakupan aturan #3 (append-only itu untuk inventory_ledger).
--   2. CHECK constraint: grade harus NULL atau salah satu dari 'A','B','C'.
--
-- SEBELUM DIJALANKAN, jalankan dulu untuk melihat baris yang akan menjadi NULL
-- (kalau ada) supaya tidak mengejutkan:
--   select id, grade from quality_inspections where grade is not null and upper(btrim(grade)) not in ('A','B','C');
--
-- Migration ini mengandung UPDATE (normalisasi, bukan DELETE/DROP) dan ADD
-- CONSTRAINT — BUKAN operasi destruktif menurut CLAUDE.md #8 (tidak ada DROP/
-- TRUNCATE/DELETE massal/DROP COLUMN), tapi tetap ditampilkan penuh untuk
-- direview karena mengubah data yang sudah ada. JANGAN dieksekusi sebelum
-- direview.
-- =============================================================================

update quality_inspections
set grade = upper(btrim(grade))
where grade is not null and upper(btrim(grade)) <> grade;

update quality_inspections
set grade = null
where grade is not null and grade not in ('A', 'B', 'C');

alter table quality_inspections
  add constraint quality_inspections_grade_check check (grade in ('A', 'B', 'C'));

comment on column quality_inspections.grade is 'Skala A/B/C (migration 0024). NULL = belum dinilai.';
