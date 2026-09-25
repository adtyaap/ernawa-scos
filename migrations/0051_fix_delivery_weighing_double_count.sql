-- =============================================================================
-- Lobster SC OS (Ernawa) — FIX: susut Konfirmasi Timbang terhitung dua kali
-- =============================================================================
-- BUG (sejak migration 0038): fn_deliveries_confirm_weighing_variance
-- MENAMBAHKAN baris 'shrinkage' sebesar selisih (dialokasikan - aktual) ke
-- batch_line, padahal baris 'delivery' dari alokasi sudah mengurangi stok
-- sebesar qty yang DIALOKASIKAN. Stok keluar dua kali: diterima 700, delivery
-- -700, shrinkage -5 -> saldo -5 kg. Ditemukan saat membangun Live Inventory
-- (nilai stok total tidak cocok dgn jumlah saldo per batch). Handover (0029)
-- sudah benar utk pola yang sama: balik baris awal lalu ganti dgn
-- (qty diterima) + (shrinkage selisih) — delivery luput.
--
-- PERBAIKAN (pola identik fn_handover_lines_confirm_variance):
--   1. Trigger timbang: utk tiap alokasi yang kena susut, baris 'delivery'
--      awal DIBALIK (adjustment, reversal_of) lalu diganti baris 'delivery'
--      sebesar (alokasi - susut) + baris 'shrinkage' sebesar susut. Net per
--      batch_line tetap = -qty dialokasikan (sesuai fisik: yang keluar dari
--      tank memang sebanyak itu), dan susut tetap terlihat sbg baris sendiri
--      (PRD v3 P11). COGS tidak berubah (tetap dari delivery_allocations).
--   2. cancel_delivery: sebelumnya mencari SATU baris delivery per alokasi dan
--      menolak kalau sudah pernah dibalik — setelah perbaikan #1 delivery yang
--      ditimbang kurang punya baris awal (sudah dibalik) + baris pengganti.
--      Sekarang dicari baris delivery alokasi yang BELUM dibalik, dan
--      dibalik sebesar qty baris itu (bukan qty alokasi). Susut transit tidak
--      ikut dibalik (barang yang hilang di jalan memang hilang) — hasil fisik
--      sama persis dgn perilaku lama utk delivery yang tidak kena susut.
--   3. Data lama: satu-satunya delivery terdampak (700 -> 695 kg) dikoreksi
--      lewat baris reversal + pengganti (aturan #3, tanpa UPDATE/DELETE),
--      plus jejak di audit_log. Ditulis generik (semua delivery yang punya
--      baris shrinkage ref 'deliveries' tapi baris delivery awalnya belum
--      dibalik) supaya tidak bergantung ID.
-- Tidak ada DROP/DELETE/UPDATE data.
-- =============================================================================

create or replace function fn_deliveries_confirm_weighing_variance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_total_allocated numeric;
  v_shortfall numeric;
  v_alloc record;
  v_line_shrinkage numeric;
  v_orig inventory_ledger%rowtype;
begin
  select coalesce(sum(qty_kg), 0) into v_total_allocated
  from delivery_allocations where delivery_id = NEW.id;

  v_shortfall := v_total_allocated - NEW.actual_weight_kg;

  if v_shortfall > 0 and v_total_allocated > 0 then
    for v_alloc in
      select id, batch_line_id, qty_kg from delivery_allocations
      where delivery_id = NEW.id
      order by batch_line_id, id
    loop
      v_line_shrinkage := round(v_shortfall * v_alloc.qty_kg / v_total_allocated, 3);
      if v_line_shrinkage > 0 then
        perform pg_advisory_xact_lock(hashtextextended('batch_line:' || v_alloc.batch_line_id::text, 0));

        select il.* into v_orig
        from inventory_ledger il
        where il.ref_type = 'delivery_allocations'
          and il.ref_id = v_alloc.id
          and il.movement_type = 'delivery'
          and il.reversal_of is null
          and not exists (select 1 from inventory_ledger r where r.reversal_of = il.id)
        order by il.created_at
        limit 1;

        if not found then
          raise exception 'Baris ledger delivery untuk alokasi % tidak ditemukan.', v_alloc.id;
        end if;

        insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, reversal_of, user_id, client_id)
        values (v_alloc.batch_line_id, 'adjustment', -v_orig.qty_kg, coalesce(NEW.delivered_at, now()),
                'deliveries', NEW.id, v_orig.id, NEW.created_by, gen_random_uuid());

        insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, user_id, client_id)
        values (v_alloc.batch_line_id, 'delivery', v_orig.qty_kg + v_line_shrinkage, v_orig.event_at,
                'delivery_allocations', v_alloc.id, NEW.created_by, gen_random_uuid());

        insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, user_id, client_id)
        values (v_alloc.batch_line_id, 'shrinkage', -v_line_shrinkage, coalesce(NEW.delivered_at, now()),
                'deliveries', NEW.id, NEW.created_by, gen_random_uuid());
      end if;
    end loop;
  end if;

  return NEW;
