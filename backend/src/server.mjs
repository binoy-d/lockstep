import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { API_SESSION_SECRET, DEFAULT_PORT, DB_PATH, PUBLIC_ORIGIN } from './config.mjs';
import { getBuiltInLevel } from './builtInLevels.mjs';
import { createDatabase } from './db.mjs';
import { renderLevelPreviewPng } from './levelPreviewImage.mjs';
import { hashPassword, verifyPassword } from './passwords.mjs';
import { issueSession, parseCookies, verifySessionToken } from './security.mjs';
import {
  validateDeleteLevelPayload,
  validateLevelPayload,
  validateLevelId,
  validateLoginPayload,
  validateProgressPayload,
  validateRegisterPayload,
  validateScorePayload,
  validateUsername,
} from './validation.mjs';

const db = createDatabase(DB_PATH);
const SESSION_COOKIE = '__Host-lockstep_session';
const SCORE_RATE_LIMIT_WINDOW_MS = 60_000;
const SCORE_RATE_LIMIT_MAX = 45;
const DEV_ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
const scoreRateBuckets = new Map();
const previewImageCache = new Map();

function asPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    playerName: user.playerName,
    isAdmin: Boolean(user.isAdmin),
  };
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.length > 0) {
    return cfIp;
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.socket.remoteAddress ?? 'unknown';
}

function isTrustedOrigin(req) {
  return req.headers.origin === PUBLIC_ORIGIN || DEV_ALLOWED_ORIGINS.has(req.headers.origin ?? '');
}

function buildResponseHeaders(req, headers = {}) {
  const responseHeaders = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Lockstep-Csrf',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    ...headers,
  };

  if (isTrustedOrigin(req)) {
    responseHeaders['Access-Control-Allow-Origin'] = req.headers.origin;
  }

  return responseHeaders;
}

function isRateLimited(key) {
  const now = Date.now();
  const existing = scoreRateBuckets.get(key) ?? [];
  const fresh = existing.filter((timestamp) => now - timestamp <= SCORE_RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= SCORE_RATE_LIMIT_MAX) {
    scoreRateBuckets.set(key, fresh);
    return true;
  }

  fresh.push(now);
  scoreRateBuckets.set(key, fresh);
  return false;
}

function sendJson(req, res, statusCode, payload, headers = {}) {
  res.writeHead(
    statusCode,
    buildResponseHeaders(req, {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    }),
  );
  res.end(JSON.stringify(payload));
}

function sendNoContent(req, res, headers = {}) {
  res.writeHead(204, buildResponseHeaders(req, headers));
  res.end();
}

function sendHtml(req, res, statusCode, html, headers = {}) {
  res.writeHead(
    statusCode,
    buildResponseHeaders(req, {
      'Content-Type': 'text/html; charset=utf-8',
      ...headers,
    }),
  );
  res.end(html);
}

function sendBinary(req, res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, buildResponseHeaders(req, headers));
  res.end(body);
}

function notFound(req, res) {
  sendJson(req, res, 404, { error: 'Not found' });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeLevelSlug(input) {
  if (typeof input !== 'string') {
    return 'unknown-level';
  }

  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 64);
  return normalized.length >= 3 ? normalized : 'unknown-level';
}

function tryParseLevelId(input) {
  try {
    return validateLevelId(input);
  } catch {
    return null;
  }
}

