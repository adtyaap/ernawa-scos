-- Batalkan kiriman Handover sebelum dikonfirmasi (gap yang disengaja ditunda
-- sejak migration 0029 — sebelumnya kalau salah kirim, satu-satunya jalan
-- adalah Koreksi Ledger manual oleh owner tanpa jejak "ini pembatalan
-- handover X", dan tidak ada guard yang mencegah handover yang sudah
-- dibatalkan tetap dikonfirmasi kemudian).
--
-- Desain: owner-only (mirip cancel_delivery/create_cash_reversal — owner
-- sudah lolos inventory_ledger_insert RLS langsung, SECURITY INVOKER cukup,
-- tidak perlu SECURITY DEFINER). Membalik SEMUA transfer_out awal tiap baris
-- (reversal_of, bukan UPDATE/DELETE — rule #3), lalu menandai
-- handovers.cancelled_at/cancelled_reason. Hanya bisa dibatalkan selama
-- BELUM dikonfirmasi (received_by is null) dan belum pernah dibatalkan
-- sebelumnya.

alter table handovers
  add column cancelled_at timestamptz null,
  add column cancelled_reason text null;

create or replace function public.cancel_handover_dispatch(p_handover_id uuid, p_reason text)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_handover handovers%rowtype;
  v_line record;
  v_orig_ledger inventory_ledger%rowtype;
begin
  if coalesce(auth_user_role(), '') <> 'owner' then
    raise exception 'Hanya Owner yang boleh membatalkan handover.';
  end if;
  if v_reason = '' then
    raise exception 'Alasan pembatalan wajib diisi.';
  end if;

  select * into v_handover from handovers where id = p_handover_id;
  if not found then
    raise exception 'Handover % tidak ditemukan.', p_handover_id;
  end if;
  if v_handover.received_by is not null then
    raise exception 'Handover yang sudah dikonfirmasi tidak bisa dibatalkan.';
  end if;
  if v_handover.cancelled_at is not null then
    raise exception 'Handover ini sudah pernah dibatalkan sebelumnya.';
  end if;

  for v_line in select * from handover_lines where handover_id = p_handover_id loop
    select * into v_orig_ledger from inventory_ledger
      where ref_type = 'handover_lines' and ref_id = v_line.id
        and movement_type = 'transfer_out' and reversal_of is null;

    if not found then
      raise exception 'Baris ledger transfer_out untuk handover_line % tidak ditemukan.', v_line.id;
    end if;

    insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, reversal_of, user_id, client_id)
    values (v_line.batch_line_id, 'transfer_out', -v_orig_ledger.qty_kg, now(), 'handover_lines', v_line.id, v_orig_ledger.id, auth.uid(), gen_random_uuid());
  end loop;

  update handovers
  set cancelled_at = now(), cancelled_reason = v_reason
  where id = p_handover_id;

  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (
    'handovers', p_handover_id, 'cancel', to_jsonb(v_handover),
    jsonb_build_object('reason', v_reason), auth.uid()
  );
end;
$function$;

-- Guard: handover yang sudah dibatalkan tidak boleh tetap bisa dikonfirmasi
-- (gap yang baru ketahuan saat menulis migration ini — WHERE clause lama
-- cuma cek received_by is null, tidak cek cancelled_at).
create or replace function public.confirm_handover_receipt(
  p_handover_id uuid,
  p_to_tank_id uuid,
  p_business_date date,
  p_lines jsonb
) returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_updated int;
  v_line jsonb;
  v_handover_line_id uuid;
  v_qty_received numeric;
  v_hl handover_lines%rowtype;
  v_origin_product_id uuid;
  v_origin_price numeric;
  v_to_site_id uuid;
  v_txn_id uuid;
  v_lot_id uuid;
  v_batch_id uuid;
  v_new_batch_line_id uuid;
  v_line_count int := 0;
begin
  select to_site_id into v_to_site_id from handovers where id = p_handover_id and cancelled_at is null;
  if v_to_site_id is null then
    raise exception 'Handover % tidak ditemukan, atau sudah dibatalkan.', p_handover_id;
  end if;

  if not exists (select 1 from tanks where id = p_to_tank_id and site_id = v_to_site_id) then
    raise exception 'Tank tujuan tidak valid untuk site tujuan handover ini.';
  end if;

  update handovers
  set received_by = auth.uid(), received_at = now(), to_tank_id = p_to_tank_id, received_business_date = p_business_date
  where id = p_handover_id and received_by is null and cancelled_at is null;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Handover % sudah dikonfirmasi/dibatalkan sebelumnya, atau Anda tidak punya akses ke site tujuan.', p_handover_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) as value
  loop
    v_line_count := v_line_count + 1;
    v_handover_line_id := (v_line ->> 'handover_line_id')::uuid;
    v_qty_received := (v_line ->> 'qty_kg_received')::numeric;

    select * into v_hl from handover_lines
    where id = v_handover_line_id and handover_id = p_handover_id;

    if not found then
      raise exception 'handover_line_id % tidak ditemukan pada handover ini.', v_handover_line_id;
    end if;

    if v_hl.qty_kg_received is not null then
      raise exception 'Baris handover % sudah dikonfirmasi sebelumnya.', v_handover_line_id;
    end if;

    if v_qty_received is null or v_qty_received <= 0 or v_qty_received > v_hl.qty_kg then
      raise exception 'Qty diterima untuk baris % harus > 0 dan tidak boleh lebih dari qty dikirim (% kg).',
        v_handover_line_id, v_hl.qty_kg;
    end if;

    select rl.product_id, rl.buy_price_per_kg
    into v_origin_product_id, v_origin_price
    from batch_lines bl
    join receiving_lots rl on rl.id = bl.receiving_lot_id
    where bl.id = v_hl.batch_line_id;

    insert into receiving_transactions (supplier_id, site_id, transaction_date, source_handover_id, created_by)
    values (null, v_to_site_id, p_business_date, p_handover_id, auth.uid())
    returning id into v_txn_id;

    insert into receiving_lots (receiving_transaction_id, product_id, qty_kg, buy_price_per_kg)
    values (v_txn_id, v_origin_product_id, v_qty_received, v_origin_price)
    returning id into v_lot_id;

    v_batch_id := get_or_create_batch(v_to_site_id, p_to_tank_id, p_business_date);

    insert into batch_lines (batch_id, receiving_lot_id)
    values (v_batch_id, v_lot_id)
    returning id into v_new_batch_line_id;

    update handover_lines
    set qty_kg_received = v_qty_received, to_batch_line_id = v_new_batch_line_id
    where id = v_handover_line_id;
  end loop;

  if v_line_count = 0 then
    raise exception 'Minimal satu baris konfirmasi harus diisi.';
  end if;
end;
$function$;
