-- =============================================================================
-- Lobster SC OS (Ernawa) — Tambah Kolom Kontak & Status ke suppliers
-- =============================================================================
-- Non-destruktif: HANYA ALTER TABLE ... ADD COLUMN + 1 CHECK constraint.
-- Tidak ada DROP TABLE/COLUMN, tidak ada perubahan data existing (kolom
-- baru nullable atau punya default, jadi baris lama otomatis kompatibel).
--
-- ALASAN:
--   - contact_person, phone, address: nullable — data lama/demo (mis. seed
--     0002) tidak perlu diisi ulang paksa.
--   - status ('aktif'/'nonaktif'), default 'aktif': pengganti fungsi
--     DELETE. suppliers di-reference oleh receiving_transactions (FK), dan
--     tidak ada policy DELETE untuk role manapun (dikonfirmasi dari 0001 +
--     0003 — tidak pernah ditambahkan). Menonaktifkan supplier = ubah
--     status, bukan hapus baris.
--
-- CATATAN RLS: TIDAK ADA perubahan policy di migration ini. Policy
-- suppliers_update dari 0003 (owner-only, `using/with check (auth_user_role()
-- = 'owner')`) sudah row-level, bukan per-kolom — jadi otomatis berlaku juga
-- untuk UPDATE kolom status begitu migration ini jalan, tanpa perlu policy
-- tambahan. Toggle aktif/nonaktif di frontend tetap wajib dibatasi UI-nya ke
-- role owner saja (RLS akan menolak diam-diam kalau tidak, tapi UI yang
-- konsisten mencegah pengalaman buruk seperti sebelumnya).
--
-- JANGAN dieksekusi ke database sebelum direview oleh pengguna.
-- =============================================================================

alter table suppliers
  add column contact_person text,
  add column phone text,
  add column address text,
  add column status text not null default 'aktif';

alter table suppliers
  add constraint suppliers_status_check check (status in ('aktif', 'nonaktif'));
