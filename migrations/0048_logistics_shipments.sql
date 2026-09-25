-- =============================================================================
-- Lobster SC OS (Ernawa) — Logistics: pelacakan pengiriman (shipments)
-- =============================================================================
-- Mengikuti modul "Logistics" artifact Lobster Supply Chain OS: rute, carrier,
-- kendaraan, berangkat/ETA, qty, biaya logistik, mortalitas transit, dan status
-- planned -> ready -> in_transit -> delivered (atau delayed / failed).
--
-- Keputusan desain (dikonfirmasi user):
--   * Mortalitas transit diinput MANUAL di shipment (bukan diambil dari susut
--     Konfirmasi Timbang, migration 0038). Angka ini INFORMASI (kg), TIDAK
--     menulis inventory_ledger dan TIDAK dikurangkan lagi di P&L: stok sudah
--     keluar dari ledger saat alokasi, dan COGS delivery sudah memakai qty yang
--     DIALOKASIKAN — mengurangkannya lagi = dobel hitung (pola sama artifact
--     asli, yang juga cuma menampilkannya sebagai KPI kg).
--   * Biaya logistik MASUK P&L (Gross Profit = Revenue - COGS - Logistik) lewat
--     v_trading_delivery_pnl. Shipment berstatus cancelled tidak dihitung;
--     failed tetap dihitung (biayanya sudah keluar).
--   * Tidak ada DELETE. Salah input -> status cancelled (alasan wajib) lalu buat
--     ulang. Kolom finansial/identitas (delivery, qty, biaya, rute, berangkat)
--     tidak bisa diubah setelah insert; yang boleh berubah cuma status, ETA
--     (revisi saat delayed), dan mortalitas transit (baru diketahui saat tiba)
--     selama shipment belum final.
--   * Track: shipment tidak punya kolom track sendiri — track mengikuti site
--     delivery-nya (pola sama deliveries/settlements); semua agregasi finansial
--     di view difilter site.type = 'trading'.
-- =============================================================================

create table shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_no text not null unique
    default ('SHP-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-'
             || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5))),
  delivery_id uuid not null references deliveries(id),
  origin text,
  destination text,
  carrier text,
  vehicle text,
  departed_on date not null,
  eta_on date,
  qty_kg numeric not null check (qty_kg > 0),
  cost numeric not null default 0 check (cost >= 0),
  transit_mortality_kg numeric not null default 0 check (transit_mortality_kg >= 0),
  status text not null default 'planned'
    check (status in ('planned', 'ready', 'in_transit', 'delivered', 'delayed', 'failed', 'cancelled')),
  status_changed_at timestamptz not null default now(),
  cancel_reason text,
  created_by uuid references users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (eta_on is null or eta_on >= departed_on),
  check (transit_mortality_kg <= qty_kg)
);

create index shipments_delivery_id_idx on shipments(delivery_id);

alter table shipments enable row level security;

create policy shipments_select on shipments for select to authenticated
  using (exists (
    select 1 from deliveries d
    where d.id = shipments.delivery_id and user_can_access_site(d.site_id)
  ));

create policy shipments_insert on shipments for insert to authenticated
  with check (
    (select auth_user_role()) in ('owner', 'lead_lapangan', 'staf_lapangan')
    and exists (
      select 1 from deliveries d
      where d.id = shipments.delivery_id and user_can_access_site(d.site_id)
    )
  );

create policy shipments_update on shipments for update to authenticated
  using (
    (select auth_user_role()) in ('owner', 'lead_lapangan', 'staf_lapangan')
    and exists (
      select 1 from deliveries d
      where d.id = shipments.delivery_id and user_can_access_site(d.site_id)
    )
  )
  with check (
    (select auth_user_role()) in ('owner', 'lead_lapangan', 'staf_lapangan')
    and exists (
      select 1 from deliveries d
      where d.id = shipments.delivery_id and user_can_access_site(d.site_id)
    )
  );

-- Penjaga alur status & kolom yang tidak boleh diubah.
create or replace function fn_shipments_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_cancelled_at timestamptz;
  v_allowed text[];
