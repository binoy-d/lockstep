import { Filter } from 'bad-words';

const LEVEL_ID_RE = /^[a-z0-9_-]{3,64}$/;
const TILE_RE = /^[# !xP1-9]$/;
const PROFANITY_FILTER = new Filter();
const LEGACY_HARD_R = String.fromCharCode(110, 105, 103, 103, 101, 114);
const FORCED_NAME_REPLACEMENTS = new Map([
  [LEGACY_HARD_R, 'Issac'],
  ['gay', 'Issac'],
]);
const LEVEL_NAME_FALLBACK = 'Custom Level';

function sanitizeName(raw, maxLength = 32) {
  if (typeof raw !== 'string') {
    return '';
  }

  return raw.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function containsBlockedLanguage(value) {
  const normalized = value.toLowerCase();
  return normalized.includes(LEGACY_HARD_R) || PROFANITY_FILTER.isProfane(normalized);
}

export function validatePlayerName(input) {
  const value = sanitizeName(input, 32);
  if (value.length < 2) {
    throw new Error('Player name must be at least 2 characters.');
  }

  const normalized = value.toLowerCase();
  if (FORCED_NAME_REPLACEMENTS.has(normalized)) {
    return FORCED_NAME_REPLACEMENTS.get(normalized);
  }

  if (containsBlockedLanguage(normalized)) {
    throw new Error('Player name contains blocked language.');
  }

  return value;
}

export function validateLevelId(input) {
  if (typeof input !== 'string') {
    throw new Error('Level id must be a string.');
  }

  const trimmed = input.trim().toLowerCase();
  if (!LEVEL_ID_RE.test(trimmed)) {
    throw new Error('Level id must use lowercase letters, numbers, underscore, or dash (3-64 chars).');
  }

  return trimmed;
}

export function validateLevelText(input) {
  if (typeof input !== 'string') {
    throw new Error('Level text must be a string.');
  }

  const normalized = input.replace(/\r/g, '');
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    throw new Error('Level text is empty.');
  }

  const width = lines[0].length;
  if (width < 3) {
    throw new Error('Level width must be at least 3.');
  }

  let players = 0;
  for (let y = 0; y < lines.length; y += 1) {
    const line = lines[y];
    if (line.length !== width) {
      throw new Error(`Level row ${y + 1} width mismatch.`);
    }

    for (let x = 0; x < line.length; x += 1) {
      const tile = line[x];
      if (!TILE_RE.test(tile)) {
        throw new Error(`Invalid tile '${tile}' at ${x + 1},${y + 1}.`);
      }
      if (tile === 'P') {
        players += 1;
      }
    }
  }

  if (players === 0) {
    throw new Error('Level needs at least one player spawn (P).');
  }

  return lines.join('\n');
}

export function validateLevelPayload(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Level payload must be an object.');
  }

  const id = validateLevelId(input.id);
  const candidateName = sanitizeName(input.name || id, 64) || id;
  if (containsBlockedLanguage(candidateName)) {
    throw new Error('Level name contains blocked language.');
  }

  return {
    id,
    name: candidateName,
    text: validateLevelText(input.text),
    authorName: validatePlayerName(input.authorName),
  };
}

export function normalizeStoredLevelName(input) {
  const value = sanitizeName(input, 64);
  if (value.length === 0 || containsBlockedLanguage(value)) {
    return LEVEL_NAME_FALLBACK;
  }

  return value;
}

export function validateScorePayload(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Score payload must be an object.');
  }

  const levelId = validateLevelId(input.levelId);
  const playerName = validatePlayerName(input.playerName);
  const moves = Number.parseInt(String(input.moves), 10);
  const durationMs = Number.parseInt(String(input.durationMs), 10);

  if (!Number.isInteger(moves) || moves < 0 || moves > 1000000) {
    throw new Error('Moves must be a non-negative integer.');
  }

  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 86400000) {
    throw new Error('Duration must be between 0 and 86400000 ms.');
  }

  const minimumDurationMs = Math.max(150, moves * 18);
  if (durationMs < minimumDurationMs) {
    throw new Error('Duration is too low for the submitted move count.');
  }

  return {
    levelId,
    playerName,
    moves,
    durationMs,
  };
}

export function validateDeleteLevelPayload(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Delete payload must be an object.');
  }

  if (typeof input.password !== 'string' || input.password.length === 0) {
    throw new Error('Admin password is required.');
  }

  return {
    levelId: validateLevelId(input.levelId),
    password: input.password,
  };
}
