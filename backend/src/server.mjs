import { createServer } from 'node:http';
import { URL } from 'node:url';
import { ADMIN_PASSWORD, API_SESSION_SECRET, DEFAULT_PORT, DB_PATH, PUBLIC_ORIGIN } from './config.mjs';
import { createDatabase } from './db.mjs';
import { issueSession, parseCookies, verifySessionToken } from './security.mjs';
import {
  validateDeleteLevelPayload,
  validateLevelPayload,
  validateLevelId,
  validateScorePayload,
} from './validation.mjs';

const db = createDatabase(DB_PATH);
const SESSION_COOKIE = '__Host-lockstep_session';
const SCORE_RATE_LIMIT_WINDOW_MS = 60_000;
const SCORE_RATE_LIMIT_MAX = 45;
const scoreRateBuckets = new Map();
const DEV_ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

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

function requireAuthenticatedWrite(req, res) {
  if (!isTrustedOrigin(req)) {
    sendJson(req, res, 403, { error: 'Request origin is not allowed.' });
    return null;
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies.get(SESSION_COOKIE);
  const session = verifySessionToken(sessionToken, API_SESSION_SECRET);
  if (!session) {
    sendJson(req, res, 401, { error: 'Missing or expired API session.' });
    return null;
  }

  const csrfHeader = req.headers['x-lockstep-csrf'];
  if (typeof csrfHeader !== 'string' || csrfHeader !== session.csrfToken) {
    sendJson(req, res, 403, { error: 'Invalid CSRF token.' });
    return null;
  }

  return session;
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

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
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

      const session = issueSession(API_SESSION_SECRET);
      const maxAgeSeconds = Math.max(1, Math.floor((session.expiresAtMs - Date.now()) / 1000));
      sendJson(
        req,
        res,
        200,
        {
          csrfToken: session.csrfToken,
          expiresAtMs: session.expiresAtMs,
        },
        {
          'Cache-Control': 'no-store',
          'Set-Cookie': `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`,
        },
      );
      return;
    }

    if (req.method === 'GET' && pathname === '/api/levels') {
      sendJson(req, res, 200, { levels: db.listLevels() });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/levels') {
      if (!requireAuthenticatedWrite(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateLevelPayload(body);
      const saved = db.upsertLevel(payload);
      sendJson(req, res, 200, { level: saved });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/admin/delete-level') {
      if (!requireAuthenticatedWrite(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateDeleteLevelPayload(body);

      if (payload.password !== ADMIN_PASSWORD) {
        sendJson(req, res, 403, { error: 'Invalid admin password.' });
        return;
      }

      const deleted = db.deleteLevel(payload.levelId);
      if (!deleted) {
        sendJson(req, res, 404, { error: `Level ${payload.levelId} not found.` });
        return;
      }

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
      db.insertScore(payload);
      const scores = db.getTopScores(payload.levelId, 10);
      sendJson(req, res, 201, { levelId: payload.levelId, scores });
      return;
    }

    notFound(req, res);
  } catch (error) {
    sendJson(req, res, 400, {
      error: error instanceof Error ? error.message : 'Invalid request',
    });
  }
});

server.listen(DEFAULT_PORT, () => {
  console.log(`Backend listening on http://localhost:${DEFAULT_PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});
