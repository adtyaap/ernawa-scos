import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import type { Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface BatchOption {
  id: string;
  business_date: string;
  tank: { name: string } | null;
}

interface InspectionRow {
  id: string;
  inspected_at: string;
  grade: string | null;
  notes: string | null;
  batch: { business_date: string; site_id: string; tank: { name: string } | null } | null;
}

const GRADES = ['A', 'B', 'C'] as const;
type Grade = (typeof GRADES)[number];

const HISTORY_PAGE = 20;

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

// Inspeksi kualitas per batch (quality_inspections.batch_id). Insert-only:
// koreksi = inspeksi baru, tidak ada UPDATE dari UI (UPDATE cuma owner di
// RLS, dan riwayat inspeksi sebaiknya tetap utuh). Skala grade A/B/C
// (migration 0024) ditegakkan lewat CHECK constraint di DB.
export function InspeksiKualitasPage() {
  const { session } = useAuth();

  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [history, setHistory] = useState<InspectionRow[]>([]);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [batchId, setBatchId] = useState('');
  const [grade, setGrade] = useState<Grade | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  useEffect(() => {
    supabase
      .from('sites')
      .select('id, name, type')
      .order('name')
      .then(({ data }) => setSites((data as Site[]) ?? []));
  }, []);

  // Filter site di server (inner join), bukan disaring di browser dari
  // N baris global.
  async function loadSite(siteId: string, limit: number = historyLimit) {
    if (!siteId) {
      setBatches([]);
      setHistory([]);
      return;
    }
    setLoading(true);
    setLoadError(null);

    const [{ data: batchData, error: batchError }, { data: historyData }] = await Promise.all([
      supabase
        .from('batches')
        .select('id, business_date, tank:tanks(name)')
        .eq('site_id', siteId)
        .order('business_date', { ascending: false })
        .limit(50),
      supabase
        .from('quality_inspections')
        .select('id, inspected_at, grade, notes, batch:batches!inner(business_date, site_id, tank:tanks(name))')
        .eq('batch.site_id', siteId)
        .order('inspected_at', { ascending: false })
        .limit(limit),
    ]);

    if (batchError) {
      setLoadError(batchError.message);
      setBatches([]);
    } else {
      setBatches((batchData as unknown as BatchOption[]) ?? []);
    }

    setHistory((historyData as unknown as InspectionRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    setBatchId('');
    setFeedback(null);
    setHistoryLimit(HISTORY_PAGE);
    loadSite(selectedSiteId, HISTORY_PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId]);

  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!batchId || !grade || !session?.user.id || submitting) return;

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.from('quality_inspections').insert({
      batch_id: batchId,
      inspected_at: new Date().toISOString(),
      inspector_id: session.user.id,
      grade,
      notes: notes.trim() || null,
      client_id: crypto.randomUUID(),
    });

    setSubmitting(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: 'Inspeksi kualitas berhasil dicatat.' });
    setGrade('');
    setNotes('');
    await loadSite(selectedSiteId);
  }

  const columns: DataTableColumn<InspectionRow>[] = [
    { key: 'inspected_at', header: 'Waktu', render: (row) => formatDateTime(row.inspected_at) },
    {
      key: 'batch',
      header: 'Batch',
      render: (row) =>
        row.batch ? `${row.batch.tank?.name ?? '-'} · ${formatDate(row.batch.business_date)}` : '-',
    },
    { key: 'grade', header: 'Grade', render: (row) => row.grade ?? '-' },
    { key: 'notes', header: 'Catatan', render: (row) => row.notes ?? '-' },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Inspeksi Kualitas</h1>
        <p className="text-sm text-app-muted">Catat hasil inspeksi kualitas per batch penerimaan.</p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
          {feedback.message}
        </AlertBanner>
      )}

      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Site *</span>
            <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)} className={inputClass}>
              <option value="">Pilih site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.type})
                </option>
              ))}
            </select>
            {selectedSite && (
              <StatusBadge
                label={selectedSite.type === 'trading' ? 'Trading' : 'Budidaya'}
                tone={selectedSite.type === 'trading' ? 'info' : 'success'}
              />
            )}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Batch *</span>
            <select
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className={inputClass}
              disabled={!selectedSiteId || loading}
            >
              <option value="">Pilih batch</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.tank?.name ?? '-'} · {formatDate(b.business_date)}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Grade *</span>
            <select value={grade} onChange={(e) => setGrade(e.target.value as Grade)} className={inputClass}>
              <option value="">Pilih grade</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-app-muted">Catatan</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
          </label>
        </div>

        <button
          type="submit"
          disabled={!batchId || !grade || submitting}
          className="rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {submitting ? 'Menyimpan...' : 'Simpan Inspeksi'}
        </button>
      </form>

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat batch">
          {loadError}
        </AlertBanner>
      )}

      {selectedSiteId && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-app-text">Riwayat Inspeksi (terbaru di site ini)</h2>
          <DataTable columns={columns} rows={history} getRowId={(row) => row.id} emptyLabel="Belum ada inspeksi." />
          {history.length >= historyLimit && (
            <button
              type="button"
              onClick={() => {
                const next = historyLimit + HISTORY_PAGE;
                setHistoryLimit(next);
                loadSite(selectedSiteId, next);
              }}
              className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-muted hover:bg-white/5"
            >
              Muat lebih banyak
            </button>
          )}
        </div>
      )}
    </div>
  );
}
