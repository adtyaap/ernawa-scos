-- =============================================================================
-- Lobster SC OS (Ernawa) — Fix: Bootstrap Owner Pertama Lewat SQL Editor
-- =============================================================================
-- BUG YANG DITUTUP: trigger fn_users_protect_role (migration 0003) menolak
-- SEMUA insert/update yang menyertakan `role` kalau auth_user_role() bukan
-- 'owner' — termasuk saat dijalankan dari SQL Editor Supabase langsung.
--
-- Klaim di komentar migration 0003 dulu ("bootstrap owner pertama aman
-- lewat SQL Editor karena bypass RLS") SALAH: RLS-bypass dan trigger-bypass
-- itu DUA MEKANISME BERBEDA. Superuser/pemilik tabel memang bypass RLS
-- secara default, TAPI trigger BEFORE INSERT/UPDATE biasa tetap jalan
-- untuk SEMUA role termasuk superuser (kecuali eksplisit di-DISABLE).
--
-- Di koneksi SQL Editor (koneksi Postgres langsung, bukan lewat PostgREST),
-- tidak ada konteks JWT sama sekali — auth.uid() bernilai NULL, jadi
-- auth_user_role() juga NULL, dan pengecekan lama (`coalesce(...,'') <>
-- 'owner'`) selalu TRUE untuk kasus ini → INSERT owner pertama ditolak
-- dengan pesan "Hanya owner yang boleh menetapkan role user baru." —
-- padahal itu justru satu-satunya jalur yang seharusnya bisa dipakai untuk
-- bootstrap.
--
-- FIX: bedakan "ada konteks request PostgREST/JWT" (cek
-- `current_setting('request.jwt.claims', true)`) vs "koneksi DB langsung
-- (SQL Editor/migration script)". Proteksi role-only-owner TETAP berlaku
-- penuh untuk insert/update yang datang lewat aplikasi (ada konteks
-- request) — perilaku lama tidak berubah sama sekali untuk jalur itu.
-- Untuk koneksi DB langsung (tidak ada konteks request), pengecekan ini
-- dilewati — TIDAK menambah risiko baru: siapa pun yang sudah punya akses
-- SQL Editor/koneksi Postgres langsung ke project ini sudah punya kontrol
-- penuh terlepas dari trigger ini (bisa saja DISABLE TRIGGER atau ubah data
-- apa pun secara langsung) — gerbang keamanan sesungguhnya untuk jalur ini
-- adalah kredensial akun Supabase project, bukan trigger ini.
--
-- Migration ini HANYA mengubah 1 function (CREATE OR REPLACE FUNCTION,
-- trigger yang sudah ada tetap menunjuk ke function yang sama, tidak perlu
-- dibuat ulang). Tidak ada DROP/ALTER apa pun. JANGAN dieksekusi ke
-- database sebelum direview oleh pengguna.
-- =============================================================================

create or replace function fn_users_protect_role()
returns trigger
language plpgsql
as $$
declare
  v_has_request_context boolean;
begin
  -- NULL berarti koneksi DB langsung (SQL Editor/migration script), bukan
  -- lewat PostgREST/aplikasi — di situ tidak akan pernah ada auth.uid().
  v_has_request_context := current_setting('request.jwt.claims', true) is not null;

  if TG_OP = 'INSERT' then
    if v_has_request_context and NEW.role is not null and coalesce(auth_user_role(), '') <> 'owner' then
      raise exception 'Hanya owner yang boleh menetapkan role user baru.';
    end if;
  elsif TG_OP = 'UPDATE' then
    if v_has_request_context and NEW.role is distinct from OLD.role and coalesce(auth_user_role(), '') <> 'owner' then
      raise exception 'Hanya owner yang boleh mengubah role user.';
    end if;
  end if;

  return NEW;
end;
$$;
