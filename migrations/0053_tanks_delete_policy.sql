-- Owner minta "Tank Uji Playwright" (leftover test data dari sesi browser
-- testing Playwright sebelumnya, migration 0029) dihapus dari produksi.
-- `tanks` sengaja TIDAK punya policy DELETE sejak awal (konsisten pola
-- Customer/Supplier/Kelola Produk) -- keputusan itu TETAP berlaku sebagai
-- default (tank yang sudah dipakai penerimaan/handover nyata tidak boleh
-- bisa dihapus sembarangan lewat UI). Owner dikonfirmasi eksplisit ingin
-- kemampuan hapus ditambahkan permanen (bukan cuma sekali pakai), jadi
-- dibuat policy owner-only alih-alih workaround service_role sekali pakai.
--
-- Guard keamanan REAL ada di level FK, bukan kode aplikasi: batches.tank_id
-- references tanks(id) TANPA "on delete cascade" (default RESTRICT) --
-- Postgres akan MENOLAK delete kalau tank itu punya batch/riwayat inventory
-- apa pun. Jadi policy ini SECARA STRUKTURAL cuma bisa menghapus tank yang
-- benar-benar belum pernah dipakai (persis kasus tank uji ini), tidak bisa
-- dipakai menghapus tank produksi yang sudah bersejarah walau dipanggil
-- owner sekalipun -- tidak perlu trigger guard tambahan.
create policy tanks_delete on tanks for delete to authenticated
  using ((select auth_user_role()) = 'owner');