end;
$$;

revoke execute on function fn_deliveries_confirm_weighing_variance() from public, anon, authenticated;

create or replace function cancel_delivery(p_delivery_id uuid, p_reason text)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_delivery deliveries%rowtype;
  v_alloc record;
  v_ledger inventory_ledger%rowtype;
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

    select il.* into v_ledger
    from inventory_ledger il
    where il.ref_type = 'delivery_allocations'
      and il.ref_id = v_alloc.id
      and il.movement_type = 'delivery'
      and il.reversal_of is null
      and not exists (select 1 from inventory_ledger r where r.reversal_of = il.id)
    order by il.created_at desc
    limit 1;

    if not found then
      raise exception 'Baris ledger untuk alokasi % tidak ditemukan atau sudah dikoreksi.', v_alloc.id;
    end if;

    insert into inventory_ledger (
      batch_line_id, movement_type, qty_kg, event_at,
      ref_type, ref_id, reversal_of, user_id, client_id
    ) values (
      v_alloc.batch_line_id, 'adjustment', -v_ledger.qty_kg, now(),
      'deliveries', p_delivery_id, v_ledger.id, auth.uid(), gen_random_uuid()
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

-- Koreksi data lama: delivery yang sudah kena shrinkage lama tapi baris
-- delivery awalnya belum dibalik.
do $$
declare
  v_row record;
  v_rev_id uuid;
  v_new_id uuid;
begin
  for v_row in
    select il_d.*, sh.qty_kg as shrink_qty, sh.ref_id as delivery_id, sh.id as shrink_id
    from inventory_ledger sh
    join delivery_allocations da on da.delivery_id = sh.ref_id and da.batch_line_id = sh.batch_line_id
    join inventory_ledger il_d on il_d.ref_type = 'delivery_allocations' and il_d.ref_id = da.id
                              and il_d.movement_type = 'delivery' and il_d.reversal_of is null
    where sh.ref_type = 'deliveries'
      and sh.movement_type = 'shrinkage'
      and not exists (select 1 from inventory_ledger r where r.reversal_of = sh.id)
      and not exists (select 1 from inventory_ledger r where r.reversal_of = il_d.id)
  loop
    insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, reversal_of, user_id, client_id)
    values (v_row.batch_line_id, 'adjustment', -v_row.qty_kg, now(),
            'deliveries', v_row.delivery_id, v_row.id, null, gen_random_uuid())
    returning id into v_rev_id;

    insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, user_id, client_id)
    values (v_row.batch_line_id, 'delivery', v_row.qty_kg - v_row.shrink_qty, v_row.event_at,
            'delivery_allocations', v_row.ref_id, v_row.user_id, gen_random_uuid())
    returning id into v_new_id;

    insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
    values (
      'inventory_ledger', v_rev_id, 'reversal',
      jsonb_build_object('delivery_row', v_row.id, 'qty_kg', v_row.qty_kg),
      jsonb_build_object(
        'reason', 'Migration 0051: susut Konfirmasi Timbang sebelumnya terhitung dua kali (baris delivery tidak dibalik). Baris delivery diganti sebesar qty diterima; susut tetap tercatat.',
        'replacement_delivery_row', v_new_id,
        'shrinkage_row', v_row.shrink_id
      ),
      null
    );
  end loop;
end $$;
