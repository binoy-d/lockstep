import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchScoresPage, fetchTopScores } from '../../src/runtime/backendApi';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

describe('backend score API helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Verifies pagination, search, and personal-scope query parameters are serialized correctly.
   */
  it('builds paginated score requests with search and scope filters', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        levelId: 'map0',
        scope: 'personal',
        search: 'ava',
        page: 2,
        pageSize: 25,
        total: 37,
        totalPages: 2,
        scores: [],
      }),
    );

    const page = await fetchScoresPage('map0', {
      scope: 'personal',
      search: 'ava',
      page: 2,
      pageSize: 25,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/scores/map0?scope=personal&page=2&pageSize=25&search=ava',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
    expect(page).toMatchObject({
      levelId: 'map0',
      scope: 'personal',
      page: 2,
      pageSize: 25,
      total: 37,
      totalPages: 2,
    });
  });

  /**
   * Ensures default top-score loading remains a simple first-page all-players query.
   */
  it('fetches top scores using default first-page parameters', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        levelId: 'map2',
        scope: 'all',
        search: '',
        page: 1,
        pageSize: 10,
        total: 2,
        totalPages: 1,
        scores: [
          {
            playerName: 'Ava',
            moves: 4,
            durationMs: 900,
            createdAt: 1,
          },
          {
            playerName: 'Blair',
            moves: 5,
            durationMs: 1100,
            createdAt: 2,
          },
        ],
      }),
    );

    const scores = await fetchTopScores('map2');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/scores/map2?scope=all&page=1&pageSize=10',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
    expect(scores).toHaveLength(2);
    expect(scores[0].playerName).toBe('Ava');
  });

  /**
   * Confirms client-side query normalization clamps page/pageSize and skips empty search terms.
   */
  it('normalizes pagination and omits blank search values', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        levelId: 'map9',
        scope: 'all',
        search: '',
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 0,
        scores: [],
      }),
    );

    await fetchScoresPage('map9', {
      scope: 'all',
      search: '   ',
      page: 0,
      pageSize: 999,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/scores/map9?scope=all&page=1&pageSize=50',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });
});
