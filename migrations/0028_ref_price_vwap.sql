-- =============================================================================
-- Lobster SC OS (Ernawa) — Acuan Harga: ref_price() dengan fallback VWAP (F13)
-- =============================================================================
-- ASUMSI PENTING (beda dari PRD sumber, disesuaikan dengan data yang BENAR-
-- BENAR ADA di skema ini — bukan mengarang tabel baru):
--   * VWAP dihitung dari `receiving_lots` (qty_kg x buy_price_per_kg), BUKAN
--     dari transaksi jual. Alasan: receiving_lots satu baris = satu produk,
--     bersih untuk diagregasi. Data jual (settlements.amount) adalah nilai
--     PER DELIVERY yang bisa berisi lebih dari satu produk sekaligus (alokasi
--     lintas produk, migration 0026 baru menegaskan ini valid) — tidak ada
--     cara akurat memecah amount itu per produk tanpa mengarang asumsi. Untuk
--     bisnis pengepul (Ernawa beli dari nelayan setiap hari), acuan harga BELI
--     historis ini justru yang paling relevan dipakai sebagai referensi.
--   * "Harga katalog statis" (tier terakhir di PRD sumber) TIDAK diimplementasi
--     — tidak ada tabel harga katalog di skema ini, dan menambahkannya tanpa
--     data riil hanya mengarang. Fallback berhenti di VWAP30; kalau tetap
--     tidak ada data, hasilnya NULL eksplisit.
--   * FR-PRICE-002 (warning spread minimum thd "acuan jual") SENGAJA TIDAK
--     dibangun di sini — itu perlu referensi harga JUAL per produk yang akurat,
--     yang skema saat ini belum bisa hitung dengan benar (lihat poin di atas).
--     Dicatat sebagai item terbuka di CLAUDE.md, bukan dipaksakan dengan asumsi
--     lemah.
--
-- Fallback chain final (5 tingkat, bukan 6 seperti PRD sumber):
--   1. Override manual hari ini (price_today, sudah ada sejak 0001)
--   2. VWAP7 di site yang diminta (receiving_lots 7 hari terakhir, site itu)
--   3. VWAP7 gabungan semua site (kalau site itu kosong)
--   4. VWAP30 gabungan semua site
--   5. NULL eksplisit (bukan 0) + source='none'
--
-- ref_price() SECURITY INVOKER (default, tidak ditulis eksplisit): saldo
-- dihitung dari receiving_lots/receiving_transactions dengan RLS PEMANGGIL
-- sendiri (site-scoped sejak 0017) — user yang tidak ditugaskan ke suatu site
-- otomatis tidak melihat data harga site itu, tanpa perlu logika tambahan.
--
-- price_today_update ditambah (owner-only) supaya override hari yang sama
-- bisa dikoreksi (upsert), bukan gagal karena unique constraint. Ini BUKAN
-- ledger transaksi (aturan #2/#3 CLAUDE.md soal append-only berlaku untuk
-- inventory_ledger) — price_today adalah snapshot acuan harga hari berjalan.
--
-- Migration ini HANYA CREATE FUNCTION + CREATE POLICY. Tidak ada DROP/DELETE/
-- TRUNCATE. JANGAN dieksekusi sebelum direview.
-- =============================================================================

create policy price_today_update on price_today for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create or replace function ref_price(p_product_id uuid, p_site_id uuid, p_date date default current_date)
returns table (price numeric, source text)
language plpgsql
stable
as $$
declare
  v_price numeric;
begin
  select pt.price into v_price
  from price_today pt
  where pt.product_id = p_product_id and pt.site_id = p_site_id and pt.effective_date = p_date;
  if v_price is not null then
    price := v_price; source := 'override'; return next; return;
  end if;

  select sum(rl.qty_kg * rl.buy_price_per_kg) / nullif(sum(rl.qty_kg), 0)
  into v_price
  from receiving_lots rl
  join receiving_transactions rt on rt.id = rl.receiving_transaction_id
  where rl.product_id = p_product_id
    and rt.site_id = p_site_id
    and rt.transaction_date > p_date - 7
    and rt.transaction_date <= p_date;
  if v_price is not null then
    price := v_price; source := 'vwap7_site'; return next; return;
  end if;

  select sum(rl.qty_kg * rl.buy_price_per_kg) / nullif(sum(rl.qty_kg), 0)
  into v_price
  from receiving_lots rl
  join receiving_transactions rt on rt.id = rl.receiving_transaction_id
  where rl.product_id = p_product_id
    and rt.transaction_date > p_date - 7
    and rt.transaction_date <= p_date;
  if v_price is not null then
    price := v_price; source := 'vwap7_all_site'; return next; return;
  end if;

  select sum(rl.qty_kg * rl.buy_price_per_kg) / nullif(sum(rl.qty_kg), 0)
  into v_price
  from receiving_lots rl
  join receiving_transactions rt on rt.id = rl.receiving_transaction_id
  where rl.product_id = p_product_id
    and rt.transaction_date > p_date - 30
    and rt.transaction_date <= p_date;
  if v_price is not null then
    price := v_price; source := 'vwap30_all_site'; return next; return;
  end if;

  price := null; source := 'none'; return next; return;
end;
$$;

revoke all on function ref_price(uuid, uuid, date) from public, anon;
grant execute on function ref_price(uuid, uuid, date) to authenticated;
