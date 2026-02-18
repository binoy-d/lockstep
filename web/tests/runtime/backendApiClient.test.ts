import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function expectCsrfHeader(
  call: [input: RequestInfo | URL, init?: RequestInit],
  expectedToken: string,
): void {
  const headers = call[1]?.headers;
  expect(headers).toBeInstanceOf(Headers);
  expect((headers as Headers).get('X-Lockstep-Csrf')).toBe(expectedToken);
}

async function loadApiClient() {
  vi.resetModules();
  return import('../../src/runtime/backendApi');
}

describe('backend API client request flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /**
   * Ensures session initialization stores CSRF state and returns authenticated user details.
   */
  it('initializes API session with csrf token', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        csrfToken: 'csrf-initial',
        authenticated: true,
        user: {
          id: 10,
          username: 'ava',
          playerName: 'Ava',
          isAdmin: false,
        },
      }),
    );

    const api = await loadApiClient();
    const authState = await api.initializeApiSession();

    expect(authState).toMatchObject({
      authenticated: true,
      user: {
        id: 10,
        username: 'ava',
        playerName: 'Ava',
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  /**
   * Verifies mutation requests refresh the session on first 403 and retry with a new CSRF token.
   */
  it('retries score submission after refreshing csrf token on auth failure', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          csrfToken: 'csrf-one',
          authenticated: true,
          user: {
            id: 7,
            username: 'ava',
            playerName: 'Ava',
            isAdmin: false,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'stale csrf' }, 403))
      .mockResolvedValueOnce(
        jsonResponse({
          csrfToken: 'csrf-two',
          authenticated: true,
          user: {
            id: 7,
            username: 'ava',
            playerName: 'Ava',
            isAdmin: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          levelId: 'map0',
          scores: [{ playerName: 'Ava', moves: 4, durationMs: 900, createdAt: 1 }],
        }),
      );

    const api = await loadApiClient();
    const scores = await api.submitScore({
      levelId: 'map0',
      playerName: 'Ava',
      moves: 4,
      durationMs: 900,
      replay: 'rru',
    });

    expect(scores).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/session');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/scores');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/auth/session');
    expect(fetchMock.mock.calls[3][0]).toBe('/api/scores');
    expectCsrfHeader(fetchMock.mock.calls[1], 'csrf-one');
    expectCsrfHeader(fetchMock.mock.calls[3], 'csrf-two');
  });

  /**
   * Confirms delete-level API calls accept 204 empty responses without throwing parse errors.
   */
  it('accepts no-content delete responses', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          csrfToken: 'csrf-delete',
          authenticated: true,
          user: {
            id: 1,
            username: 'admin',
            playerName: 'Admin',
            isAdmin: true,
          },
        }),
      )
      .mockResolvedValueOnce(noContentResponse());

    const api = await loadApiClient();
    await expect(api.deleteCustomLevel({ levelId: 'custom-map' })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/delete-level');
  });

  /**
   * Verifies read endpoints surface backend error messages for easier debugging.
   */
  it('propagates structured backend error text on read requests', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Database unavailable.' }, 500));

    const api = await loadApiClient();
    await expect(api.fetchCustomLevels()).rejects.toThrow('Database unavailable.');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/levels',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  /**
   * Ensures progress-save calls serialize selected level id and return persisted payload fields.
   */
  it('saves and returns account progress payload', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          csrfToken: 'csrf-progress',
          authenticated: true,
          user: {
            id: 4,
            username: 'player',
            playerName: 'Player',
            isAdmin: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          progress: {
            userId: 4,
            selectedLevelId: 'map3',
            updatedAt: 123456,
          },
        }),
      );

    const api = await loadApiClient();
    const progress = await api.saveUserProgress('map3');

    expect(progress).toMatchObject({
      userId: 4,
      selectedLevelId: 'map3',
      updatedAt: 123456,
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/progress');
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ selectedLevelId: 'map3' }));
    expectCsrfHeader(fetchMock.mock.calls[1], 'csrf-progress');
  });
});
