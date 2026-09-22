-- Mengunci search_path pada 4 fungsi yang dibuat/diubah SETELAH migration
-- 0023 (yang mengunci 12 fungsi INVOKER lain saat itu) — jadi luput dari
-- hardening massal itu. Ditemukan lewat get_advisors (Supabase security
-- lints, "Function Search Path Mutable"). Perilaku fungsi TIDAK berubah sama
-- sekali — cuma menambah `SET search_path TO 'public'`, badan fungsi persis
-- sama dengan definisi yang sudah berjalan (create_delivery_with_allocations
-- dari migration 0026, fn_cash_ledger_balance_guard & create_cash_reversal
-- dari migration 0027, ref_price dari migration 0029).

create or replace function public.create_delivery_with_allocations(p_site_id uuid, p_demand_id uuid, p_allocations jsonb, p_override_reason text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_delivery_id uuid;
  v_planned_kg numeric;
  v_alloc jsonb;
  v_batch_line_id uuid;
  v_found_batch_line_id uuid;
  v_qty numeric;
  v_fefo_rank integer;
  v_product_name text;
  v_tank_name text;
  v_available_qty numeric;
  v_demand_status text;
  v_demand_requested numeric;
  v_requires_override boolean;
begin
  select coalesce(sum((elem ->> 'qty_kg')::numeric), 0)
  into v_planned_kg
  from jsonb_array_elements(p_allocations) as elem;

  if v_planned_kg <= 0 then
    raise exception 'Total qty alokasi harus lebih dari 0.';
  end if;

  with requested as (
    select (elem ->> 'batch_line_id')::uuid as batch_line_id,
           sum((elem ->> 'qty_kg')::numeric) as qty
    from jsonb_array_elements(p_allocations) as elem
    group by 1
  ),
  candidates as (
    select bl.id as batch_line_id,
           rl.product_id,
           min(il.event_at) filter (where il.movement_type = 'receive') as received_at,
           coalesce(sum(il.qty_kg), 0) as balance_kg
    from batch_lines bl
    join receiving_lots rl on rl.id = bl.receiving_lot_id
    join batches b on b.id = bl.batch_id
    left join inventory_ledger il on il.batch_line_id = bl.id
    where b.site_id = p_site_id
      and rl.product_id in (
        select rl2.product_id
        from requested req
        join batch_lines bl2 on bl2.id = req.batch_line_id
        join receiving_lots rl2 on rl2.id = bl2.receiving_lot_id
      )
    group by bl.id, rl.product_id
  ),
  simulated as (
    select c.batch_line_id, c.product_id, c.received_at,
           c.balance_kg - coalesce(r.qty, 0) as remaining_kg
    from candidates c
    left join requested r on r.batch_line_id = c.batch_line_id
  ),
  selected as (
    select s.product_id, s.received_at
    from simulated s
    join requested r on r.batch_line_id = s.batch_line_id
    where s.received_at is not null
  )
  select exists (
    select 1
    from selected sel
    join simulated older
      on older.product_id = sel.product_id
     and older.received_at is not null
     and older.received_at < sel.received_at
     and older.remaining_kg > 0
  )
  into v_requires_override;

  if v_requires_override and (p_override_reason is null or btrim(p_override_reason) = '') then
    raise exception 'Ada batch_line produk yang sama, lebih tua, dan masih tersedia tapi dilewati. Wajib isi alasan override FEFO.';
  end if;

  if p_demand_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('demand:' || p_demand_id::text, 0));

    select status, requested_qty_kg into v_demand_status, v_demand_requested
    from demands where id = p_demand_id;

    if v_demand_status is null then
      raise exception 'Demand % tidak ditemukan.', p_demand_id;
    end if;
    if v_demand_status not in ('open', 'partial') then
      raise exception 'Demand berstatus "%" tidak bisa dialokasikan lagi.', v_demand_status;
    end if;
  end if;

  insert into deliveries (site_id, planned_kg, demand_id, created_by)
  values (p_site_id, v_planned_kg, p_demand_id, auth.uid())
  returning id into v_delivery_id;

  for v_alloc in
    select value
    from jsonb_array_elements(p_allocations) as value
    order by (value ->> 'batch_line_id')::uuid
  loop
    v_batch_line_id := (v_alloc ->> 'batch_line_id')::uuid;
    v_qty := (v_alloc ->> 'qty_kg')::numeric;
    v_fefo_rank := (v_alloc ->> 'fefo_rank')::integer;

    perform pg_advisory_xact_lock(hashtextextended('batch_line:' || v_batch_line_id::text, 0));

    select bl.id, p.name, t.name
    into v_found_batch_line_id, v_product_name, v_tank_name
    from batch_lines bl
    join receiving_lots rl on rl.id = bl.receiving_lot_id
    join products p on p.id = rl.product_id
    join batches b on b.id = bl.batch_id
    join tanks t on t.id = b.tank_id
    where bl.id = v_batch_line_id;

    if v_found_batch_line_id is null then
      raise exception 'batch_line_id % tidak ditemukan.', v_batch_line_id;
    end if;

    select coalesce(sum(qty_kg), 0)
    into v_available_qty
    from inventory_ledger
    where batch_line_id = v_batch_line_id;

    if v_available_qty < v_qty then
      raise exception
        'Saldo tidak cukup untuk batch_line % (produk: %, tank: %): diminta % kg, tersedia % kg.',
        v_batch_line_id, v_product_name, v_tank_name, v_qty, v_available_qty;
    end if;

    insert into delivery_allocations (delivery_id, batch_line_id, qty_kg, fefo_rank, override_reason)
    values (v_delivery_id, v_batch_line_id, v_qty, v_fefo_rank, p_override_reason);
  end loop;

  if p_demand_id is not null then
    update demands
    set status = case when demand_allocated_kg(p_demand_id) >= v_demand_requested then 'allocated' else 'partial' end
    where id = p_demand_id;
  end if;

  return v_delivery_id;
