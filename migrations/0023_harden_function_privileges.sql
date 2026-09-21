-- =============================================================================
-- Lobster SC OS (Ernawa) — Pengerasan hak eksekusi & search_path fungsi
-- =============================================================================
-- Menindaklanjuti advisor keamanan Supabase (tidak ada temuan kritis):
--
-- 1. REVOKE EXECUTE atas 14 fungsi TRIGGER dari public/anon/authenticated.
--    Sebelumnya fungsi-fungsi ini terekspos sebagai /rest/v1/rpc/<nama>. Tidak
--    bisa dijalankan langsung (fungsi trigger hanya boleh dipanggil oleh
--    trigger), tapi tidak ada alasan membiarkannya terekspos, apalagi 8 di
--    antaranya SECURITY DEFINER. Mencabut EXECUTE TIDAK memengaruhi eksekusi
--    trigger: Postgres hanya memeriksa privilege EXECUTE saat CREATE TRIGGER,
--    bukan saat trigger menyala.
--
-- 2. SET search_path = public pada 12 fungsi SECURITY INVOKER yang belum
--    mengunci search_path (6 fungsi trigger + 6 RPC). Semua objek yang dirujuk
--    ada di schema public; auth.uid() dan fungsi bawaan (pg_catalog selalu
--    dicari lebih dulu) tidak terpengaruh.
--
-- TIDAK DISENTUH (sengaja):
--   * auth_user_role(), user_can_access_site(), demand_allocated_kg(),
--     investor_*(): SECURITY DEFINER yang MEMANG dimaksudkan bisa dipanggil
--     user login (dipakai di policy RLS / aplikasi).
--   * rls_auto_enable(): bukan buatan migration proyek ini (kemungkinan bawaan
--     Supabase untuk "otomatis aktifkan RLS"); search_path-nya sudah terkunci.
--
-- Migration ini HANYA REVOKE dan ALTER FUNCTION ... SET. Tidak ada DROP/DELETE/
-- TRUNCATE dan tidak ada perubahan perilaku fungsi. JANGAN dieksekusi sebelum
-- direview.
-- =============================================================================

-- ---------------- 1. fungsi trigger: cabut EXECUTE ---------------------------
revoke all on function fn_batch_lines_ledger() from public, anon, authenticated;
revoke all on function fn_deliveries_restrict_field_update() from public, anon, authenticated;
revoke all on function fn_delivery_allocations_ledger() from public, anon, authenticated;
revoke all on function fn_delivery_allocations_site_guard() from public, anon, authenticated;
revoke all on function fn_demands_restrict_field_update() from public, anon, authenticated;
revoke all on function fn_handover_lines_ledger() from public, anon, authenticated;
revoke all on function fn_mortality_events_balance_guard() from public, anon, authenticated;
revoke all on function fn_mortality_events_ledger() from public, anon, authenticated;
revoke all on function fn_settlements_mode_override_guard() from public, anon, authenticated;
revoke all on function fn_stock_adjustments_balance_guard() from public, anon, authenticated;
revoke all on function fn_stock_adjustments_ledger() from public, anon, authenticated;
revoke all on function fn_user_sites_audit() from public, anon, authenticated;
revoke all on function fn_users_protect_role() from public, anon, authenticated;
revoke all on function ledger_immutable() from public, anon, authenticated;

-- ---------------- 2. kunci search_path fungsi INVOKER ------------------------
alter function fn_deliveries_restrict_field_update() set search_path = public;
alter function fn_demands_restrict_field_update() set search_path = public;
alter function fn_mortality_events_balance_guard() set search_path = public;
alter function fn_stock_adjustments_balance_guard() set search_path = public;
alter function fn_users_protect_role() set search_path = public;
alter function ledger_immutable() set search_path = public;

alter function cancel_delivery(uuid, text) set search_path = public;
alter function create_delivery_with_allocations(uuid, uuid, jsonb, text) set search_path = public;
alter function create_ledger_reversal(uuid, text) set search_path = public;
alter function create_receiving_with_batch(uuid, uuid, uuid, date, jsonb) set search_path = public;
alter function get_available_batch_lines(uuid) set search_path = public;
alter function get_or_create_batch(uuid, uuid, date) set search_path = public;
