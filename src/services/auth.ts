import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';

export const API_BASE_URL = 'https://techcheck-ita.duckdns.org';

const TOKEN_KEY = 'techcheck_access_token';
const USER_KEY = 'techcheck_auth_user';
const BIO_TOKEN_KEY = 'techcheck_bio_token';
const BIO_USER_KEY = 'techcheck_bio_user';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role?: 'admin' | 'user';
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
  offline?: boolean;
}

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: AuthUser, enableBiometricInApp = false): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));

  if (enableBiometricInApp && isNativeApp()) {
    localStorage.setItem(BIO_TOKEN_KEY, token);
    localStorage.setItem(BIO_USER_KEY, JSON.stringify(user));
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function clearBiometricSession(): void {
  localStorage.removeItem(BIO_TOKEN_KEY);
  localStorage.removeItem(BIO_USER_KEY);
}

export function hasBiometricSession(): boolean {
  return Boolean(localStorage.getItem(BIO_TOKEN_KEY) && localStorage.getItem(BIO_USER_KEY));
}

export function getBiometricUser(): AuthUser | null {
  const raw = localStorage.getItem(BIO_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function getOfflineFallbackUser(): AuthUser | null {
  return getBiometricUser() ?? getStoredUser();
}

export function getAuthHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') return data.detail;
  } catch {
    // ignorar error de parseo
  }
  return fallback;
}

export async function registerUser(
  username: string,
  email: string,
  password: string
): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });

  if (!res.ok) {
    throw new Error(await parseErrorDetail(res, 'No se pudo completar el registro'));
  }

  const data = (await res.json()) as AuthResponse;
  saveSession(data.access_token, data.user, true);
  return data;
}

export async function loginWithPassword(
  identifier: string,
  password: string
): Promise<AuthResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });

    if (!res.ok) {
      throw new Error(await parseErrorDetail(res, 'Credenciales incorrectas'));
    }

    const data = (await res.json()) as AuthResponse;
    saveSession(data.access_token, data.user, true);
    return data;
  } catch (err) {
    const cachedUser = getOfflineFallbackUser();
    const cachedToken = localStorage.getItem(BIO_TOKEN_KEY) || getStoredToken() || 'offline-session';
    const normalized = identifier.trim().toLowerCase();
    const matchesCached =
      cachedUser &&
      (!normalized ||
        cachedUser.username.toLowerCase() === normalized ||
        cachedUser.email.toLowerCase() === normalized);

    if (matchesCached && cachedUser) {
      saveSession(cachedToken, cachedUser, isNativeApp());
      return {
        access_token: cachedToken,
        token_type: 'bearer',
        user: cachedUser,
        offline: true,
      };
    }

    if (err instanceof TypeError || !navigator.onLine) {
      throw new Error(
        'Sin conexión al servidor. Si ya iniciaste sesión antes en este equipo, usa el acceso sin conexión.'
      );
    }
    throw err;
  }
}

export async function loginOfflineCached(): Promise<AuthResponse> {
  const cachedUser = getOfflineFallbackUser();
  if (!cachedUser) {
    throw new Error('No hay una sesión guardada en este dispositivo para entrar sin conexión.');
  }
  const cachedToken = localStorage.getItem(BIO_TOKEN_KEY) || getStoredToken() || 'offline-session';
  saveSession(cachedToken, cachedUser, isNativeApp());
  return {
    access_token: cachedToken,
    token_type: 'bearer',
    user: cachedUser,
    offline: true,
  };
}

export async function fetchCurrentUser(token?: string): Promise<AuthUser | null> {
  const activeToken = token ?? getStoredToken();
  if (!activeToken) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${activeToken}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return (data?.user as AuthUser) ?? null;
  } catch {
    return getStoredUser();
  }
}

export async function canUseBiometricLogin(): Promise<boolean> {
  if (!isNativeApp()) return false;
  if (!hasBiometricSession()) return false;

  try {
    const info = await BiometricAuth.checkBiometry();
    return Boolean(info.isAvailable);
  } catch {
    return false;
  }
}

export async function loginWithBiometrics(): Promise<AuthResponse> {
  if (!isNativeApp()) {
    throw new Error('La autenticación con huella solo está disponible en la app');
  }

  const bioToken = localStorage.getItem(BIO_TOKEN_KEY);
  const bioUser = getBiometricUser();

  if (!bioToken || !bioUser) {
    throw new Error('Primero inicia sesión con usuario y contraseña para activar la huella');
  }

  const info = await BiometricAuth.checkBiometry();
  if (!info.isAvailable) {
    throw new Error('El sensor biométrico no está disponible en este dispositivo');
  }

  await BiometricAuth.authenticate({
    reason: 'Verifica tu huella para iniciar sesión en TechCheck',
    cancelTitle: 'Cancelar',
    allowDeviceCredential: true,
  });

  if (!navigator.onLine) {
    saveSession(bioToken, bioUser, true);
    return {
      access_token: bioToken,
      token_type: 'bearer',
      user: bioUser,
      offline: true,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${bioToken}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      clearBiometricSession();
      throw new Error('La sesión guardada expiró. Inicia sesión con usuario y contraseña');
    }

    if (!res.ok) {
      saveSession(bioToken, bioUser, true);
      return {
        access_token: bioToken,
        token_type: 'bearer',
        user: bioUser,
        offline: true,
      };
    }

    const data = await res.json();
    const verifiedUser = (data?.user as AuthUser) ?? bioUser;
    saveSession(bioToken, verifiedUser, true);
    return {
      access_token: bioToken,
      token_type: 'bearer',
      user: verifiedUser,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('expiró')) {
      throw err;
    }
    saveSession(bioToken, bioUser, true);
    return {
      access_token: bioToken,
      token_type: 'bearer',
      user: bioUser,
      offline: true,
    };
  }
}
