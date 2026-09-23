-- Anggaran vs Realisasi bulanan (gap Finance #4 dari PRD v1 lama, Bagian
-- 7.5: "laporan varians budget-vs-actual bulanan"). Dikonfirmasi user lewat
-- pertanyaan eksplisit sebelum dibangun: cakupan Revenue + Opex (bukan cuma
-- salah satu), per track+bulan (aturan #1), config data biasa (bukan ledger
-- append-only -- pola sama seperti finance_targets/product_holding_policy:
-- Owner boleh UPDATE langsung, bukan koreksi-lewat-reversal, karena ini
-- ANGKA TARGET, bukan catatan transaksi yang sudah terjadi).
--
-- Akses baca: dibuat SELUAS finance_targets (owner/lead/staf/investor) --
-- ini target/config, bukan ledger transaksi sensitif seperti
-- company_cash_ledger, jadi tidak perlu dibatasi seketat itu.
--
-- Revenue actual: dari v_trading_delivery_margin (sudah exclude batal &
-- filter site.type='trading' sendiri) di-join ke deliveries.delivered_at utk
-- pengelompokan bulan -- budidaya otomatis selalu 0 (belum ada delivery/
-- settlement track budidaya, sesuai kenyataan operasional saat ini).
-- Opex actual: dari company_cash_ledger kategori 'opex' (migration 0040),
-- amount dibalik tanda (disimpan negatif di sana, ditampilkan positif di
-- sini sebagai "jumlah dibelanjakan").
--
-- get_budget_actuals() SECURITY DEFINER: company_cash_ledger SELECT
-- owner-only (migration 0040), tapi laporan varians ini boleh dilihat
-- lead/staf/investor juga -- makanya WAJIB definer (pola sama seperti
-- investor_* di migration 0022), hanya mengembalikan angka AGREGAT (bukan
-- baris mentah), dan tetap menolak (0 baris) kalau caller bukan salah satu
-- dari 4 role yang diizinkan.

create table finance_budgets (
  track text not null check (track in ('trading', 'budidaya')),
  period_month date not null check (extract(day from period_month) = 1),
  line_item text not null check (line_item in ('revenue', 'opex')),
  budget_amount numeric not null check (budget_amount >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  primary key (track, period_month, line_item)
);

comment on table finance_budgets is 'Target anggaran bulanan per track+line_item. Config data (boleh UPDATE langsung, bukan append-only) -- konsisten pola finance_targets/product_holding_policy. period_month selalu tanggal 1 (representasi bulan).';
comment on column finance_budgets.line_item is 'revenue (target pendapatan) | opex (target biaya operasional).';

alter table finance_budgets enable row level security;

create policy finance_budgets_select on finance_budgets
  for select to authenticated
  using ((select auth_user_role()) in ('owner', 'lead_lapangan', 'staf_lapangan', 'investor'));

create policy finance_budgets_insert on finance_budgets
  for insert to authenticated
  with check ((select auth_user_role()) = 'owner');

create policy finance_budgets_update on finance_budgets
  for update to authenticated
  using ((select auth_user_role()) = 'owner')
  with check ((select auth_user_role()) = 'owner');

create or replace function get_budget_actuals(p_track text, p_period_month date)
returns table(revenue_actual numeric, opex_actual numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    case when p_track = 'trading' then coalesce((
      select sum(vtdm.revenue)
      from v_trading_delivery_margin vtdm
      join deliveries d on d.id = vtdm.delivery_id
      where date_trunc('month', d.delivered_at) = date_trunc('month', p_period_month)
    ), 0) else 0 end as revenue_actual,
    coalesce((
      select -sum(ccl.amount)
      from company_cash_ledger ccl
      where ccl.track = p_track
        and ccl.category = 'opex'
        and date_trunc('month', ccl.event_at) = date_trunc('month', p_period_month)
    ), 0) as opex_actual
  where (select auth_user_role()) in ('owner', 'lead_lapangan', 'staf_lapangan', 'investor');
$$;

revoke all on function get_budget_actuals(text, date) from public, anon;
grant execute on function get_budget_actuals(text, date) to authenticated;
