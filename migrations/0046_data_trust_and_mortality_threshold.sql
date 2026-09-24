-- Dua gap terakhir dari audit Control Tower (perbandingan UI vs artifact
-- lama "Lobster Trading Control Tower") yang sebelumnya sengaja belum
-- diangkat: indikator data trust, dan ambang mortalitas. Dikonfirmasi user
-- eksplisit sebelum dibangun (keduanya konsep baru, tidak ada padanan
-- sama sekali di skema sekarang).
--
-- ============================================================
-- BAGIAN 1: Data Trust (checkbox "sudah diverifikasi" per transaksi)
-- ============================================================
-- Pola sama persis artifact lama: atestasi MANUAL saat entri (bukan
-- verifikasi otomatis/proses terpisah), lalu ditampilkan sbg % nilai
-- transaksi yang terverifikasi. Kolom `verified` cuma bisa diisi SAAT
-- INSERT (tidak ada UI edit belakangan -- sengaja, di luar cakupan yang
-- diminta; kalau perlu diubah nanti perlu diangkat terpisah).
--
-- Level granularitas: receiving_lots (setara "batch" di artifact lama --
-- satu baris produk dalam satu Terima Cepat) dan settlements (setara
-- "sale" -- satu baris per delivery). BUKAN nilai tunggal gabungan
-- receiving+settlement spt artifact lama (yg mencampur dua sisi berbeda
-- jadi satu skor) -- ditampilkan TERPISAH (trust Penerimaan vs trust
-- Settlement) supaya lebih actionable, sekaligus konsisten prinsip proyek
-- "jangan menggabungkan angka yang beda maknanya jadi satu".
--
-- View per TRACK (aturan #1) meski budidaya otomatis kosong (belum
-- beroperasi) -- security_invoker spt semua view Finance lain, plus
-- investor_* DEFINER wrapper (pola migration 0022) karena FinancePage
-- juga dibaca investor.

alter table receiving_lots add column verified boolean not null default false;
alter table settlements add column verified boolean not null default false;

comment on column receiving_lots.verified is 'Atestasi manual saat Terima Cepat: "cocok bukti transfer/timbang". Cuma bisa diisi saat insert (tidak ada edit belakangan).';
comment on column settlements.verified is 'Atestasi manual saat Settlement: "cocok invoice/bukti bayar". Cuma bisa diisi saat insert (tidak ada edit belakangan).';

-- create_receiving_with_batch(): tangkap `verified` opsional per lot dari
-- p_lots (default false kalau tidak dikirim -- backward compatible dgn
-- caller lama). Badan fungsi selain ini TIDAK diubah.
create or replace function public.create_receiving_with_batch(p_supplier_id uuid, p_site_id uuid, p_tank_id uuid, p_transaction_date date, p_lots jsonb)
 returns TABLE(receiving_transaction_id uuid, batch_id uuid, product_id uuid, receiving_lot_id uuid, batch_line_id uuid)
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_receiving_transaction_id uuid;
  v_batch_id uuid;
  v_lot jsonb;
  v_product_id uuid;
  v_receiving_lot_id uuid;
  v_batch_line_id uuid;
begin
  insert into receiving_transactions (supplier_id, site_id, transaction_date, created_by)
  values (p_supplier_id, p_site_id, p_transaction_date, auth.uid())
  returning id into v_receiving_transaction_id;

  v_batch_id := get_or_create_batch(p_site_id, p_tank_id, p_transaction_date);

  for v_lot in select * from jsonb_array_elements(p_lots)
  loop
    v_product_id := (v_lot ->> 'product_id')::uuid;

    insert into receiving_lots (receiving_transaction_id, product_id, qty_kg, buy_price_per_kg, verified)
    values (
      v_receiving_transaction_id,
      v_product_id,
      (v_lot ->> 'qty_kg')::numeric,
      (v_lot ->> 'buy_price_per_kg')::numeric,
      coalesce((v_lot ->> 'verified')::boolean, false)
    )
    returning id into v_receiving_lot_id;

    -- INSERT ini otomatis memicu trigger trg_batch_lines_ledger (SECURITY
    -- DEFINER, sudah ada sejak 0001/0003) yang membuat baris
    -- inventory_ledger movement_type='receive' — tidak berubah.
    insert into batch_lines (batch_id, receiving_lot_id)
    values (v_batch_id, v_receiving_lot_id)
    returning id into v_batch_line_id;

    receiving_transaction_id := v_receiving_transaction_id;
    batch_id := v_batch_id;
    product_id := v_product_id;
    receiving_lot_id := v_receiving_lot_id;
    batch_line_id := v_batch_line_id;
    return next;
  end loop;

  return;
end;
$function$;

create view v_receiving_trust with (security_invoker = true) as
select
  s.type::text as track,
  coalesce(sum(rl.qty_kg * rl.buy_price_per_kg), 0) as total_value,
  coalesce(sum(rl.qty_kg * rl.buy_price_per_kg) filter (where rl.verified), 0) as verified_value