function decodePathSegment(input) {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function resolveLevelForPreview(levelId) {
  const builtInLevel = getBuiltInLevel(levelId);
  if (builtInLevel) {
    return builtInLevel;
  }

  const customLevel = db.getLevel(levelId);
  if (!customLevel) {
    return null;
  }

  return {
    id: customLevel.id,
    name: customLevel.name,
    text: customLevel.text,
    updatedAt: customLevel.updatedAt ?? 0,
    isBuiltIn: false,
  };
}

function previewCacheKey(levelRecord) {
  const updatedAt = Number.isFinite(levelRecord?.updatedAt) ? levelRecord.updatedAt : 0;
  return `${levelRecord?.id ?? 'unknown'}:${updatedAt}`;
}

function invalidatePreviewCache(levelId) {
  const prefix = `${levelId}:`;
  for (const key of previewImageCache.keys()) {
    if (key.startsWith(prefix)) {
      previewImageCache.delete(key);
    }
  }
}

function getLevelPreviewImage(levelRecord) {
  const key = previewCacheKey(levelRecord);
  const existing = previewImageCache.get(key);
  if (existing) {
    return existing;
  }

  const body = renderLevelPreviewPng(levelRecord);
  const etag = `"${createHash('sha1').update(key).update(body).digest('hex').slice(0, 24)}"`;
  const entry = { body, etag };
  previewImageCache.set(key, entry);
  return entry;
}

function buildShareHtml(levelId, levelRecord) {
  const safeLevelId = escapeHtml(levelId);
  const levelNameRaw = levelRecord?.name ?? 'Unknown Level';
  const titleRaw = levelRecord ? `LOCKSTEP • ${levelNameRaw}` : `LOCKSTEP • ${levelId}`;
  const descriptionRaw = levelRecord
    ? `Play "${levelNameRaw}" in LOCKSTEP. Solve fast and climb the leaderboard.`
    : `This LOCKSTEP level link is unavailable. Open Level Select to pick another map.`;
  const title = escapeHtml(titleRaw);
  const description = escapeHtml(descriptionRaw);
  const shareUrl = `${PUBLIC_ORIGIN}/l/${encodeURIComponent(levelId)}`;
  const imageUrl = `${PUBLIC_ORIGIN}/og/${encodeURIComponent(levelId)}.png`;
  const redirectPath = `/?level=${encodeURIComponent(levelId)}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${shareUrl}" />
    <meta property="og:site_name" content="LOCKSTEP" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <meta http-equiv="refresh" content="0; url=${redirectPath}" />
    <script>
      window.location.replace(${JSON.stringify(redirectPath)});
    </script>
  </head>
  <body>
    <p>Opening level <strong>${safeLevelId}</strong> in LOCKSTEP…</p>
    <p><a href="${redirectPath}">Continue</a></p>
  </body>
</html>`;
}

function readSessionFromCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies.get(SESSION_COOKIE), API_SESSION_SECRET);
}

function issueSessionResponse(req, res, userId, statusCode = 200, payload = {}) {
  const requestedUserId = Number.isInteger(userId) && userId > 0 ? userId : null;
  const user = requestedUserId ? db.getUserById(requestedUserId) : null;
  const session = issueSession(API_SESSION_SECRET, { userId: user ? requestedUserId : null });
  const maxAgeSeconds = Math.max(1, Math.floor((session.expiresAtMs - Date.now()) / 1000));
  sendJson(
    req,
    res,
    statusCode,
    {
      csrfToken: session.csrfToken,
      expiresAtMs: session.expiresAtMs,
      authenticated: Boolean(user),
      user: user ? asPublicUser(user) : null,
      ...payload,
    },
    {
      'Cache-Control': 'no-store',
      'Set-Cookie': `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`,
    },
  );
}

function requireAuthenticatedRead(req, res) {
  if (!isTrustedOrigin(req)) {
    sendJson(req, res, 403, { error: 'Request origin is not allowed.' });
    return null;
  }

  const session = readSessionFromCookie(req);
  if (!session) {
    sendJson(req, res, 401, { error: 'Missing or expired API session.' });
    return null;
  }

  return session;
}

function requireAuthenticatedWrite(req, res) {
  const session = requireAuthenticatedRead(req, res);
  if (!session) {
    return null;
  }

  const csrfHeader = req.headers['x-lockstep-csrf'];
  if (typeof csrfHeader !== 'string' || csrfHeader !== session.csrfToken) {
    sendJson(req, res, 403, { error: 'Invalid CSRF token.' });
    return null;
  }

  return session;
}

