import type { AnalysisRecord, InputType, VerdictType } from '../types/techcheck';
import { getAuthHeaders } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://techcheck-ita.duckdns.org';
const RECORDS_KEY = 'techcheck_records_v1';
const QUEUE_KEY = 'techcheck_pending_queue_v1';

export interface PendingJob {
  localId: string;
  inputType: InputType;
  content: string;
  createdAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapBackendAnalysis(
  data: any,
  fallback?: {
    id?: string;
    inputType?: InputType;
    content?: string;
    createdAt?: string;
  }
): AnalysisRecord {
  const rawInputType: InputType =
    data?.input_type === 'url' || data?.input_type === 'text'
      ? data.input_type
      : fallback?.inputType ?? 'text';
  const rawContent: string = data?.content ?? fallback?.content ?? '';

  return {
    id: String(data?.id ?? fallback?.id ?? `srv-${Date.now()}`),
    title: data?.title ?? (rawContent.slice(0, 64) || 'Análisis'),
    inputType: rawInputType,
    sourceContent: rawContent,
    verdict: data?.verdict ?? 'doubtful',
    summary: data?.summary ?? '',
    claims: Array.isArray(data?.claims) ? data.claims : [],
    sources: Array.isArray(data?.sources) ? data.sources : [],
    createdAt: data?.created_at ?? fallback?.createdAt ?? new Date().toISOString(),
    isFavorite: Boolean(data?.is_favorite),
    deletedAt: data?.deleted_at ?? null,
    pendingSync: false,
    authorUsername: data?.author_username ?? null,
    verifiedBy: data?.verified_by ?? null,
    verifiedAt: data?.verified_at ?? null,
    adminNote: data?.admin_note ?? null,
  };
}

export function loadLocalRecords(): AnalysisRecord[] {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveLocalRecords(records: AnalysisRecord[]) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export function getPendingQueue(): PendingJob[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function enqueueJob(job: PendingJob) {
  const queue = getPendingQueue();
  queue.push(job);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function buildOfflinePlaceholder(job: PendingJob): AnalysisRecord {
  return {
    id: job.localId,
    title:
      job.inputType === 'url'
        ? job.content
        : job.content.slice(0, 64) + (job.content.length > 64 ? '...' : ''),
    inputType: job.inputType,
    sourceContent: job.content,
    verdict: 'doubtful',
    summary:
      'Análisis guardado en cola sin conexión. Se verificará automáticamente con el servidor al restablecer la red/VPN.',
    claims: [],
    sources: [],
    createdAt: job.createdAt,
    isFavorite: false,
    deletedAt: null,
    pendingSync: true,
    verifiedBy: null,
    verifiedAt: null,
    adminNote: null,
  };
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function submitAnalysis(
  inputType: InputType,
  content: string
): Promise<{ queued: boolean; record: AnalysisRecord }> {
  const now = new Date().toISOString();
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  try {
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ input_type: inputType, content }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const record = mapBackendAnalysis(data, {
      id: localId,
      inputType,
      content,
      createdAt: now,
    });
    const current = loadLocalRecords();
    saveLocalRecords([record, ...current]);
    return { queued: false, record };
  } catch {
    const job: PendingJob = { localId, inputType, content, createdAt: now };
    enqueueJob(job);
    const placeholder = buildOfflinePlaceholder(job);
    const current = loadLocalRecords();
    saveLocalRecords([placeholder, ...current]);
    return { queued: true, record: placeholder };
  }
}

export async function syncPendingQueue(): Promise<{ synced: number; remaining: number }> {
  const queue = getPendingQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };

  let synced = 0;
  const stillPending: PendingJob[] = [];
  let records = loadLocalRecords();

  for (const job of queue) {
    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ input_type: job.inputType, content: job.content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const updatedRecord = mapBackendAnalysis(data, {
        id: job.localId,
        inputType: job.inputType,
        content: job.content,
        createdAt: job.createdAt,
      });

      records = records.map((r) => (r.id === job.localId ? updatedRecord : r));
      synced++;
    } catch {
      stillPending.push(job);
    }
  }

  localStorage.setItem(QUEUE_KEY, JSON.stringify(stillPending));
  saveLocalRecords(records);
  return { synced, remaining: stillPending.length };
}

export async function fetchRemoteAnalyses(): Promise<AnalysisRecord[]> {
  const res = await fetch(`${API_BASE}/api/analyses`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || `Error al obtener análisis (${res.status})`);
  }
  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
      ? data.items
      : [];
  return rawList.map((item: unknown) => mapBackendAnalysis(item));
}

export async function verifyAnalysisAsAdmin(params: {
  analysisId: string;
  verdict: VerdictType;
  adminNote?: string;
}): Promise<AnalysisRecord> {
  const res = await fetch(
    `${API_BASE}/api/admin/analyses/${encodeURIComponent(params.analysisId)}/verify`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        verdict: params.verdict,
        admin_note: params.adminNote?.trim() || null,
      }),
    }
  );

  if (!res.ok) {
    let message = `Error HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (typeof err?.detail === 'string') message = err.detail;
    } catch {
      // ignorar error de parseo
    }
    throw new Error(message);
  }

  const data = await res.json();
  const payload = data?.item ?? data;
  const updated = mapBackendAnalysis(payload, { id: params.analysisId });

  const current = loadLocalRecords();
  const exists = current.some((r) => r.id === updated.id);
  const nextRecords = exists
    ? current.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
    : [updated, ...current];
  saveLocalRecords(nextRecords);

  return updated;
}
