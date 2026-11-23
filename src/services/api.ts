import type { AnalysisRecord, InputType, VerdictType } from '../types/techcheck';
import { getAuthHeaders } from './auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://techcheck-ita.duckdns.org';
const RECORDS_KEY = 'techcheck_records_v1';
const QUEUE_KEY = 'techcheck_pending_queue_v1';
const VERIFIED_RECS_KEY = 'techcheck_verified_recommendations_v1';

export interface PendingJob {
  localId: string;
  inputType: InputType;
  content: string;
  createdAt: string;
}

const SEED_VERIFIED_RECOMMENDATIONS: AnalysisRecord[] = [
  {
    id: 'rec-verified-1',
    title: 'Recomendación verificada: Contrastar fuentes primarias antes de compartir',
    inputType: 'text',
    sourceContent:
      'Verificar fecha original, autoría y comunicados oficiales antes de reenviar noticias virales.',
    verdict: 'supported',
    summary:
      'Guía verificada disponible sin conexión: revisa siempre si una noticia viral tiene cobertura en medios y fuentes primarias verificables.',
    claims: [
      {
        id: 'c-1',
        statement: 'Las noticias urgentes sin fuente verificable suelen amplificar desinformación.',
        status: 'supported',
        explanation: 'Contrastar con fuentes oficiales y registros previos reduce la propagación de engaños.',
        sourceRefs: [1],
      },
    ],
    sources: [
      {
        index: 1,
        title: 'Protocolo de verificación de fuentes - TechCheck',
        url: 'https://techcheck-ita.duckdns.org',
        domain: 'techcheck-ita.duckdns.org',
      },
    ],
    createdAt: '2026-11-01T12:00:00.000Z',
    isFavorite: true,
    deletedAt: null,
    pendingSync: false,
    verifiedBy: 'techcheck_curaduría',
    verifiedAt: '2026-11-01T12:00:00.000Z',
    adminNote: 'Recomendación base guardada para consulta offline.',
  },
  {
    id: 'rec-verified-2',
    title: 'Recomendación verificada: Revisar contexto y capturas editadas',
    inputType: 'text',
    sourceContent:
      'Las capturas recortadas o fuera de contexto pueden alterar el sentido real de una declaración.',
    verdict: 'supported',
    summary:
      'Recomendación guardada para modo sin conexión: comprueba el contexto completo y la fecha real del evento antes de darlo por válido.',
    claims: [
      {
        id: 'c-2',
        statement: 'El contexto temporal y completo de una publicación es clave para evaluar su veracidad.',
        status: 'supported',
        explanation: 'Publicaciones recicladas de años anteriores suelen presentarse como hechos recientes.',
        sourceRefs: [1],
      },
    ],
    sources: [
      {
        index: 1,
        title: 'Guía de lectura crítica - TechCheck',
        url: 'https://techcheck-ita.duckdns.org',
        domain: 'techcheck-ita.duckdns.org',
      },
    ],
    createdAt: '2026-11-02T12:00:00.000Z',
    isFavorite: false,
    deletedAt: null,
    pendingSync: false,
    verifiedBy: 'techcheck_curaduría',
    verifiedAt: '2026-11-02T12:00:00.000Z',
    adminNote: 'Disponible sin internet.',
  },
];

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

export function loadVerifiedRecommendations(): AnalysisRecord[] {
  try {
    const raw = localStorage.getItem(VERIFIED_RECS_KEY);
    if (!raw) {
      localStorage.setItem(VERIFIED_RECS_KEY, JSON.stringify(SEED_VERIFIED_RECOMMENDATIONS));
      return SEED_VERIFIED_RECOMMENDATIONS;
    }
    const parsed = JSON.parse(raw) as AnalysisRecord[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : SEED_VERIFIED_RECOMMENDATIONS;
  } catch {
    return SEED_VERIFIED_RECOMMENDATIONS;
  }
}

export function cacheVerifiedRecommendations(candidates: AnalysisRecord[]): AnalysisRecord[] {
  const verifiedOnly = candidates.filter(
    (item) => !item.deletedAt && !item.pendingSync && (item.verdict === 'supported' || Boolean(item.verifiedBy))
  );
  const existing = loadVerifiedRecommendations();
  const map = new Map<string, AnalysisRecord>();

  for (const item of verifiedOnly) {
    map.set(item.id, item);
  }
  for (const item of existing) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }

  const merged = Array.from(map.values()).slice(0, 20);
  localStorage.setItem(VERIFIED_RECS_KEY, JSON.stringify(merged));
  return merged;
}

export function loadLocalRecords(): AnalysisRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]') as AnalysisRecord[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      cacheVerifiedRecommendations(parsed);
      return parsed;
    }
    return loadVerifiedRecommendations();
  } catch {
    return loadVerifiedRecommendations();
  }
}

export function saveLocalRecords(records: AnalysisRecord[]) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  cacheVerifiedRecommendations(records);
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
      'Noticia guardada para verificar después. Se analizará automáticamente cuando vuelva la conexión a internet/VPN.',
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
  const mapped = rawList.map((item: unknown) => mapBackendAnalysis(item));
  cacheVerifiedRecommendations(mapped);
  return mapped;
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