function requireAccount(req, res, options = {}) {
  const requireCsrf = options.requireCsrf !== false;
  const session = requireCsrf ? requireAuthenticatedWrite(req, res) : requireAuthenticatedRead(req, res);
  if (!session) {
    return null;
  }

  if (!session.userId) {
    sendJson(req, res, 401, { error: 'Sign in required.' });
    return null;
  }

  const user = db.getUserById(session.userId);
  if (!user) {
    sendJson(req, res, 401, { error: 'Session user no longer exists.' });
    return null;
  }

  return {
    session,
    user,
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    notFound(req, res);
    return;
  }

  if (req.method === 'OPTIONS') {
    sendNoContent(req, res);
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  try {
    if (req.method === 'GET') {
      const ogMatch = pathname.match(/^\/og\/([^/]+)\.png$/);
      if (ogMatch) {
        const rawLevelSegment = decodePathSegment(ogMatch[1]);
        const levelSlug = normalizeLevelSlug(rawLevelSegment);
        const normalizedLevelId = tryParseLevelId(levelSlug);
        const levelRecord = normalizedLevelId ? resolveLevelForPreview(normalizedLevelId) : null;
        const previewLevel = levelRecord ?? {
          id: levelSlug,
          name: `Level ${levelSlug}`,
          text: '',
          updatedAt: -1,
          isBuiltIn: false,
        };
        const preview = getLevelPreviewImage(previewLevel);

        if (req.headers['if-none-match'] === preview.etag) {
          sendBinary(req, res, 304, Buffer.alloc(0), {
            ETag: preview.etag,
            'Cache-Control': 'public, max-age=300',
          });
          return;
        }

        sendBinary(req, res, 200, preview.body, {
          'Content-Type': 'image/png',
          ETag: preview.etag,
          'Cache-Control': 'public, max-age=300',
        });
        return;
      }

      const shareMatch = pathname.match(/^\/(?:l|share)\/([^/]+)\/?$/);
      if (shareMatch) {
        const rawLevelSegment = decodePathSegment(shareMatch[1]);
        const levelSlug = normalizeLevelSlug(rawLevelSegment);
        const normalizedLevelId = tryParseLevelId(levelSlug);
        const levelRecord = normalizedLevelId ? resolveLevelForPreview(normalizedLevelId) : null;
        const html = buildShareHtml(levelSlug, levelRecord);
        sendHtml(req, res, 200, html, {
          'Cache-Control': 'no-cache',
        });
        return;
      }
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(req, res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/session') {
      if (!isTrustedOrigin(req)) {
        sendJson(req, res, 403, { error: 'Request origin is not allowed.' });
        return;
      }

      const existing = readSessionFromCookie(req);
      issueSessionResponse(req, res, existing?.userId ?? null);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/auth/me') {
      if (!isTrustedOrigin(req)) {
        sendJson(req, res, 403, { error: 'Request origin is not allowed.' });
        return;
      }

      const session = readSessionFromCookie(req);
      if (!session?.userId) {
        sendJson(req, res, 200, { authenticated: false, user: null });
        return;
      }

      const user = db.getUserById(session.userId);
      if (!user) {
        sendJson(req, res, 200, { authenticated: false, user: null });
        return;
      }

      sendJson(req, res, 200, { authenticated: true, user: asPublicUser(user) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/register') {
      if (!requireAuthenticatedWrite(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateRegisterPayload(body);
      const passwordHash = hashPassword(payload.password);

      let user;
      try {
        user = db.createUser({
          username: payload.username,
          passwordHash,
          playerName: payload.playerName,
          isAdmin: false,
        });
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed: users\.username/i.test(error.message)) {
          sendJson(req, res, 409, { error: 'Username is already taken.' });
          return;
        }

        throw error;
      }

      issueSessionResponse(req, res, user.id, 201);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      if (!requireAuthenticatedWrite(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateLoginPayload(body);
      const user = db.getUserByUsername(payload.username);
      if (!user || !verifyPassword(payload.password, user.passwordHash)) {
        sendJson(req, res, 401, { error: 'Invalid username or password.' });
        return;
      }

      issueSessionResponse(req, res, user.id);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      if (!requireAuthenticatedWrite(req, res)) {
        return;
      }

      issueSessionResponse(req, res, null);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/progress') {
      const account = requireAccount(req, res, { requireCsrf: false });
      if (!account) {
        return;
      }

      const progress = db.getUserProgress(account.user.id);
      sendJson(req, res, 200, { progress });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/progress') {
      const account = requireAccount(req, res);
      if (!account) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateProgressPayload(body);
      const progress = db.saveUserProgress(account.user.id, payload.selectedLevelId);
      sendJson(req, res, 200, { progress });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/levels') {
      sendJson(req, res, 200, { levels: db.listLevels() });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/levels') {
      const account = requireAccount(req, res);
      if (!account) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateLevelPayload(body);
      const existing = db.getLevel(payload.id);
      const userId = account.user.id;
      const isAdmin = Boolean(account.user.isAdmin);

      if (existing) {
        if (existing.ownerUserId === null && !isAdmin) {
          sendJson(req, res, 403, { error: 'Only admins can claim legacy unowned levels.' });
          return;
        }

        if (existing.ownerUserId !== null && existing.ownerUserId !== userId && !isAdmin) {
          sendJson(req, res, 403, { error: 'Only the level owner or an admin can edit this level.' });
          return;
        }
      }

      if (!db.hasUserPublishProof(payload.id, userId)) {
        sendJson(req, res, 403, {
          error: 'Beat this level in Test + Play while signed in before publishing.',
        });
        return;
      }

      const ownerUserId = existing?.ownerUserId ?? userId;
      const saved = db.upsertLevel({
        ...payload,
        authorName: account.user.playerName,
        ownerUserId,
      });
      invalidatePreviewCache(saved.id);
      sendJson(req, res, 200, { level: saved });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/admin/delete-level') {
      const account = requireAccount(req, res);
      if (!account) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateDeleteLevelPayload(body);
      const existing = db.getLevel(payload.levelId);
      if (!existing) {
        sendJson(req, res, 404, { error: `Level ${payload.levelId} not found.` });
        return;
      }

      const isAdmin = Boolean(account.user.isAdmin);
      if (!isAdmin && existing.ownerUserId !== account.user.id) {
        sendJson(req, res, 403, { error: 'Only the level owner or an admin can delete this level.' });
        return;
      }

      db.deleteLevel(payload.levelId);
      invalidatePreviewCache(payload.levelId);
      sendJson(req, res, 200, { ok: true, levelId: payload.levelId });
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/scores/')) {
      const levelId = validateLevelId(pathname.slice('/api/scores/'.length));
      const scores = db.getTopScores(levelId, 10);
      sendJson(req, res, 200, { levelId, scores });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/scores') {
      const session = requireAuthenticatedWrite(req, res);
      if (!session) {
        return;
      }

      const rateLimitKey = `${session.sessionId}:${getClientIp(req)}`;
      if (isRateLimited(rateLimitKey)) {
        sendJson(req, res, 429, { error: 'Too many score submissions. Please slow down.' });
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateScorePayload(body);
      if (session.userId) {
        const user = db.getUserById(session.userId);
        if (!user) {
          sendJson(req, res, 401, { error: 'Session user no longer exists.' });
          return;
        }

        payload.playerName = user.playerName;
      }

      db.insertScore({
        ...payload,
        userId: session.userId ?? null,
      });
      const scores = db.getTopScores(payload.levelId, 10);
      sendJson(req, res, 201, { levelId: payload.levelId, scores });
      return;
    }

    notFound(req, res);
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) {
      sendJson(req, res, 500, { error: 'Database schema error.' });
      return;
    }

    sendJson(req, res, 400, {
      error: error instanceof Error ? error.message : 'Invalid request',
    });
  }
});

function ensureAdminAccount(username, password, playerName = username) {
  const normalizedUsername = validateUsername(username);
  const existing = db.getUserByUsername(normalizedUsername);
  if (!existing) {
    const created = db.createUser({
      username: normalizedUsername,
      passwordHash: hashPassword(password),
      playerName,
      isAdmin: true,
    });
    db.assignUnownedLevelsToUser(created.id);
    return;
  }

  if (!existing.isAdmin) {
    db.setUserAdmin(existing.id, true);
  }

  if (!verifyPassword(password, existing.passwordHash) || existing.playerName !== playerName) {
    db.updateUserCredentials(existing.id, hashPassword(password), playerName);
  }

  db.assignUnownedLevelsToUser(existing.id);
}

ensureAdminAccount('admin', 'yeahimthegoat', 'admin');

server.listen(DEFAULT_PORT, () => {
  console.log(`Backend listening on http://localhost:${DEFAULT_PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});
