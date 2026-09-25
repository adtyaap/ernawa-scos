-- =============================================================================
-- Lobster SC OS (Ernawa) — Utang Pemasok (AP): status bayar per penerimaan
-- =============================================================================
-- Dibutuhkan Finance Dashboard (Modal Kerja = Stok + Piutang - Utang Pemasok,
-- dan Aging Utang Pemasok) — dikonfirmasi user: tambah status bayar pemasok per
-- penerimaan, bukan Modal Kerja tanpa AP.
--
-- Aturan:
--   * Satu status per receiving_transaction (bukan per lot) — satu nota
--     pembelian dibayar sekali ke satu pemasok.
--   * Termin mengikuti suppliers.payment_term_days (sama seperti DPO, migration
--     0045): termin 0 = tunai di tempat -> dianggap lunas saat terima, TIDAK
--     masuk AP; termin NULL = pemasok belum diklasifikasi -> TIDAK dijumlahkan
--     ke AP (ditampilkan terpisah, bukan diasumsikan 0 = mengarang data).
--   * Nilai utang = qty receive yang TIDAK dikoreksi x harga beli lot. Baris
--     receive yang sudah di-reversal (Koreksi Ledger, pola reversal_of) tidak
--     dihitung — penerimaan salah input tidak jadi utang.
--   * Penerimaan asal Serah Terima (supplier_id NULL, migration 0029) bukan
--     pembelian — dikecualikan.
--   * supplier_paid_at hanya bisa diisi sekali (NULL -> ada) oleh Owner (RLS
--     receiving_transactions_update sudah owner-only sejak 0003) dan TIDAK bisa
--     dibatalkan/diubah setelahnya (trigger) — pola sama "Tandai Lunas" piutang.
--   * Menandai lunas TIDAK otomatis membuat baris kas perusahaan: pembayaran
--     bisa lewat Kas Panjar (sudah tercatat keluar saat top-up) atau transfer
--     bank (dicatat Owner manual kategori supplier_payment di Kas & Bank) —
--     auto-link akan dobel hitung untuk pembelian tunai lewat panjar.
-- =============================================================================

alter table receiving_transactions
  add column supplier_paid_at timestamptz,
  add column supplier_paid_by uuid references users(id);

create or replace function fn_receiving_transactions_supplier_paid_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if NEW.supplier_paid_at is distinct from OLD.supplier_paid_at
     or NEW.supplier_paid_by is distinct from OLD.supplier_paid_by then
    if OLD.supplier_paid_at is not null then
      raise exception 'Penerimaan ini sudah ditandai lunas ke pemasok — status lunas tidak bisa diubah atau dibatalkan.';
    end if;
    if NEW.supplier_id is null then
      raise exception 'Penerimaan asal Serah Terima bukan pembelian — tidak punya utang pemasok.';
    end if;
    if NEW.supplier_paid_at is null then
      NEW.supplier_paid_by := null;
    else
      if NEW.supplier_paid_at > now() + interval '1 day' then
        raise exception 'Tanggal lunas tidak boleh di masa depan.';
      end if;
      NEW.supplier_paid_by := auth.uid();
    end if;
  end if;
  return NEW;
end;
$$;

revoke execute on function fn_receiving_transactions_supplier_paid_guard() from public, anon, authenticated;

create trigger trg_receiving_transactions_supplier_paid_guard
  before update on receiving_transactions
  for each row execute function fn_receiving_transactions_supplier_paid_guard();

-- Satu baris per penerimaan dari pemasok eksternal (semua track; filter track
-- di pemakai — aturan #1). amount = nilai penerimaan yang tidak dikoreksi.
create view v_supplier_payables with (security_invoker = true) as
select
  rt.id as receiving_transaction_id,
  rt.site_id,
  site.name as site_name,
  site.type::text as track,
  rt.supplier_id,
  sup.name as supplier_name,
  sup.payment_term_days,
  rt.transaction_date,
  case when sup.payment_term_days is not null
       then rt.transaction_date + sup.payment_term_days end as due_date,
  case when sup.payment_term_days is not null
       then (rt.transaction_date + sup.payment_term_days) - current_date end as days_until_due,
  coalesce(val.amount, 0) as amount,
  rt.supplier_paid_at,
  rt.supplier_paid_by
from receiving_transactions rt
join sites site on site.id = rt.site_id
join suppliers sup on sup.id = rt.supplier_id
left join lateral (
  select sum(il.qty_kg * rl.buy_price_per_kg) as amount
  from receiving_lots rl
  join batch_lines bl on bl.receiving_lot_id = rl.id
  join inventory_ledger il on il.batch_line_id = bl.id and il.movement_type = 'receive'
  where rl.receiving_transaction_id = rt.id
    and not exists (select 1 from inventory_ledger r where r.reversal_of = il.id)
) val on true
where rt.supplier_id is not null;

create or replace function investor_supplier_payables()
returns setof v_supplier_payables
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_supplier_payables where (select auth_user_role()) in ('owner', 'investor');
$$;
