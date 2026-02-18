import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const NODE_ENV = (process.env.NODE_ENV ?? 'development').toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';

const sessionSecret = process.env.API_SESSION_SECRET?.trim() ?? '';
if (IS_PRODUCTION && sessionSecret.length < 32) {
  throw new Error('API_SESSION_SECRET must be configured in production and at least 32 characters.');
}

export const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? '8787', 10);
export const DB_PATH = process.env.DB_PATH ?? resolve(currentDir, '..', 'data', 'puzzle.sqlite');
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME?.trim() || 'admin';
export const ADMIN_PLAYER_NAME = process.env.ADMIN_PLAYER_NAME?.trim() || ADMIN_USERNAME;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() ?? '';
export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'https://lockstep.binoy.co';
export const API_SESSION_SECRET = sessionSecret || randomBytes(32).toString('hex');
