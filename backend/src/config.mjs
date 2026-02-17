import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? '8787', 10);
export const DB_PATH = process.env.DB_PATH ?? resolve(currentDir, '..', 'data', 'puzzle.sqlite');
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'dick';
export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'https://lockstep.binoy.co';
export const API_SESSION_SECRET =
  process.env.API_SESSION_SECRET ?? 'replace-this-with-a-long-random-secret-before-production';
