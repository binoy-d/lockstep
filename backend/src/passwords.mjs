import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_N = 1 << 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function encode(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url');
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return `scrypt$${encode(salt)}$${encode(hash)}`;
}

export function verifyPassword(password, encodedHash) {
  if (typeof encodedHash !== 'string' || encodedHash.length === 0) {
    return false;
  }

  const [algorithm, saltBase64, hashBase64] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !saltBase64 || !hashBase64) {
    return false;
  }

  try {
    const salt = decode(saltBase64);
    const stored = decode(hashBase64);
    const candidate = scryptSync(password, salt, stored.length, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });

    if (candidate.length !== stored.length) {
      return false;
    }

    return timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}
