import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  Search,
  Star,
  Trash2,
  RotateCcw,
  Wifi,
  WifiOff,
  RefreshCw,
  Link2,
  FileText,
  ExternalLink,
  CheckCircle2,
  Clock,
  LogOut,
} from 'lucide-react';
import type { AnalysisRecord, InputType, VerdictType } from './types/techcheck';
import {
  checkServerHealth,
  getPendingQueue,
  loadLocalRecords,
  saveLocalRecords,
  submitAnalysis,
  syncPendingQueue,
  fetchRemoteAnalyses,
  verifyAnalysisAsAdmin,
} from './services/api';
import {
  type AuthUser,
  clearSession,
  fetchCurrentUser,
  getStoredToken,
  getStoredUser,
  saveSession,
} from './services/auth';
import { AuthGate } from './components/AuthGate';

type TabKey = 'analyze' | 'history' | 'favorites' | 'trash' | 'admin' | 'settings';

const VERDICT_META: Record<
  VerdictType,
  { label: string; badgeClass: string; borderClass: string }
> = {
  supported: {
    label: 'Información respaldada',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    borderClass: 'border-emerald-500/40',
  },
  doubtful: {
    label: 'Información dudosa',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    borderClass: 'border-amber-500/40',
  },
  misleading: {
    label: 'Posiblemente engañosa',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    borderClass: 'border-rose-500/40',
  },
};

function VerdictIcon({ verdict }: { verdict: VerdictType }) {
  if (verdict === 'supported') return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
  if (verdict === 'misleading') return <AlertTriangle className="w-4 h-4 text-rose-400" />;
  return <HelpCircle className="w-4 h-4 text-amber-400" />;
}

