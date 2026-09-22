-- =============================================================================
-- Lobster SC OS (Ernawa) — Catatan Bebas per Customer (PRD C3)
-- =============================================================================
-- KEPUTUSAN (dari pengguna): acceptance_policy yang dulu dibahas TERNYATA
-- dimaksudkan sebagai catatan teks bebas per customer (informasional, TIDAK
-- divalidasi sistem) — bukan kriteria terstruktur yang ditegakkan otomatis
-- saat alokasi.
--
-- Kolom `customers.acceptance_policy` (jsonb, migration 0001) SENGAJA TIDAK
-- dipakai untuk ini: kolom itu dirancang untuk kriteria terstruktur yang
-- divalidasi sistem — bukan kebutuhan sekarang. Memakainya untuk teks bebas
-- cuma menambah kerumitan (parsing JSON) tanpa manfaat. Ditambah kolom baru
-- yang lebih pas: `customers.notes text`, nullable, tanpa validasi/parsing.
-- `acceptance_policy` DIBIARKAN seperti semula (tidak di-drop) — bisa dipakai
-- lagi nanti kalau kebutuhan validasi terstruktur benar-benar muncul.
--
-- Migration ini HANYA ADD COLUMN. Tidak ada DROP/DELETE/TRUNCATE. JANGAN
-- dieksekusi sebelum direview.
-- =============================================================================

alter table customers add column notes text;

comment on column customers.notes is 'Catatan bebas per customer (informasional, TIDAK divalidasi sistem). Beda dari acceptance_policy (jsonb, belum dipakai — untuk kriteria terstruktur di masa depan).';