from receiving_lots rl
join receiving_transactions rt on rt.id = rl.receiving_transaction_id
join sites s on s.id = rt.site_id
group by s.type;

create view v_settlement_trust with (security_invoker = true) as
select
  s.type::text as track,
  coalesce(sum(st.amount), 0) as total_value,
  coalesce(sum(st.amount) filter (where st.verified), 0) as verified_value
from settlements st
join deliveries d on d.id = st.delivery_id
join sites s on s.id = d.site_id
where d.cancelled_at is null
group by s.type;

create or replace function investor_receiving_trust()
returns setof v_receiving_trust
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_receiving_trust where auth_user_role() in ('owner', 'investor');
$$;

create or replace function investor_settlement_trust()
returns setof v_settlement_trust
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_settlement_trust where auth_user_role() in ('owner', 'investor');
$$;

revoke all on function investor_receiving_trust() from public, anon;
revoke all on function investor_settlement_trust() from public, anon;
grant execute on function investor_receiving_trust() to authenticated;
grant execute on function investor_settlement_trust() to authenticated;

-- ============================================================
-- BAGIAN 2: Ambang Mortalitas per site
-- ============================================================
-- Dikonfirmasi user: basis PER SITE, % dari qty diterima dalam periode
-- berjalan (30 hari terakhir -- HARDCODE, bukan configurable, supaya
-- tidak menambah satu lagi knob pengaturan utk hal yang belum tentu
-- perlu diubah-ubah; bisa diangkat jadi parameter kalau nanti memang
-- dibutuhkan).
--
-- mortality_thresholds: pola RLS identik product_holding_policy (broad
-- read owner/lead/staf, tulis owner-only). get_mortality_rates()
-- SECURITY INVOKER -- RLS inventory_ledger/batch_lines yang sudah ada
-- otomatis membatasi ke site yang bisa diakses caller, pola sama persis
-- get_fefo_risk_report()/get_available_batch_lines().

create table mortality_thresholds (
  site_id uuid primary key references sites(id),
  threshold_pct numeric not null check (threshold_pct > 0 and threshold_pct <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

comment on table mortality_thresholds is 'Ambang mortalitas per site (% dari qty diterima 30 hari terakhir). Config data (boleh UPDATE langsung, bukan ledger append-only) -- konsisten pola product_holding_policy/finance_targets.';

alter table mortality_thresholds enable row level security;

create policy mortality_thresholds_select on mortality_thresholds
  for select to authenticated
  using ((select auth_user_role()) in ('owner', 'lead_lapangan', 'staf_lapangan'));

create policy mortality_thresholds_insert on mortality_thresholds
  for insert to authenticated
  with check ((select auth_user_role()) = 'owner');

create policy mortality_thresholds_update on mortality_thresholds
  for update to authenticated
  using ((select auth_user_role()) = 'owner')
  with check ((select auth_user_role()) = 'owner');

create or replace function get_mortality_rates(p_days integer default 30)
returns table(
  site_id uuid,
  site_name text,
  track text,
  received_kg numeric,
  mortality_kg numeric,
  mortality_pct numeric,
  threshold_pct numeric,
  is_overdue boolean
)
language sql
stable
set search_path to 'public'
as $function$
  select
    s.id as site_id,
    s.name as site_name,
    s.type::text as track,
    coalesce(sum(il.qty_kg) filter (where il.movement_type = 'receive'), 0) as received_kg,
    coalesce(-sum(il.qty_kg) filter (where il.movement_type = 'mortality'), 0) as mortality_kg,
    case
      when coalesce(sum(il.qty_kg) filter (where il.movement_type = 'receive'), 0) > 0
      then (coalesce(-sum(il.qty_kg) filter (where il.movement_type = 'mortality'), 0)
            / sum(il.qty_kg) filter (where il.movement_type = 'receive')) * 100
      else null
    end as mortality_pct,
    mt.threshold_pct,
    (
      mt.threshold_pct is not null
      and coalesce(sum(il.qty_kg) filter (where il.movement_type = 'receive'), 0) > 0
      and (coalesce(-sum(il.qty_kg) filter (where il.movement_type = 'mortality'), 0)
           / sum(il.qty_kg) filter (where il.movement_type = 'receive')) * 100 > mt.threshold_pct
    ) as is_overdue
  from sites s
  join batches b on b.site_id = s.id
  join batch_lines bl on bl.batch_id = b.id
  join inventory_ledger il on il.batch_line_id = bl.id and il.event_at >= now() - (p_days || ' days')::interval
  left join mortality_thresholds mt on mt.site_id = s.id
  group by s.id, s.name, s.type, mt.threshold_pct
  having coalesce(sum(il.qty_kg) filter (where il.movement_type = 'receive'), 0) > 0;
$function$;

revoke all on function get_mortality_rates(integer) from public, anon;
grant execute on function get_mortality_rates(integer) to authenticated;