end;
$function$;

create or replace function public.fn_cash_ledger_balance_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('cash:' || NEW.pic_user_id::text || ':' || NEW.site_id::text, 0));

  select coalesce(sum(amount), 0)
  into v_balance
  from cash_ledger
  where pic_user_id = NEW.pic_user_id and site_id = NEW.site_id;

  if v_balance + NEW.amount < 0 then
    raise exception
      'Saldo kas tidak cukup untuk PIC % di site %: saldo % , transaksi %.',
      NEW.pic_user_id, NEW.site_id, v_balance, NEW.amount;
  end if;

  return NEW;
end;
$function$;

create or replace function public.create_cash_reversal(p_ledger_id uuid, p_reason text)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_orig cash_ledger%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_new_id uuid;
begin
  if coalesce(auth_user_role(), '') <> 'owner' then
    raise exception 'Hanya Owner yang boleh mengoreksi kas.';
  end if;
  if v_reason = '' then
    raise exception 'Alasan koreksi wajib diisi.';
  end if;

  select * into v_orig from cash_ledger where id = p_ledger_id;
  if not found then
    raise exception 'Baris kas % tidak ditemukan.', p_ledger_id;
  end if;
  if v_orig.reversal_of is not null then
    raise exception 'Baris ini sendiri adalah reversal dan tidak bisa dikoreksi lagi.';
  end if;
  if exists (select 1 from cash_ledger where reversal_of = v_orig.id) then
    raise exception 'Baris ini sudah pernah dikoreksi.';
  end if;

  insert into cash_ledger (site_id, amount, category, ref_type, ref_id, event_at, created_by, pic_user_id, reversal_of)
  values (v_orig.site_id, -v_orig.amount, 'adjustment', 'cash_ledger', v_orig.id, now(), auth.uid(), v_orig.pic_user_id, v_orig.id)
  returning id into v_new_id;

  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (
    'cash_ledger', v_new_id, 'reversal', to_jsonb(v_orig),
    jsonb_build_object('reason', v_reason, 'reversal_of', v_orig.id, 'amount', -v_orig.amount),
    auth.uid()
  );

  return v_new_id;
end;
$function$;

create or replace function public.ref_price(p_product_id uuid, p_site_id uuid, p_date date default current_date)
returns table(price numeric, source text)
language plpgsql
stable
set search_path to 'public'
as $function$
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
    and rt.source_handover_id is null
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
    and rt.source_handover_id is null
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
    and rt.source_handover_id is null
    and rt.transaction_date > p_date - 30
    and rt.transaction_date <= p_date;
  if v_price is not null then
    price := v_price; source := 'vwap30_all_site'; return next; return;
  end if;

  price := null; source := 'none'; return next; return;
end;
$function$;
