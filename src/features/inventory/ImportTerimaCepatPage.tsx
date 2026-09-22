import { useState } from 'react';
import ExcelJS from 'exceljs';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { StatusBadge, type BadgeTone } from '../../components/shared/StatusBadge';
import { formatKg, formatCurrency } from '../../lib/format';
import { parseIndonesianNumber, parseFlexibleDate, normalizeName } from '../../lib/importExcel';

interface MasterData {
  suppliers: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  tanks: { id: string; site_id: string; name: string }[];
  products: { id: string; name: string }[];
}

interface ExistingLot {
  qty_kg: number;
  buy_price_per_kg: number;
  product_id: string;
  supplier_id: string;
  site_id: string;
  transaction_date: string;
}

type RowStatus = 'valid' | 'invalid' | 'duplicate' | 'imported' | 'failed';

interface ParsedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  status: RowStatus;
  reason?: string;
  supplierId?: string;
  siteId?: string;
  tankId?: string;
  productId?: string;
  productName?: string;
  qtyKg?: number;
  priceKg?: number;
  date?: string;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  valid: 'Siap diimpor',
  invalid: 'Tidak valid',
  duplicate: 'Duplikat (dilewati)',
  imported: 'Berhasil diimpor',
  failed: 'Gagal',
};
const STATUS_TONE: Record<RowStatus, BadgeTone> = {
  valid: 'info',
  invalid: 'danger',
  duplicate: 'warning',
  imported: 'success',
  failed: 'danger',
};

const REQUIRED_HEADERS = ['tanggal', 'supplier', 'site', 'tank', 'produk', 'qty', 'harga'];

