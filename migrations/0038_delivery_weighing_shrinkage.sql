-- Varian timbang delivery dicatat sebagai shrinkage otomatis (PRD v3 P11:
-- "Penyelesaian memakai berat timbang akhir... Selisihnya dicatat sebagai
-- baris ledger tersendiri, bukan diserap diam-diam.", dikonfirmasi user).
--
-- MASALAH: fn_delivery_allocations_ledger (sejak migration awal) mengurangi
-- stok sejumlah qty yang DIALOKASIKAN (delivery_allocations.qty_kg) saat
-- alokasi terjadi. KonfirmasiTimbangPage.tsx kemudian hanya UPDATE
-- deliveries.actual_weight_kg langsung (bukan lewat RPC) TANPA PERNAH
-- merekonsiliasi balik ke ledger -- kalau actual_weight_kg hasil timbang di
-- tujuan lebih kecil dari qty yang dialokasikan (susut selama transit),
-- selisihnya tidak pernah tercatat di mana pun. Beda dengan Handover
-- (migration 0029) yang sudah eksplisit mencatat shrinkage utk pola yang
-- sama persis (qty dikirim vs qty diterima).
--
-- RESOLUSI: trigger baru (SECURITY DEFINER -- perlu ini karena
-- inventory_ledger INSERT policy owner-only, sama seperti kenapa
-- fn_handover_lines_confirm_variance juga DEFINER) yang bereaksi begitu
-- actual_weight_kg PERTAMA KALI diisi (NULL -> ada nilai). TIDAK PERLU
-- mengubah KonfirmasiTimbangPage.tsx sama sekali -- masih plain UPDATE
-- seperti sebelumnya, trigger yang menangani konsekuensi ledgernya secara
-- otomatis, persis pola yang sama dengan fn_handover_lines_confirm_variance.
--
-- Kalau delivery ini punya LEBIH DARI SATU delivery_allocations (multi-batch
-- dalam satu delivery), selisih didistribusi PROPORSIONAL ke tiap batch_line
-- sesuai porsi qty_kg masing-masing -- tidak ada input per-baris terpisah di
-- UI Konfirmasi Timbang (cuma satu angka actual_weight_kg per delivery),
-- jadi ini pendekatan yang paling masuk akal tanpa perlu redesain UI.
-- Kalau actual_weight_kg >= qty yang dialokasikan (tidak ada susut, atau
-- kelebihan timbang -- kemungkinan salah input), TIDAK ADA baris ledger yang
-- dibuat (tidak mengarang "kelebihan stok" dari udara).

create or replace function public.fn_deliveries_confirm_weighing_variance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total_allocated numeric;
  v_shortfall numeric;
  v_alloc record;
  v_line_shrinkage numeric;
begin
  select coalesce(sum(qty_kg), 0) into v_total_allocated
  from delivery_allocations where delivery_id = NEW.id;

  v_shortfall := v_total_allocated - NEW.actual_weight_kg;

  if v_shortfall > 0 and v_total_allocated > 0 then
    for v_alloc in
      select batch_line_id, qty_kg from delivery_allocations
      where delivery_id = NEW.id
      order by batch_line_id
    loop
      v_line_shrinkage := round(v_shortfall * v_alloc.qty_kg / v_total_allocated, 3);
      if v_line_shrinkage > 0 then
        insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, user_id, client_id)
        values (
          v_alloc.batch_line_id, 'shrinkage', -v_line_shrinkage,
          coalesce(NEW.delivered_at, now()), 'deliveries', NEW.id, NEW.created_by, gen_random_uuid()
        );
      end if;
    end loop;
  end if;

  return NEW;
end;
$function$;

create trigger trg_deliveries_confirm_weighing_variance
after update of actual_weight_kg on deliveries
for each row
when (old.actual_weight_kg is null and new.actual_weight_kg is not null)
execute function fn_deliveries_confirm_weighing_variance();

revoke execute on function public.fn_deliveries_confirm_weighing_variance() from public, anon, authenticated;
