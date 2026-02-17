const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
let csrfToken: string | null = null;
let sessionRequest: Promise<void> | null = null;

export interface BackendLevelRecord {
  id: string;
  name: string;
  text: string;
  authorName: string;
  createdAt: number;
  updatedAt: number;
}

export interface LevelScoreRecord {
  playerName: string;
  moves: number;
  durationMs: number;
  createdAt: number;
}

interface ErrorPayload {
  error?: string;
}

async function ensureApiSession(): Promise<void> {
  if (csrfToken) {
    return;
  }

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

      const payload = (await response.json()) as { csrfToken?: string };
      if (!payload.csrfToken) {
        throw new Error('Unable to establish API session (missing CSRF token).');
      }

      csrfToken = payload.csrfToken;
    })().finally(() => {
      sessionRequest = null;
    });
  }

  await sessionRequest;
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
        const error = (await response.json()) as ErrorPayload;
        if (error?.error) {
          detail = error.error;
        }
      } catch {
        // keep fallback detail
      }
      throw new Error(detail);
    }

    return (await response.json()) as T;
  }

  throw new Error('Request failed after session retry.');
}

export async function fetchCustomLevels(): Promise<BackendLevelRecord[]> {
  const payload = await requestJson<{ levels: BackendLevelRecord[] }>('/levels');
  return payload.levels;
}

export async function saveCustomLevel(input: {
  id: string;
  name: string;
  text: string;
  authorName: string;
}): Promise<BackendLevelRecord> {
  const payload = await requestJson<{ level: BackendLevelRecord }>('/levels', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return payload.level;
}

export async function deleteCustomLevel(input: {
  levelId: string;
  password: string;
}): Promise<void> {
  await requestJson<{ ok: true; levelId: string }>('/admin/delete-level', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchTopScores(levelId: string): Promise<LevelScoreRecord[]> {
  const payload = await requestJson<{ levelId: string; scores: LevelScoreRecord[] }>(
    `/scores/${encodeURIComponent(levelId)}`,
  );
  return payload.scores;
}

export async function submitScore(input: {
  levelId: string;
  playerName: string;
  moves: number;
  durationMs: number;
}): Promise<LevelScoreRecord[]> {
  const payload = await requestJson<{ levelId: string; scores: LevelScoreRecord[] }>('/scores', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return payload.scores;
}