// Import massal Terima Cepat dari Excel. Memakai create_receiving_with_batch
// (migration 0010) yang SAMA dengan form manual — tidak ada jalur insert
// terpisah, jadi tidak ada duplikasi business logic (guard RLS/site-scoping/
// atomicity semuanya tetap berlaku persis seperti input manual).
//
// Header kolom WAJIB (baris pertama, urutan bebas, case-insensitive):
// Tanggal | Supplier | Site | Tank | Produk | Qty | Harga
//
// Angka format Indonesia ("Rp520.000") dan sel numerik asli Excel sama-sama
// didukung (lib/importExcel.ts) — ini kelas bug v43 yang sengaja dihindari:
// titik SELALU dianggap pemisah ribuan pada teks, tidak pernah desimal.
//
// Supplier/Site/Tank/Produk dicocokkan by NAME ke master data yang SUDAH ADA
// (case-insensitive) — TIDAK membuat master data baru secara diam-diam kalau
// tidak ketemu (baris ditandai invalid dengan alasan jelas), supaya import
// tidak bisa mengotori master data dengan typo.
//
// Idempotensi: baris yang identik (supplier+site+produk+tanggal+qty+harga)
// dengan receiving_lots yang SUDAH ADA ditandai duplikat dan DILEWATI — bukan
// dedup key baru di skema (receiving_transactions tidak punya client_id),
// tapi kombinasi ini cukup kuat untuk mencegah impor file yang sama 2x.
//
// Baris valid DIKELOMPOKKAN per (supplier, site, tank, tanggal) sebelum
// disubmit — satu kelompok = SATU transaksi (bisa multi-produk), persis
// perilaku form Terima Cepat manual kalau menambah beberapa baris produk.
export function ImportTerimaCepatPage() {
  const [master, setMaster] = useState<MasterData | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function loadMaster(): Promise<MasterData> {
    const [{ data: suppliers }, { data: sites }, { data: tanks }, { data: products }] = await Promise.all([
      supabase.from('suppliers').select('id, name').eq('status', 'aktif'),
      supabase.from('sites').select('id, name'),
      supabase.from('tanks').select('id, site_id, name'),
      supabase.from('products').select('id, name'),
    ]);
    const m: MasterData = {
      suppliers: suppliers ?? [],
      sites: sites ?? [],
      tanks: tanks ?? [],
      products: products ?? [],
    };
    setMaster(m);
    return m;
  }

  async function loadExistingLots(): Promise<ExistingLot[]> {
    const { data } = await supabase
      .from('receiving_lots')
      .select('qty_kg, buy_price_per_kg, product_id, receiving_transaction:receiving_transactions(supplier_id, site_id, transaction_date)');
    return (
      (data as unknown as { qty_kg: number; buy_price_per_kg: number; product_id: string; receiving_transaction: { supplier_id: string; site_id: string; transaction_date: string } | null }[]) ?? []
    )
      .filter((r) => r.receiving_transaction)
      .map((r) => ({
        qty_kg: Number(r.qty_kg),
        buy_price_per_kg: Number(r.buy_price_per_kg),
        product_id: r.product_id,
        supplier_id: r.receiving_transaction!.supplier_id,
        site_id: r.receiving_transaction!.site_id,
        transaction_date: r.receiving_transaction!.transaction_date,
      }));
  }

  async function handleFile(file: File) {
    setParsing(true);
    setParseError(null);
    setSummary(null);
    setRows([]);

    try {
      const [m, existing] = await Promise.all([loadMaster(), loadExistingLots()]);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('File tidak punya sheet.');

      const headerRow = sheet.getRow(1);
      const columnIndex: Record<string, number> = {};
      headerRow.eachCell((cell, colNumber) => {
        const key = normalizeName(cell.value);
        if (REQUIRED_HEADERS.includes(key)) columnIndex[key] = colNumber;
      });
      const missing = REQUIRED_HEADERS.filter((h) => !(h in columnIndex));
      if (missing.length > 0) {
        throw new Error(`Kolom wajib tidak ditemukan di baris pertama: ${missing.join(', ')}.`);
      }

      const parsed: ParsedRow[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const get = (key: string) => row.getCell(columnIndex[key]).value;
        const raw: Record<string, unknown> = {
          tanggal: get('tanggal'),
          supplier: get('supplier'),
          site: get('site'),
          tank: get('tank'),
          produk: get('produk'),
          qty: get('qty'),
          harga: get('harga'),
        };
        if (Object.values(raw).every((v) => v === null || v === undefined || v === '')) return; // baris kosong

        const entry: ParsedRow = { rowNumber, raw, status: 'valid' };

        const date = parseFlexibleDate(raw.tanggal);
        const supplier = m.suppliers.find((s) => normalizeName(s.name) === normalizeName(raw.supplier));
        const site = m.sites.find((s) => normalizeName(s.name) === normalizeName(raw.site));
        const tank = site ? m.tanks.find((t) => t.site_id === site.id && normalizeName(t.name) === normalizeName(raw.tank)) : undefined;
        const product = m.products.find((p) => normalizeName(p.name) === normalizeName(raw.produk));
        const qty = parseIndonesianNumber(raw.qty);
        const price = parseIndonesianNumber(raw.harga);

        const problems: string[] = [];
        if (!date) problems.push(`tanggal "${String(raw.tanggal ?? '')}" tidak dikenali`);
        if (!supplier) problems.push(`supplier "${String(raw.supplier ?? '')}" tidak ditemukan`);
        if (!site) problems.push(`site "${String(raw.site ?? '')}" tidak ditemukan`);
        if (site && !tank) problems.push(`tank "${String(raw.tank ?? '')}" tidak ditemukan di site ini`);
        if (!product) problems.push(`produk "${String(raw.produk ?? '')}" tidak ditemukan`);
        if (qty === null || qty <= 0) problems.push(`qty "${String(raw.qty ?? '')}" tidak valid`);
        if (price === null || price <= 0) problems.push(`harga "${String(raw.harga ?? '')}" tidak valid`);

        if (problems.length > 0) {
          entry.status = 'invalid';
          entry.reason = problems.join('; ');
        } else {
          entry.supplierId = supplier!.id;
          entry.siteId = site!.id;
          entry.tankId = tank!.id;
          entry.productId = product!.id;
          entry.productName = product!.name;
          entry.qtyKg = qty!;
          entry.priceKg = price!;
          entry.date = date!;

          const isDuplicate = existing.some(
            (e) =>
              e.supplier_id === entry.supplierId &&
              e.site_id === entry.siteId &&
              e.product_id === entry.productId &&
              e.transaction_date === entry.date &&
              Math.abs(e.qty_kg - entry.qtyKg!) < 0.001 &&
              Math.abs(e.buy_price_per_kg - entry.priceKg!) < 0.01,
          );
          if (isDuplicate) {
            entry.status = 'duplicate';
            entry.reason = 'Baris identik sudah pernah diimpor sebelumnya.';
          }
        }

        parsed.push(entry);
      });

      if (parsed.length === 0) throw new Error('Tidak ada baris data (selain header) di file ini.');
      setRows(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    const validRows = rows.filter((r) => r.status === 'valid');
    if (validRows.length === 0 || importing) return;

    setImporting(true);
    setSummary(null);

    // Kelompokkan per (supplier, site, tank, tanggal) -> satu transaksi per
    // kelompok, bisa multi-produk (persis alur manual TerimaCepatPage).
    const groups = new Map<string, ParsedRow[]>();
    for (const row of validRows) {
      const key = `${row.supplierId}|${row.siteId}|${row.tankId}|${row.date}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    const nextRows = [...rows];
    let successCount = 0;
    let failCount = 0;

    for (const groupRows of groups.values()) {
      const first = groupRows[0];
      // Grup ini hanya berisi baris berstatus 'valid' (difilter sebelum
      // dikelompokkan), jadi field-field ini pasti terisi — tapi tipenya
      // opsional karena ParsedRow dipakai bersama untuk baris invalid juga.
      const { error } = await supabase.rpc('create_receiving_with_batch', {
        p_supplier_id: first.supplierId as string,
        p_site_id: first.siteId as string,
        p_tank_id: first.tankId as string,
        p_transaction_date: first.date as string,
        p_lots: groupRows.map((r) => ({ product_id: r.productId as string, qty_kg: r.qtyKg as number, buy_price_per_kg: r.priceKg as number })),
      });

      for (const row of groupRows) {
        const idx = nextRows.findIndex((r) => r.rowNumber === row.rowNumber);
        if (idx === -1) continue;
        if (error) {
          nextRows[idx] = { ...nextRows[idx], status: 'failed', reason: error.message };
          failCount++;
        } else {
          nextRows[idx] = { ...nextRows[idx], status: 'imported' };
          successCount++;
        }
      }
    }

    setRows(nextRows);
    setImporting(false);
    const skipped = rows.filter((r) => r.status === 'duplicate').length;
    const invalid = rows.filter((r) => r.status === 'invalid').length;
    setSummary(
      `${successCount} baris berhasil diimpor (${groups.size} transaksi)${failCount > 0 ? `, ${failCount} gagal` : ''}${skipped > 0 ? `, ${skipped} duplikat dilewati` : ''}${invalid > 0 ? `, ${invalid} tidak valid diabaikan` : ''}.`,
    );
  }

  const validCount = rows.filter((r) => r.status === 'valid').length;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Import Terima Cepat</h1>
        <p className="text-sm text-app-muted">
          Impor banyak transaksi penerimaan sekaligus dari Excel. Kolom wajib di baris pertama: Tanggal, Supplier,
          Site, Tank, Produk, Qty, Harga.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">File Excel (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            disabled={parsing || importing}
            className="block w-full text-sm text-app-text file:mr-3 file:rounded-md file:border-0 file:bg-app-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-black"
          />
        </label>
        {parsing && <p className="text-sm text-app-muted">Membaca file...</p>}
      </div>

      {parseError && (
        <AlertBanner variant="danger" title="Gagal membaca file">
          {parseError}
        </AlertBanner>
      )}
      {summary && (
        <AlertBanner variant="success" title="Import selesai">
          {summary}
        </AlertBanner>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-app-muted">
              {rows.length} baris terbaca — {validCount} siap diimpor.
            </p>
            <button
              type="button"
              onClick={handleImport}
              disabled={validCount === 0 || importing}
              className="rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              {importing ? 'Mengimpor...' : `Impor ${validCount} Baris`}
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-app-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-app-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Baris</th>
                  <th className="px-3 py-2 font-medium">Tanggal</th>
                  <th className="px-3 py-2 font-medium">Supplier</th>
                  <th className="px-3 py-2 font-medium">Site / Tank</th>
                  <th className="px-3 py-2 font-medium">Produk</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Harga</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {rows.map((row) => (
                  <tr key={row.rowNumber} className="text-app-text">
                    <td className="px-3 py-2 text-app-muted">{row.rowNumber}</td>
                    <td className="px-3 py-2">{row.date ?? String(row.raw.tanggal ?? '-')}</td>
                    <td className="px-3 py-2">{String(row.raw.supplier ?? '-')}</td>
                    <td className="px-3 py-2">
                      {String(row.raw.site ?? '-')} / {String(row.raw.tank ?? '-')}
                    </td>
                    <td className="px-3 py-2">{row.productName ?? String(row.raw.produk ?? '-')}</td>
                    <td className="px-3 py-2">{row.qtyKg !== undefined ? formatKg(row.qtyKg) : String(row.raw.qty ?? '-')}</td>
                    <td className="px-3 py-2">{row.priceKg !== undefined ? formatCurrency(row.priceKg) : String(row.raw.harga ?? '-')}</td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <StatusBadge label={STATUS_LABEL[row.status]} tone={STATUS_TONE[row.status]} />
                        {row.reason && <p className="text-xs text-app-muted">{row.reason}</p>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {master && master.suppliers.length === 0 && (
        <AlertBanner variant="warning" title="Belum ada supplier aktif">
          Tambahkan supplier dulu di Source &gt; Supplier Management sebelum mengimpor.
        </AlertBanner>
      )}
    </div>
  );
}
