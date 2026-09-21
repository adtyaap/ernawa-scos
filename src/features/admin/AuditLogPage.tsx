import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { StatusBadge, type BadgeTone } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatKg, localDayEndISO, localDayStartISO } from '../../lib/format';
import type { Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

const PAGE_SIZE = 50;

interface AuditRow {
  id: string;
  table_name: string;
  row_id: string;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_at: string;
  actor: { full_name: string } | null;
}

const TABLE_LABELS: Record<string, string> = {
  inventory_ledger: 'Ledger stok',
  user_sites: 'Penugasan site',
  users: 'User',
};

const ACTION_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  reversal: { label: 'Koreksi', tone: 'warning' },
  insert: { label: 'Ditambah', tone: 'success' },
  update: { label: 'Diubah', tone: 'info' },
  delete: { label: 'Dicabut', tone: 'danger' },
  invite: { label: 'Undangan', tone: 'info' },
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Penampil audit_log (owner-only, dijaga RLS audit_log_select). Read-only:
// audit adalah jejak yang tidak boleh diubah dari aplikasi. Ringkasan dibuat
// dari old_data/new_data per jenis catatan; JSON mentahnya bisa dibuka lewat
// "Detail" supaya tidak ada informasi yang tersembunyi.
export function AuditLogPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [tableName, setTableName] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [siteNames, setSiteNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([supabase.from('users').select('id, full_name'), supabase.from('sites').select('id, name, type')]).then(
      ([{ data: userData }, { data: siteData }]) => {
        setUserNames(new Map(((userData as { id: string; full_name: string }[] | null) ?? []).map((u) => [u.id, u.full_name])));
        setSiteNames(new Map(((siteData as Site[] | null) ?? []).map((s) => [s.id, s.name])));
      },
    );
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('audit_log')
        .select(
          'id, table_name, row_id, action, old_data, new_data, changed_at, actor:users!audit_log_changed_by_fkey(full_name)',
        )
        .order('changed_at', { ascending: false })
        .limit(limit);

      if (tableName) query = query.eq('table_name', tableName);
      if (action) query = query.eq('action', action);
      if (dateFrom) query = query.gte('changed_at', localDayStartISO(dateFrom));
      if (dateTo) query = query.lte('changed_at', localDayEndISO(dateTo));

      const { data, error: queryError } = await query;
      if (!active) return;

      if (queryError) {
        setError(queryError.message);
        setRows([]);
      } else {
        setRows((data as unknown as AuditRow[]) ?? []);
      }
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [isOwner, tableName, action, dateFrom, dateTo, limit]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [tableName, action, dateFrom, dateTo]);

  function userLabel(id: unknown): string {
    if (typeof id !== 'string') return '-';
    return userNames.get(id) ?? `user terhapus (${id.slice(0, 8)})`;
  }

  function summarize(row: AuditRow): string {
    const data = row.new_data ?? row.old_data ?? {};
    if (row.table_name === 'inventory_ledger' && row.action === 'reversal') {
      const qty = Number(data.qty_kg);
      const reason = typeof data.reason === 'string' ? data.reason : '-';
      return `Koreksi ${Number.isFinite(qty) ? formatKg(Math.abs(qty)) : ''} — alasan: ${reason}`;
    }
    if (row.table_name === 'user_sites') {
      const site = typeof data.site_id === 'string' ? (siteNames.get(data.site_id) ?? 'site') : 'site';
      const who = userLabel(row.row_id);
      if (row.action === 'delete') return `Akses ${who} ke ${site} dicabut`;
      if (row.action === 'insert') return `${who} ditugaskan ke ${site}`;
      return `Penugasan ${who} diubah`;
    }
    if (row.table_name === 'users' && row.action === 'invite') {
      const sites = Array.isArray(data.site_ids) ? data.site_ids.map((id) => siteNames.get(String(id)) ?? '?').join(', ') : '';
      return `Akun ${String(data.full_name ?? '')} (${String(data.email ?? '')}) dibuat sebagai ${String(data.role ?? '')}${sites ? `, site: ${sites}` : ''}`;
    }
    return `${row.action} pada ${row.table_name}`;
  }

  if (!isOwner) {
    return (
      <div className="max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-app-text">Admin &gt; Audit Log</h1>
        <AlertBanner variant="warning" title="Akses terbatas">
          Audit log hanya bisa dilihat oleh Owner.
        </AlertBanner>
      </div>
    );
  }

  const columns: DataTableColumn<AuditRow>[] = [
    { key: 'changed_at', header: 'Waktu', render: (row) => formatDateTime(row.changed_at) },
    {
      key: 'table_name',
      header: 'Jenis',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <span>{TABLE_LABELS[row.table_name] ?? row.table_name}</span>
          <StatusBadge
            label={ACTION_LABELS[row.action]?.label ?? row.action}
            tone={ACTION_LABELS[row.action]?.tone ?? 'neutral'}
          />
        </div>
      ),
    },
    { key: 'actor', header: 'Pelaku', render: (row) => row.actor?.full_name ?? 'Sistem / SQL langsung' },
    {
      key: 'summary',
      header: 'Ringkasan',
      render: (row) => (
        <div className="space-y-1">
          <p>{summarize(row)}</p>
          <details className="text-xs text-app-muted">
            <summary className="cursor-pointer">Detail</summary>
            <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap rounded bg-app-bg p-2">
              {JSON.stringify({ sebelum: row.old_data, sesudah: row.new_data, row_id: row.row_id }, null, 2)}
            </pre>
          </details>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Admin &gt; Audit Log</h1>
        <p className="text-sm text-app-muted">
          Jejak koreksi ledger, penugasan site, dan pembuatan akun. Hanya bisa dibaca, tidak bisa diubah dari aplikasi.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-app-border bg-app-panel p-4 sm:grid-cols-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Jenis</span>
          <select id="audit-tabel" value={tableName} onChange={(e) => setTableName(e.target.value)} className={inputClass}>
            <option value="">Semua</option>
            {Object.entries(TABLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Aksi</span>
          <select id="audit-aksi" value={action} onChange={(e) => setAction(e.target.value)} className={inputClass}>
            <option value="">Semua</option>
            {Object.entries(ACTION_LABELS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Dari tanggal</span>
          <input id="audit-dari" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Sampai tanggal</span>
          <input id="audit-sampai" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
        </label>
      </div>

      {error && (
        <AlertBanner variant="danger" title="Gagal memuat audit log">
          {error}
        </AlertBanner>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyLabel={loading ? 'Memuat...' : 'Tidak ada catatan untuk filter ini.'}
      />

      {rows.length >= limit && (
        <button
          type="button"
          onClick={() => setLimit(limit + PAGE_SIZE)}
          className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-muted hover:bg-white/5"
        >
          Muat lebih banyak
        </button>
      )}
    </div>
  );
}