begin
  if TG_OP = 'INSERT' then
    select cancelled_at into v_cancelled_at from deliveries where id = NEW.delivery_id;
    if v_cancelled_at is not null then
      raise exception 'Delivery ini sudah dibatalkan — tidak bisa dibuatkan shipment.';
    end if;
    if NEW.status not in ('planned', 'ready', 'in_transit', 'delivered') then
      raise exception 'Shipment baru hanya boleh berstatus planned, ready, in_transit, atau delivered.';
    end if;
    NEW.status_changed_at := now();
    NEW.cancel_reason := null;
    return NEW;
  end if;

  -- UPDATE
  if OLD.status in ('delivered', 'failed', 'cancelled') then
    raise exception 'Shipment % sudah final (%) dan tidak bisa diubah lagi.', OLD.shipment_no, OLD.status;
  end if;

  if NEW.shipment_no is distinct from OLD.shipment_no
     or NEW.delivery_id is distinct from OLD.delivery_id
     or NEW.qty_kg is distinct from OLD.qty_kg
     or NEW.cost is distinct from OLD.cost
     or NEW.origin is distinct from OLD.origin
     or NEW.destination is distinct from OLD.destination
     or NEW.carrier is distinct from OLD.carrier
     or NEW.vehicle is distinct from OLD.vehicle
     or NEW.departed_on is distinct from OLD.departed_on
     or NEW.created_by is distinct from OLD.created_by
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'Hanya status, ETA, dan mortalitas transit yang bisa diubah. Kalau data lain salah, batalkan shipment lalu buat ulang.';
  end if;

  if NEW.status is distinct from OLD.status then
    v_allowed := case OLD.status
      when 'planned'    then array['ready', 'in_transit', 'cancelled']
      when 'ready'      then array['in_transit', 'cancelled']
      when 'in_transit' then array['delivered', 'delayed', 'failed']
      when 'delayed'    then array['in_transit', 'delivered', 'failed']
      else array[]::text[]
    end;
    if not (NEW.status = any(v_allowed)) then
      raise exception 'Status tidak bisa berpindah dari % ke %.', OLD.status, NEW.status;
    end if;
    if NEW.status = 'cancelled' and btrim(coalesce(NEW.cancel_reason, '')) = '' then
      raise exception 'Alasan pembatalan wajib diisi.';
    end if;
    NEW.status_changed_at := now();
  elsif NEW.cancel_reason is distinct from OLD.cancel_reason then
    raise exception 'Alasan pembatalan hanya bisa diisi saat membatalkan shipment.';
  end if;

  return NEW;
end;
$$;

revoke execute on function fn_shipments_guard() from public, anon, authenticated;

create trigger trg_shipments_guard
  before insert or update on shipments
  for each row execute function fn_shipments_guard();

-- P&L per delivery trading: Revenue - COGS - Logistik = Gross Profit.
-- Satu baris per delivery (basis v_trading_delivery_margin: trading, tidak
-- batal, sudah ada settlement). Atribut produk & pemasok ikut disertakan supaya
-- breakdown per Produk/Pemasok bisa dihitung, dengan pola migration 0044:
-- delivery yang berisi >1 produk / >1 pemasok TIDAK dipecah (revenue satu
-- angka per delivery) — sole_* bernilai NULL untuk delivery campuran.
-- Pemasok NULL (stok asal Serah Terima, receiving sintetis migration 0029)
-- dihitung sebagai satu "pemasok" tersendiri.
create view v_trading_delivery_pnl with (security_invoker = true) as
select
  vtdm.delivery_id,
  d.site_id,
  site.name as site_name,
  s.customer_id,
  c.name as customer_name,
  coalesce(c.segment, 'belum_diklasifikasi') as segment,
  d.delivered_at,
  d.actual_weight_kg,
  vtdm.revenue,
  vtdm.cogs,
  coalesce(lg.logistics_cost, 0) as logistics_cost,
  vtdm.revenue - vtdm.cogs - coalesce(lg.logistics_cost, 0) as gross_profit,
  coalesce(pl.n_products, 0) as n_products,
  case when pl.n_products = 1 then pl.sole_product_id end as sole_product_id,
  case when pl.n_products = 1 then pr.name end as sole_product_name,
  coalesce(sp.n_suppliers, 0) as n_suppliers,
  case when sp.n_suppliers = 1 then sp.sole_supplier_id end as sole_supplier_id,
  case when sp.n_suppliers = 1 then sup.name end as sole_supplier_name
from v_trading_delivery_margin vtdm
join deliveries d on d.id = vtdm.delivery_id
join sites site on site.id = d.site_id
join settlements s on s.delivery_id = d.id
join customers c on c.id = s.customer_id
left join (
  select sh.delivery_id, sum(sh.cost) as logistics_cost
  from shipments sh
  where sh.status <> 'cancelled'
  group by sh.delivery_id
) lg on lg.delivery_id = d.id
left join v_delivery_product_line_count pl on pl.delivery_id = d.id
left join products pr on pr.id = pl.sole_product_id
left join lateral (
  select
    count(distinct coalesce(rt.supplier_id::text, 'serah_terima')) as n_suppliers,
    (array_agg(rt.supplier_id))[1] as sole_supplier_id
  from delivery_allocations da
  join batch_lines bl on bl.id = da.batch_line_id
  join receiving_lots rl on rl.id = bl.receiving_lot_id
  join receiving_transactions rt on rt.id = rl.receiving_transaction_id
  where da.delivery_id = d.id
) sp on true
left join suppliers sup on sup.id = sp.sole_supplier_id;

create or replace function investor_trading_delivery_pnl()
returns setof v_trading_delivery_pnl
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_trading_delivery_pnl where (select auth_user_role()) in ('owner', 'investor');
$$;
