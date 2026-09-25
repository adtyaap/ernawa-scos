-- Fungsi baru 0048-0050 ikut default grant EXECUTE ke PUBLIC (termasuk anon).
-- Isinya sudah kosong utk anon (cek auth_user_role() / RLS), tapi disamakan
-- dgn fungsi investor_* lama yang hanya bisa dipanggil user login
-- (get_advisors lint anon_security_definer_function_executable).
revoke execute on function investor_trading_delivery_pnl() from public, anon;
revoke execute on function investor_supplier_payables() from public, anon;
revoke execute on function investor_trading_mortality_cost() from public, anon;
revoke execute on function get_trading_finance_summary() from public, anon;
revoke execute on function get_live_inventory() from public, anon;

grant execute on function investor_trading_delivery_pnl() to authenticated;
grant execute on function investor_supplier_payables() to authenticated;
grant execute on function investor_trading_mortality_cost() to authenticated;
grant execute on function get_trading_finance_summary() to authenticated;
grant execute on function get_live_inventory() to authenticated;
