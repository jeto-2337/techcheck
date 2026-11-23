import React, { useEffect, useState } from 'react';
import { Fingerprint, KeyRound, Mail, User, UserPlus, WifiOff } from 'lucide-react';
import {
  type AuthUser,
  canUseBiometricLogin,
  getBiometricUser,
  getOfflineFallbackUser,
  isNativeApp,
  loginOfflineCached,
  loginGuestOffline,
  loginWithBiometrics,
  loginWithPassword,
  registerUser,
} from '../services/auth';

interface AuthGateProps {
  onAuthenticated: (user: AuthUser) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioUser, setBioUser] = useState<AuthUser | null>(null);
  const [cachedUser, setCachedUser] = useState<AuthUser | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [error, setError] = useState<string | null>(null);

  const native = isNativeApp();

  useEffect(() => {
    let active = true;
    setBioUser(getBiometricUser());
    setCachedUser(getOfflineFallbackUser());
    canUseBiometricLogin().then((ok) => {
      if (active) setBioAvailable(ok);
    });

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await loginWithPassword(identifier, password);
        onAuthenticated(res.user);
      } else {
        const res = await registerUser(username, email, password);
        onAuthenticated(res.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometric = async () => {
    setError(null);
    setBioLoading(true);
    try {
      const res = await loginWithBiometrics();
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo validar la huella');
    } finally {
      setBioLoading(false);
    }
  };

  const handleOfflineEntry = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await loginOfflineCached();
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar sin conexión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-xl space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">TechCheck</h1>
          <p className="text-sm text-slate-400">
            {native ? 'Acceso con huella o cuenta' : 'Inicia sesión o crea tu cuenta'}
          </p>
          {!isOnline && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs mt-1">
              <WifiOff className="w-3.5 h-3.5" />
              Modo sin conexión activo
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition ${
              mode === 'login'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition ${
              mode === 'register'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            Registrarse
          </button>
        </div>

        {native && bioAvailable && mode === 'login' && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleBiometric}
              disabled={bioLoading || loading}
              className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Fingerprint className="w-5 h-5" />
              {bioLoading
                ? 'Esperando huella...'
                : `Entrar con huella${bioUser ? ` (${bioUser.username})` : ''}`}
            </button>
            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-slate-800" />
              <span className="mx-3 text-xs uppercase text-slate-500">o con contraseña</span>
              <div className="flex-grow border-t border-slate-800" />
            </div>
          </div>
        )}

        {cachedUser && mode === 'login' && (!isOnline || !native) && (
          <button
            type="button"
            onClick={handleOfflineEntry}
            disabled={loading || bioLoading}
            className="w-full py-2.5 px-4 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-medium flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <WifiOff className="w-4 h-4" />
            Entrar sin conexión como @{cachedUser.username}
          </button>
        )}

                {mode === 'login' && (
          <button
            type="button"
            onClick={async () => {
              setError(null);
              setLoading(true);
              try {
                const res = cachedUser ? await loginOfflineCached() : await loginGuestOffline();
                onAuthenticated(res.user);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'No se pudo entrar sin conexión');
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading || bioLoading}
            className="w-full py-2.5 px-4 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs font-medium flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <WifiOff className="w-4 h-4" />
            {cachedUser
              ? `Entrar sin conexión como @${cachedUser.username}`
              : 'Continuar sin conexión (Modo local)'}
          </button>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'login' ? (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Usuario o correo electrónico
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="tu_usuario o correo@ejemplo.com"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nombre de usuario
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ej. jeto"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Contraseña
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || bioLoading}
            className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm transition cursor-pointer"
          >
            {loading
              ? 'Procesando...'
              : mode === 'login'
                ? 'Entrar'
                : 'Crear cuenta'}
          </button>
        </form>
      </div>
    </div>
  );
};
