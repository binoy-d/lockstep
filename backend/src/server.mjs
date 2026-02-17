import { createServer } from 'node:http';
import { URL } from 'node:url';
import { API_SESSION_SECRET, DEFAULT_PORT, DB_PATH, PUBLIC_ORIGIN } from './config.mjs';
import { createDatabase } from './db.mjs';
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

function notFound(req, res) {
  sendJson(req, res, 404, { error: 'Not found' });
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