export function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [checkingAuth, setCheckingAuth] = useState<boolean>(() => Boolean(getStoredToken()));

  const [activeTab, setActiveTab] = useState<TabKey>('analyze');
  const [inputType, setInputType] = useState<InputType>('url');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [records, setRecords] = useState<AnalysisRecord[]>(() => loadLocalRecords());
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const initial = loadLocalRecords().find((r) => !r.deletedAt);
    return initial ? initial.id : null;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<'all' | VerdictType>('all');
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [serverReachable, setServerReachable] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(() => getPendingQueue().length);
  const [syncing, setSyncing] = useState(false);
  const [apiUrlDisplay] = useState<string>(
    import.meta.env.VITE_API_BASE_URL || 'https://techcheck-ita.duckdns.org'
  );

  useEffect(() => {
    let active = true;
    const token = getStoredToken();
    if (!token) {
      setCheckingAuth(false);
      return;
    }

    fetchCurrentUser(token)
      .then((verified) => {
        if (!active) return;
        if (verified) {
          setUser(verified);
          saveSession(token, verified);
        } else if (navigator.onLine) {
          clearSession();
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setCheckingAuth(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    saveLocalRecords(records);
  }, [records]);

  const refreshConnectionAndSync = async () => {
    setSyncing(true);
    const navOnline = navigator.onLine;
    setOnline(navOnline);
    const healthy = await checkServerHealth();
    setServerReachable(healthy);

    if (healthy && getPendingQueue().length > 0) {
      const res = await syncPendingQueue();
      setRecords(loadLocalRecords());
      setPendingCount(res.remaining);
      if (res.synced > 0) {
        setStatusBanner(`Sincronizados ${res.synced} análisis pendientes con el servidor.`);
      }
    } else {
      setPendingCount(getPendingQueue().length);
    }
    setSyncing(false);
  };

  useEffect(() => {
    if (!user) return;
    refreshConnectionAndSync();
    const handleOnline = () => refreshConnectionAndSync();
    const handleOffline = () => {
      setOnline(false);
      setServerReachable(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user]);

  const [adminFilter, setAdminFilter] = useState<'pending' | 'verified' | 'all'>('pending');
  const [adminAuthorFilter, setAdminAuthorFilter] = useState<string>('all');
  const [loadingAdminQueue, setLoadingAdminQueue] = useState<boolean>(false);
  const [adminQueueError, setAdminQueueError] = useState<string | null>(null);

  const loadAdminQueue = async () => {
    if (user?.role !== 'admin') return;
    setLoadingAdminQueue(true);
    setAdminQueueError(null);
    try {
      const remoteItems = await fetchRemoteAnalyses();
      setRecords((prev) => {
        const remoteMap = new Map(remoteItems.map((item) => [item.id, item]));
        const mergedRemote = remoteItems.map((item) => {
          const existing = prev.find((pItem) => pItem.id === item.id);
          return existing
            ? {
                ...existing,
                ...item,
                isFavorite: existing.isFavorite ?? item.isFavorite,
                deletedAt: existing.deletedAt ?? item.deletedAt,
              }
            : item;
        });
        const localOnly = prev.filter((pItem) => !remoteMap.has(pItem.id));
        const next = [...mergedRemote, ...localOnly];
        saveLocalRecords(next);
        return next;
      });
    } catch (err) {
      setAdminQueueError(
        err instanceof Error ? err.message : 'No se pudieron cargar los análisis de usuarios'
      );
    } finally {
      setLoadingAdminQueue(false);
    }
  };

  const [adminVerdict, setAdminVerdict] = useState<VerdictType>('doubtful');
  const [adminNote, setAdminNote] = useState<string>('');
  const [verifyingAdmin, setVerifyingAdmin] = useState<boolean>(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (activeTab === 'admin' && user?.role === 'admin') {
      loadAdminQueue();
    }
  }, [activeTab, user?.role]);

  const pendingAdminCount = useMemo(
    () => records.filter((r) => !r.deletedAt && !r.verifiedBy).length,
    [records]
  );

  const adminAuthors = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (!r.deletedAt && r.authorUsername) set.add(r.authorUsername);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const filteredAdminRecords = useMemo(() => {
    return records
      .filter((r) => !r.deletedAt)
      .filter((r) => {
        if (adminFilter === 'pending') return !r.verifiedBy;
        if (adminFilter === 'verified') return Boolean(r.verifiedBy);
        return true;
      })
      .filter((r) => {
        if (adminAuthorFilter === 'all') return true;
        return r.authorUsername === adminAuthorFilter;
      });
  }, [records, adminFilter, adminAuthorFilter]);

  useEffect(() => {
    if (activeTab !== 'admin' || user?.role !== 'admin') return;
    if (filteredAdminRecords.length === 0) return;
    const stillVisible = filteredAdminRecords.some((r) => r.id === selectedId);
    if (!stillVisible) {
      setSelectedId(filteredAdminRecords[0].id);
    }
  }, [activeTab, user?.role, filteredAdminRecords, selectedId]);

  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedId) || null,
    [records, selectedId]
  );

  useEffect(() => {
    if (!selectedRecord) return;
    setAdminVerdict(selectedRecord.verdict);
    setAdminNote(selectedRecord.adminNote ?? '');
    setVerifyFeedback(null);
  }, [selectedRecord?.id, selectedRecord?.verdict, selectedRecord?.adminNote]);

  const handleAdminVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord || user?.role !== 'admin') return;
    setVerifyingAdmin(true);
    setVerifyFeedback(null);
    try {
      const updated = await verifyAnalysisAsAdmin({
        analysisId: selectedRecord.id,
        verdict: adminVerdict,
        adminNote,
      });
      setRecords((prev) => {
        const next = prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
        saveLocalRecords(next);
        return next;
      });
      setAdminVerdict(updated.verdict);
      setAdminNote(updated.adminNote ?? '');
      setVerifyFeedback({ type: 'ok', text: `Validado por @${updated.verifiedBy || user.username}` });
    } catch (err) {
      setVerifyFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Error al validar' });
    } finally {
      setVerifyingAdmin(false);
    }
  };

  const visibleRecords = useMemo(() => {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    return records.filter((r) => {
      const isTrashed = Boolean(r.deletedAt);
      if (activeTab === 'trash') {
        if (!isTrashed) return false;
        const deletedTime = r.deletedAt ? new Date(r.deletedAt).getTime() : now;
        return now - deletedTime <= thirtyDaysMs;
      }
      if (isTrashed) return false;
      if (activeTab === 'favorites' && !r.isFavorite) return false;
      if (verdictFilter !== 'all' && r.verdict !== verdictFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = r.title.toLowerCase().includes(q);
        const matchesSummary = r.summary.toLowerCase().includes(q);
        const matchesSource = r.sourceContent.toLowerCase().includes(q);
        return matchesTitle || matchesSummary || matchesSource;
      }
      return true;
    });
  }, [records, activeTab, verdictFilter, searchQuery]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center text-sm">
        Verificando sesión...
      </div>
    );
  }

  if (!user) {
    return <AuthGate onAuthenticated={(authedUser) => setUser(authedUser)} />;
  }

  const handleLogout = () => {
    clearSession();
    setUser(null);
    setStatusBanner(null);
  };

  const handleAnalyzeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    setStatusBanner(null);

    const result = await submitAnalysis(inputType, content.trim());
    setRecords(loadLocalRecords());
    setPendingCount(getPendingQueue().length);
    setSelectedId(result.record.id);
    setContent('');

    if (result.queued) {
      setStatusBanner(
        'Sin conexión al servidor/VPN: análisis agregado a la cola local para sincronizar después.'
      );
      setServerReachable(false);
    } else {
      setStatusBanner('Análisis completado desde el servidor.');
      setServerReachable(true);
    }

    setSubmitting(false);
  };

  const toggleFavorite = (id: string) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isFavorite: !r.isFavorite } : r))
    );
  };

  const moveToTrash = (id: string) => {
    setRecords((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, deletedAt: new Date().toISOString(), isFavorite: false } : r
      )
    );
  };

  const restoreFromTrash = (id: string) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, deletedAt: null } : r))
    );
  };

  const deleteForever = (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Encabezado */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white">
            TC
          </div>
          <div>
            <h1 className="font-semibold text-base leading-tight">TechCheck</h1>
            <p className="text-xs text-slate-400">
              @{user.username} · Web + Android
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
              serverReachable
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
            }`}
          >
            {serverReachable ? (
              <Wifi className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            {serverReachable ? 'API VPN activa' : online ? 'Sin API VPN' : 'Sin red'}
          </span>

          {pendingCount > 0 && (
            <button
              onClick={refreshConnectionAndSync}
              disabled={syncing}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Pendientes ({pendingCount})
            </button>
          )}

          <button
            type="button"
            onClick={handleLogout}
            title="Cerrar sesión"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Salir
          </button>
        </div>
      </header>

      {/* Navegación principal */}
      <nav className="border-b border-slate-800 bg-slate-900/50 px-4 flex gap-1 overflow-x-auto">
        {(
          (
            [
              ['analyze', 'Analizar'],
              ['history', 'Historial'],
              ['favorites', 'Favoritos'],
              ['trash', 'Papelera (30d)'],
              ...(user?.role === 'admin' ? ([['admin', 'Revisión admin']] as [TabKey, string][]) : []),
              ['settings', 'Ajustes / VPN'],
            ] as [TabKey, string][]
          )
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-3.5 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap cursor-pointer inline-flex items-center gap-1.5 ${
              activeTab === key
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>{label}</span>
            {key === 'admin' && pendingAdminCount > 0 && (
              <span className="px-1.5 py-0.5 text-[11px] rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {pendingAdminCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {statusBanner && (
        <div className="mx-4 mt-3 px-3.5 py-2 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-xs text-indigo-200 flex items-center justify-between">
          <span>{statusBanner}</span>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-indigo-300 hover:text-white ml-3 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Contenido principal */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 max-w-7xl w-full mx-auto">
        {/* Columna izquierda */}
        <section className="lg:col-span-7 space-y-4">
          {activeTab === 'admin' && user?.role === 'admin' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-base">Revisión administrativa de noticias</h2>
                  <p className="text-xs text-slate-400">
                    Selecciona una noticia enviada por usuarios para verificarla y anotar dictamen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadAdminQueue}
                  disabled={loadingAdminQueue}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-medium text-slate-200 cursor-pointer"
                >
                  {loadingAdminQueue ? 'Actualizando...' : 'Actualizar bandeja'}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['pending', 'Pendientes'],
                      ['verified', 'Validados'],
                      ['all', 'Todos'],
                    ] as const
                  ).map(([fKey, fLabel]) => (
                    <button
                      key={fKey}
                      type="button"
                      onClick={() => setAdminFilter(fKey)}
                      className={`px-3 py-1.5 rounded-lg border cursor-pointer ${
                        adminFilter === fKey
                          ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {fLabel}
                    </button>
                  ))}
                </div>

                <select
                  value={adminAuthorFilter}
                  onChange={(e) => setAdminAuthorFilter(e.target.value)}
                  className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">Todos los autores</option>
                  {adminAuthors.map((author) => (
                    <option key={author} value={author}>
                      @{author}
                    </option>
                  ))}
                </select>
              </div>

              {adminQueueError && (
                <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                  {adminQueueError}
                </div>
              )}

              <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
                {filteredAdminRecords.map((item) => {
                    const isSelected = selectedRecord?.id === item.id;
                    const vMeta = VERDICT_META[item.verdict];
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                        className={`rounded-xl border p-3.5 transition cursor-pointer space-y-2 ${
                          isSelected
                            ? 'bg-indigo-950/30 border-indigo-500'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${vMeta.badgeClass}`}
                          >
                            {vMeta.label}
                          </span>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full border ${
                              item.verifiedBy
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            }`}
                          >
                            {item.verifiedBy ? `Validado por @${item.verifiedBy}` : 'Pendiente'}
                          </span>
                        </div>

                        <div className="font-medium text-sm text-slate-100">{item.title}</div>
                        {item.summary && (
                          <p className="text-xs text-slate-400 line-clamp-2">{item.summary}</p>
                        )}

                        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                          <span>Enviado por: {item.authorUsername ? `@${item.authorUsername}` : 'usuario'}</span>
                          <span>{new Date(item.createdAt).toLocaleString()}</span>
                        </div>

                        {item.adminNote && (
                          <div className="text-xs text-slate-300 bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1.5">
                            Nota: {item.adminNote}
                          </div>
                        )}
                      </div>
                    );
                  })}

                {filteredAdminRecords.length === 0 && (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    No hay análisis en este filtro de revisión.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'analyze' && (
            <form
              onSubmit={handleAnalyzeSubmit}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-base">Nuevo análisis de información</h2>
                <div className="inline-flex rounded-lg bg-slate-800 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setInputType('url')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md cursor-pointer ${
                      inputType === 'url'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    Enlace (URL)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputType('text')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md cursor-pointer ${
                      inputType === 'text'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Texto / Afirmación
                  </button>
                </div>
              </div>

              {inputType === 'url' ? (
                <input
                  type="url"
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="https://ejemplo.com/articulo-o-noticia"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
                />
              ) : (
                <textarea
                  required
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Pega aquí el texto, titular o afirmación que deseas contrastar..."
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm focus:outline-none focus:border-indigo-500"
                />
              )}

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Evaluación orientativa de apoyo o inconsistencias; no reemplaza revisión experta.
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium text-white cursor-pointer"
                >
                  {submitting ? 'Analizando...' : 'Verificar ahora'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'settings' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
              <h2 className="font-semibold text-base">Conexión VPN y sincronización</h2>
              <div className="space-y-2 text-sm">
                <div className="text-slate-400 text-xs">Endpoint configurado</div>
                <div className="font-mono text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-indigo-300">
                  {apiUrlDisplay}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={refreshConnectionAndSync}
                  disabled={syncing}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  Probar conexión y sincronizar cola
                </button>
              </div>
            </div>
          )}

          {/* Barra de búsqueda y filtros para Historial / Favoritos / Papelera / Recientes */}
          {activeTab !== 'settings' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por título, resumen o fuente..."
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <select
                  value={verdictFilter}
                  onChange={(e) => setVerdictFilter(e.target.value as 'all' | VerdictType)}
                  className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">Todas las clasificaciones</option>
                  <option value="supported">Información respaldada</option>
                  <option value="doubtful">Información dudosa</option>
                  <option value="misleading">Posiblemente engañosa</option>
                </select>
              </div>

              {visibleRecords.length === 0 ? (
                <div className="text-center py-8 text-sm text-slate-400">
                  No hay registros en esta vista todavía.
                </div>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {visibleRecords.map((item) => {
                    const meta = VERDICT_META[item.verdict];
                    const isSelected = item.id === selectedId;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                        className={`py-3 px-2.5 rounded-lg flex items-start justify-between gap-3 cursor-pointer transition ${
                          isSelected ? 'bg-slate-800/70' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${meta.badgeClass}`}
                            >
                              <VerdictIcon verdict={item.verdict} />
                              {meta.label}
                            </span>
                            {item.pendingSync && (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                                <Clock className="w-3 h-3" />
                                Pendiente de sincronizar
                              </span>
                            )}
                          </div>
                          <p className="font-medium text-sm truncate">{item.title}</p>
                          <p className="text-xs text-slate-400 line-clamp-2">{item.summary}</p>
                        </div>

                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!item.deletedAt ? (
                            <>
                              <button
                                onClick={() => toggleFavorite(item.id)}
                                title="Favorito"
                                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300 cursor-pointer"
                              >
                                <Star
                                  className={`w-4 h-4 ${
                                    item.isFavorite ? 'fill-amber-400 text-amber-400' : ''
                                  }`}
                                />
                              </button>
                              <button
                                onClick={() => moveToTrash(item.id)}
                                title="Mover a papelera"
                                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-rose-300 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => restoreFromTrash(item.id)}
                                title="Restaurar"
                                className="p-1.5 rounded-lg hover:bg-slate-700 text-emerald-300 cursor-pointer"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => deleteForever(item.id)}
                                title="Eliminar definitivamente"
                                className="p-1.5 rounded-lg hover:bg-slate-700 text-rose-400 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Columna derecha: Detalle de análisis, afirmaciones y fuentes */}
        <aside className="lg:col-span-5">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4 sticky top-4">
            <h2 className="font-semibold text-base">Detalle del análisis</h2>

            {!selectedRecord ? (
              <p className="text-sm text-slate-400 py-6">
                Selecciona o envía un análisis para ver el resumen, desglose de afirmaciones y fuentes.
              </p>
            ) : (
              <div className="space-y-4">
                <div
                  className={`rounded-lg border p-3 bg-slate-950/70 space-y-1.5 ${
                    VERDICT_META[selectedRecord.verdict].borderClass
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <VerdictIcon verdict={selectedRecord.verdict} />
                    <span className="text-xs font-semibold">
                      {VERDICT_META[selectedRecord.verdict].label}
                    </span>
                  </div>
                  <h3 className="font-medium text-sm leading-snug">{selectedRecord.title}</h3>
                  <p className="text-xs text-slate-300 leading-relaxed">{selectedRecord.summary}</p>
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Afirmaciones evaluadas ({selectedRecord.claims.length})
                  </h4>
                  {selectedRecord.claims.length === 0 ? (
                    <p className="text-xs text-slate-500">Sin afirmaciones desglosadas.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedRecord.claims.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 space-y-1 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium text-slate-200">{c.statement}</span>
                            <span className="shrink-0 text-[11px] text-slate-400">
                              [{c.sourceRefs.join(', ')}]
                            </span>
                          </div>
                          <p className="text-slate-400">{c.explanation}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Fuentes consultadas ({selectedRecord.sources.length})
                  </h4>
                  {selectedRecord.sources.length === 0 ? (
                    <p className="text-xs text-slate-500">Sin fuentes registradas.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs">
                      {selectedRecord.sources.map((s) => (
                        <li
                          key={`${s.index}-${s.url}`}
                          className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-2 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <span className="text-indigo-400 font-mono mr-1.5">[{s.index}]</span>
                            <span className="text-slate-200 truncate">{s.title || s.domain}</span>
                          </div>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-300 hover:text-indigo-200 shrink-0 inline-flex items-center gap-1"
                          >
                            Abrir <ExternalLink className="w-3 h-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {selectedRecord.verifiedBy && (
                  <div className="rounded-lg bg-emerald-950/40 border border-emerald-700/40 p-3 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2 text-emerald-300 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        Validado por @{selectedRecord.verifiedBy}
                      </span>
                      {selectedRecord.verifiedAt && (
                        <span className="text-[11px] text-emerald-400/80">
                          {new Date(selectedRecord.verifiedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {selectedRecord.adminNote && (
                      <p className="text-emerald-100/80 italic">Nota: {selectedRecord.adminNote}</p>
                    )}
                  </div>
                )}

                {user?.role === 'admin' && !selectedRecord.pendingSync && (
                  <form onSubmit={handleAdminVerify} className="rounded-xl bg-slate-950/90 border border-indigo-500/30 p-3.5 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold uppercase tracking-wider text-indigo-300">Validación de admin</span>
                      <span className="text-[11px] text-slate-400">admin</span>
                    </div>
                    <select value={adminVerdict} onChange={(e) => setAdminVerdict(e.target.value as VerdictType)} className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-xs text-slate-100">
                      <option value="supported">Respaldada (supported)</option>
                      <option value="doubtful">Dudosa (doubtful)</option>
                      <option value="misleading">Engañosa (misleading)</option>
                    </select>
                    <input type="text" value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Nota de revisión (opcional)" className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2 text-xs text-slate-100" />
                    {verifyFeedback && (
                      <p className={verifyFeedback.type === 'ok' ? 'text-emerald-400 text-[11px]' : 'text-rose-400 text-[11px]'}>
                        {verifyFeedback.text}
                      </p>
                    )}
                    <button type="submit" disabled={verifyingAdmin} className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-2 text-xs font-medium text-white">
                      {verifyingAdmin ? 'Guardando...' : 'Guardar validación'}
                    </button>
                  </form>
                )}

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
                    Tipo: {selectedRecord.inputType.toUpperCase()}
                  </span>
                  <span>{new Date(selectedRecord.createdAt).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
