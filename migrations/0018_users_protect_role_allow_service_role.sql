-- =============================================================================
-- Lobster SC OS (Ernawa) — fn_users_protect_role mengenali service_role
-- =============================================================================
-- Menutup catatan tech debt "fn_users_protect_role (0012) belum menganggap
-- koneksi service_role sebagai trusted", yang kini nyata karena Edge Function
-- invite-user (PRD B1) menulis ke public.users lewat REST API dengan
-- service_role key.
--
-- MASALAH: service_role key adalah JWT (claim role = 'service_role'), jadi
-- request.jwt.claims TERISI dan pengecekan 0012 menganggapnya "request aplikasi
-- biasa", lalu auth_user_role() bernilai NULL (tidak ada user terkait) dan
-- trigger menolak insert/ubah role: "Hanya owner yang boleh...".
--
-- FIX: kalau claim role di JWT adalah 'service_role', lewati pengecekan.
-- Aman karena claim itu berasal dari JWT yang sudah diverifikasi PostgREST
-- (ditandatangani secret project) — client biasa tidak bisa memalsukannya, dan
-- service_role key memang hanya boleh ada di sisi server (CLAUDE.md #5). Semua
-- perilaku lain TIDAK berubah:
--   * request aplikasi biasa (anon/authenticated): tetap hanya owner yang boleh
--     menetapkan/mengubah role.
--   * koneksi DB langsung tanpa JWT (SQL Editor): tetap dilewati (0012).
--
-- Migration ini HANYA CREATE OR REPLACE FUNCTION (function yang sama, trigger
-- yang sudah ada tidak berubah). Tidak ada DROP/ALTER/DELETE.
-- JANGAN dieksekusi sebelum direview.
-- =============================================================================

create or replace function fn_users_protect_role()
returns trigger
language plpgsql
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_has_request_context boolean := (nullif(current_setting('request.jwt.claims', true), '') is not null);
  v_is_service_role boolean := coalesce((v_claims::jsonb ->> 'role') = 'service_role', false);
begin
  if v_is_service_role then
    return NEW;
  end if;

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
