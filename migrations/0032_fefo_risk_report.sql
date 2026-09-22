-- Laporan Risiko FEFO lintas-site + Kelola Target Holding (dua gap yang
-- sebenarnya satu akar: badge "lewat ambang holding" sudah ada sejak lama di
-- get_available_batch_lines() (migration 0008), tapi (a) cuma per-site di
-- dalam form Alokasi & Kirim -- tidak ada ringkasan lintas-site "produk apa
-- saja yang berisiko sekarang", dan (b) ambangnya sendiri
-- (product_holding_policy.max_holding_hours) sama sekali tidak ada UI untuk
-- diubah owner, cuma bisa lewat SQL manual.
--
-- get_fefo_risk_report(): sama persis logikanya dengan get_available_batch_lines
-- (SECURITY INVOKER -- RLS batch_lines/batches/inventory_ledger yang sudah
-- ada otomatis membatasi ke site yang bisa diakses caller, TIDAK perlu
-- SECURITY DEFINER), tapi TANPA filter p_site_id (semua site sekaligus,
-- ditambah site_id/site_name/track) dan HANYA baris yang is_overdue = true.

create or replace function public.get_fefo_risk_report()
returns table(
  batch_line_id uuid,
  site_id uuid,
  site_name text,
  track text,
  tank_name text,
  product_id uuid,
  product_name text,
  balance_kg numeric,
  received_at timestamptz,
  max_holding_hours integer,
  age_hours numeric,
  is_overdue boolean
)
language sql
stable
set search_path to 'public'
as $function$
  select
    bl.id as batch_line_id,
    s.id as site_id,
    s.name as site_name,
    s.type::text as track,
    t.name as tank_name,
    rl.product_id,
    p.name as product_name,
    sum(il.qty_kg) as balance_kg,
    min(il.event_at) filter (where il.movement_type = 'receive') as received_at,
    php.max_holding_hours,
    extract(epoch from (now() - min(il.event_at) filter (where il.movement_type = 'receive'))) / 3600 as age_hours,
    (
      php.max_holding_hours is not null
      and extract(epoch from (now() - min(il.event_at) filter (where il.movement_type = 'receive'))) / 3600
          > php.max_holding_hours
    ) as is_overdue
  from batch_lines bl
  join batches b on b.id = bl.batch_id
  join sites s on s.id = b.site_id
  join tanks t on t.id = b.tank_id
  join receiving_lots rl on rl.id = bl.receiving_lot_id
  join products p on p.id = rl.product_id
  left join product_holding_policy php on php.product_id = rl.product_id and php.track = s.type
  join inventory_ledger il on il.batch_line_id = bl.id
  group by bl.id, s.id, s.name, s.type, t.name, rl.product_id, p.name, php.max_holding_hours
  having sum(il.qty_kg) > 0
     and php.max_holding_hours is not null
     and extract(epoch from (now() - min(il.event_at) filter (where il.movement_type = 'receive'))) / 3600
         > php.max_holding_hours
  order by age_hours desc;
$function$;
