const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
let csrfToken: string | null = null;
let sessionRequest: Promise<AuthState> | null = null;

export interface BackendLevelRecord {
  id: string;
  name: string;
  text: string;
  authorName: string;
  ownerUserId: number | null;
  ownerUsername: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LevelScoreRecord {
  playerName: string;
  moves: number;
  durationMs: number;
  createdAt: number;
}

export interface ScorePageRecord {
  levelId: string;
  scope: 'all' | 'personal';
  search: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  scores: LevelScoreRecord[];
}

export interface AuthUserRecord {
  id: number;
  username: string;
  playerName: string;
  isAdmin: boolean;
}

export interface AuthState {
  authenticated: boolean;
  user: AuthUserRecord | null;
}

export interface AccountProgressRecord {
  userId: number;
  selectedLevelId: string;
  updatedAt: number;
}

interface ErrorPayload {
  error?: string;
}

interface SessionPayload {
  csrfToken?: string;
  authenticated?: boolean;
  user?: AuthUserRecord | null;
}

function parseAuthState(payload: SessionPayload | AuthState): AuthState {
  const user = payload.user ?? null;
  const authenticated = Boolean(payload.authenticated && user);
  return {
    authenticated,
    user: authenticated ? user : null,
  };
}

function updateCsrfTokenFromPayload(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const csrf = (payload as { csrfToken?: unknown }).csrfToken;
  if (typeof csrf === 'string' && csrf.length > 0) {
    csrfToken = csrf;
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

async function refreshApiSession(): Promise<AuthState> {
  if (!sessionRequest) {
    sessionRequest = (async () => {
      const response = await fetch(`${API_BASE}/auth/session`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{}',
      });

      if (!response.ok) {
        throw new Error(`Unable to establish API session (HTTP ${response.status})`);
      }

      const payload = await parseJsonResponse<SessionPayload>(response);
      if (!payload.csrfToken) {
        throw new Error('Unable to establish API session (missing CSRF token).');
      }

      csrfToken = payload.csrfToken;
      return parseAuthState(payload);
    })().finally(() => {
      sessionRequest = null;
    });
  }

  return sessionRequest;
}

async function ensureApiSession(): Promise<void> {
  if (csrfToken) {
    return;
  }

  await refreshApiSession();
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const isMutation = method !== 'GET' && method !== 'HEAD' && path !== '/auth/session';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (isMutation) {
      await ensureApiSession();
    }

    const headers = new Headers(init?.headers ?? {});
    if (init?.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (isMutation && csrfToken) {
      headers.set('X-Lockstep-Csrf', csrfToken);
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });

    if (isMutation && (response.status === 401 || response.status === 403) && attempt === 0) {
      csrfToken = null;
      continue;
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const error = await parseJsonResponse<ErrorPayload>(response);
        if (error?.error) {
          detail = error.error;
        }
      } catch {
        // Keep fallback detail.
      }
      throw new Error(detail);
    }

    const payload = await parseJsonResponse<T>(response);
    updateCsrfTokenFromPayload(payload);
    return payload;
  }

  throw new Error('Request failed after session retry.');
}

export async function initializeApiSession(): Promise<AuthState> {
  return refreshApiSession();
}

export async function fetchAuthState(): Promise<AuthState> {
  const payload = await requestJson<AuthState>('/auth/me');
  return parseAuthState(payload);
}

export async function registerAccount(input: {
  username: string;
  password: string;
  playerName?: string;
}): Promise<AuthState> {
  const payload = await requestJson<SessionPayload>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: input.username,
      password: input.password,
      ...(input.playerName ? { playerName: input.playerName } : {}),
    }),
  });
  return parseAuthState(payload);
}

export async function loginAccount(input: { username: string; password: string }): Promise<AuthState> {
  const payload = await requestJson<SessionPayload>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return parseAuthState(payload);
}

export async function logoutAccount(): Promise<AuthState> {
  const payload = await requestJson<SessionPayload>('/auth/logout', {
    method: 'POST',
    body: '{}',
  });
  return parseAuthState(payload);
}

export async function fetchCustomLevels(): Promise<BackendLevelRecord[]> {
  const payload = await requestJson<{ levels: BackendLevelRecord[] }>('/levels');
  return payload.levels;
}

export async function saveCustomLevel(input: {
  id: string;
  name: string;
  text: string;
}): Promise<BackendLevelRecord> {
  const payload = await requestJson<{ level: BackendLevelRecord }>('/levels', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return payload.level;
}

export async function deleteCustomLevel(input: { levelId: string }): Promise<void> {
  await requestJson<{ ok: true; levelId: string }>('/admin/delete-level', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchUserProgress(): Promise<AccountProgressRecord | null> {
  const payload = await requestJson<{ progress: AccountProgressRecord | null }>('/progress');
  return payload.progress ?? null;
}

export async function saveUserProgress(selectedLevelId: string): Promise<AccountProgressRecord> {
  const payload = await requestJson<{ progress: AccountProgressRecord }>('/progress', {
    method: 'POST',
    body: JSON.stringify({ selectedLevelId }),
  });
  return payload.progress;
}

export async function fetchTopScores(levelId: string): Promise<LevelScoreRecord[]> {
  const payload = await fetchScoresPage(levelId, {
    scope: 'all',
    search: '',
    page: 1,
    pageSize: 10,
  });
  return payload.scores;
}

export async function fetchScoresPage(
  levelId: string,
  options: {
    scope?: 'all' | 'personal';
    search?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<ScorePageRecord> {
  const params = new URLSearchParams();
  const scope = options.scope === 'personal' ? 'personal' : 'all';
  const search = (options.search ?? '').trim().slice(0, 64);
  const rawPage = typeof options.page === 'number' && Number.isInteger(options.page) ? options.page : 1;
  const page = Math.max(1, rawPage);
  const rawPageSize =
    typeof options.pageSize === 'number' && Number.isInteger(options.pageSize) ? options.pageSize : 10;
  const pageSize = Math.min(50, Math.max(1, rawPageSize));
  params.set('scope', scope);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  if (search.length > 0) {
    params.set('search', search);
  }

  return requestJson<ScorePageRecord>(`/scores/${encodeURIComponent(levelId)}?${params.toString()}`);
}

export async function submitScore(input: {
  levelId: string;
  playerName: string;
  moves: number;
  durationMs: number;
  replay: string;
}): Promise<LevelScoreRecord[]> {
  const payload = await requestJson<{ levelId: string; scores: LevelScoreRecord[] }>('/scores', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return payload.scores;
}
