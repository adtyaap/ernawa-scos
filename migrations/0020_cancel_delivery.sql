-- =============================================================================
-- Lobster SC OS (Ernawa) — Pembatalan Delivery (PRD B2)
-- =============================================================================
-- Delivery salah input sebelumnya tidak bisa dikoreksi: create_ledger_reversal
-- (0015) sengaja menolak baris 'delivery' karena membalik ledger tanpa
-- delivery_allocations membuat keduanya tidak sinkron, dan tidak ada policy
-- DELETE. Migration ini menambah pembatalan yang menjaga keduanya sinkron.
--
-- KEPUTUSAN (dari pengguna): HANYA OWNER yang boleh membatalkan delivery.
--
-- DESAIN:
--   * deliveries mendapat cancelled_at / cancelled_by / cancel_reason. Delivery
--     TIDAK dihapus (riwayat utuh); ia ditandai batal.
--   * cancel_delivery(delivery_id, alasan) — SECURITY INVOKER, owner-only
--     (dicek eksplisit + dijaga RLS ledger/audit yang owner-only): membalik
--     SEMUA baris ledger alokasi delivery itu dengan baris reversal baru
--     (movement_type 'adjustment', qty berlawanan, reversal_of = baris asal,
--     CLAUDE.md #3), menandai batal, menghitung ulang status demand
--     (open/partial/allocated), dan mencatat audit_log. Semua atomik.
--   * DITOLAK bila: alasan kosong, sudah dibatalkan, atau delivery SUDAH punya
--     settlement (settlement tidak bisa dihapus, jadi pembatalan akan
--     meninggalkan piutang/pendapatan yatim).
--   * Trigger pembatas UPDATE untuk role lapangan diperluas: kolom cancelled_*
--     tidak boleh diubah selain oleh owner (kalau tidak, lead bisa menandai
--     batal tanpa membalik ledger).
--   * demand_allocated_kg() (0019) dan tiga view keuangan mengecualikan
--     delivery batal supaya tidak ikut margin, lockup modal, worklist
--     settlement, maupun total teralokasi demand.
--
-- Bergantung pada 0019 (demand_allocated_kg, status 'partial').
-- Migration ini HANYA ADD COLUMN, CREATE OR REPLACE FUNCTION/VIEW. Tidak ada
-- DROP/DELETE/TRUNCATE. JANGAN dieksekusi sebelum direview.
-- =============================================================================

alter table deliveries
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references users (id),
  add column cancel_reason text;

alter table deliveries
  add constraint deliveries_cancel_consistency_check
  check (
    (cancelled_at is null and cancelled_by is null and cancel_reason is null)
    or (cancelled_at is not null and cancel_reason is not null and btrim(cancel_reason) <> '')
  );

create or replace function fn_deliveries_restrict_field_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth_user_role(), '') <> 'owner' then
    if NEW.id is distinct from OLD.id
       or NEW.demand_id is distinct from OLD.demand_id
       or NEW.site_id is distinct from OLD.site_id
       or NEW.planned_kg is distinct from OLD.planned_kg
       or NEW.created_by is distinct from OLD.created_by
       or NEW.created_at is distinct from OLD.created_at
       or NEW.cancelled_at is distinct from OLD.cancelled_at
       or NEW.cancelled_by is distinct from OLD.cancelled_by
       or NEW.cancel_reason is distinct from OLD.cancel_reason
    then
      raise exception 'lead_lapangan/staf_lapangan hanya boleh mengubah kolom actual_weight_kg dan delivered_at pada deliveries.';
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function demand_allocated_kg(p_demand_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(da.qty_kg), 0)
  from delivery_allocations da
  join deliveries d on d.id = da.delivery_id
  where d.demand_id = p_demand_id
    and d.cancelled_at is null;
$$;

-- ---------------------------- view keuangan ----------------------------------
create or replace view v_deliveries_pending_settlement
with (security_invoker = true) as
select d.id as delivery_id,
    d.site_id,
    s.name as site_name,
    s.type as track,
    d.planned_kg,
    d.actual_weight_kg,
    d.delivered_at,
    d.demand_id,
    dm.customer_id,
    c.name as customer_name,
    dm.expected_price_per_kg
   from deliveries d
     join sites s on s.id = d.site_id
     left join demands dm on dm.id = d.demand_id
     left join customers c on c.id = dm.customer_id
     left join settlements st on st.delivery_id = d.id
  where d.actual_weight_kg is not null
    and st.id is null
    and d.cancelled_at is null;

