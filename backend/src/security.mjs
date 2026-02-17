import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function toBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(payloadBase64, secret) {
  return createHmac('sha256', secret).update(payloadBase64).digest('base64url');
}

export function parseCookies(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
    return new Map();
  }

  const entries = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf('=');
      if (separator === -1) {
        return null;
      }

      return [entry.slice(0, separator), entry.slice(separator + 1)];
    })
    .filter((entry) => entry !== null);

  return new Map(entries);
}

export function issueSession(secret, options = {}) {
  const now = Date.now();
  const userId = Number.isInteger(options.userId) && options.userId > 0 ? options.userId : null;
  const payload = {
    sid: randomBytes(18).toString('base64url'),
    csrf: randomBytes(18).toString('base64url'),
    uid: userId,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };

  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadBase64, secret);
  return {
    token: `${payloadBase64}.${signature}`,
    csrfToken: payload.csrf,
    sessionId: payload.sid,
    userId: payload.uid,
    expiresAtMs: payload.exp,
  };
}

export function verifySessionToken(token, secret) {
  if (typeof token !== 'string' || token.length < 16) {
    return null;
  }

  const separator = token.indexOf('.');
  if (separator === -1) {
    return null;
  }

  const payloadBase64 = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!payloadBase64 || !signature) {
    return null;
  }

  const expected = signPayload(payloadBase64, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(payloadBase64));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const normalizedUserId = parsed.uid === undefined ? null : parsed.uid;

    if (
      typeof parsed.sid !== 'string' ||
      typeof parsed.csrf !== 'string' ||
      (normalizedUserId !== null && (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0)) ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }

    if (Date.now() >= parsed.exp) {
      return null;
    }

    return {
      sessionId: parsed.sid,
      csrfToken: parsed.csrf,
      userId: normalizedUserId,
      issuedAtMs: parsed.iat,
      expiresAtMs: parsed.exp,
    };
  } catch {
    return null;
  }
}