create or replace view v_trading_capital_lockup
with (security_invoker = true) as
select da.id as delivery_allocation_id,
    da.batch_line_id,
    da.qty_kg,
    d.delivered_at,
    recv.received_at,
    extract(epoch from (d.delivered_at - recv.received_at)) / 86400::numeric as lockup_days
   from delivery_allocations da
     join deliveries d on d.id = da.delivery_id
     join sites site on site.id = d.site_id
     join lateral ( select min(il.event_at) as received_at
           from inventory_ledger il
          where il.batch_line_id = da.batch_line_id and il.movement_type = 'receive'::movement_type) recv on true
  where site.type = 'trading'::site_type
    and d.delivered_at is not null
    and recv.received_at is not null
    and d.cancelled_at is null;

create or replace view v_trading_delivery_margin
with (security_invoker = true) as
select d.id as delivery_id,
    d.site_id,
    d.actual_weight_kg,
    s.amount as revenue,
    coalesce(cogs.total_cogs, 0::numeric) as cogs,
    s.amount - coalesce(cogs.total_cogs, 0::numeric) as margin,
        case
            when d.actual_weight_kg > 0::numeric then (s.amount - coalesce(cogs.total_cogs, 0::numeric)) / d.actual_weight_kg
            else null::numeric
        end as margin_per_kg
   from deliveries d
     join sites site on site.id = d.site_id
     join settlements s on s.delivery_id = d.id
     left join ( select da.delivery_id,
            sum(da.qty_kg * rl.buy_price_per_kg) as total_cogs
           from delivery_allocations da
             join batch_lines bl on bl.id = da.batch_line_id
             join receiving_lots rl on rl.id = bl.receiving_lot_id
          group by da.delivery_id) cogs on cogs.delivery_id = d.id
  where site.type = 'trading'::site_type
    and d.cancelled_at is null;

-- ------------------------------- RPC batal -----------------------------------
create or replace function cancel_delivery(p_delivery_id uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_delivery deliveries%rowtype;
  v_alloc record;
  v_ledger_id uuid;
  v_alloc_count integer := 0;
  v_demand_status text;
  v_demand_requested numeric;
  v_total numeric;
begin
  if coalesce(auth_user_role(), '') <> 'owner' then
    raise exception 'Hanya Owner yang boleh membatalkan delivery.';
  end if;
  if v_reason = '' then
    raise exception 'Alasan pembatalan wajib diisi.';
  end if;

  select * into v_delivery from deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'Delivery % tidak ditemukan.', p_delivery_id;
  end if;
  if v_delivery.cancelled_at is not null then
    raise exception 'Delivery ini sudah dibatalkan.';
  end if;
  if exists (select 1 from settlements where delivery_id = p_delivery_id) then
    raise exception 'Delivery ini sudah punya settlement dan tidak bisa dibatalkan.';
  end if;

  for v_alloc in
    select da.id, da.batch_line_id, da.qty_kg
    from delivery_allocations da
    where da.delivery_id = p_delivery_id
    order by da.batch_line_id, da.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('batch_line:' || v_alloc.batch_line_id::text, 0));

    select il.id into v_ledger_id
    from inventory_ledger il
    where il.ref_type = 'delivery_allocations'
      and il.ref_id = v_alloc.id
      and il.movement_type = 'delivery'
      and il.reversal_of is null;

    if v_ledger_id is null then
      raise exception 'Baris ledger untuk alokasi % tidak ditemukan.', v_alloc.id;
    end if;
    if exists (select 1 from inventory_ledger where reversal_of = v_ledger_id) then
      raise exception 'Baris ledger untuk alokasi % sudah pernah dikoreksi.', v_alloc.id;
    end if;

    insert into inventory_ledger (
      batch_line_id, movement_type, qty_kg, event_at,
      ref_type, ref_id, reversal_of, user_id, client_id
    ) values (
      v_alloc.batch_line_id, 'adjustment', v_alloc.qty_kg, now(),
      'deliveries', p_delivery_id, v_ledger_id, auth.uid(), gen_random_uuid()
    );
    v_alloc_count := v_alloc_count + 1;
  end loop;

  update deliveries
  set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
  where id = p_delivery_id;

  if v_delivery.demand_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('demand:' || v_delivery.demand_id::text, 0));
    select status, requested_qty_kg into v_demand_status, v_demand_requested
    from demands where id = v_delivery.demand_id;

    if v_demand_status in ('open', 'partial', 'allocated') then
      v_total := demand_allocated_kg(v_delivery.demand_id);
      update demands
      set status = case
        when v_total <= 0 then 'open'
        when v_total < v_demand_requested then 'partial'
        else 'allocated'
      end
      where id = v_delivery.demand_id;
    end if;
  end if;

  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (
    'deliveries', p_delivery_id, 'cancel', to_jsonb(v_delivery),
    jsonb_build_object('reason', v_reason, 'allocations_reversed', v_alloc_count),
    auth.uid()
  );
end;
$$;
