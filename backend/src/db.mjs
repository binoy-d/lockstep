import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeStoredLevelId, normalizeStoredLevelName, validatePlayerName } from './validation.mjs';

function normalizeStoredPlayerName(raw) {
  try {
    return validatePlayerName(raw);
  } catch {
    return 'Player';
  }
}

function withSuffix(base, suffix) {
  const maxBaseLength = Math.max(3, 64 - suffix.length);
  return `${base.slice(0, maxBaseLength)}${suffix}`;
}

function reserveUniqueLevelId(baseId, takenIds) {
  if (!takenIds.has(baseId)) {
    return baseId;
  }

  let attempt = 2;
  while (attempt < 10_000) {
    const candidate = withSuffix(baseId, `-${attempt}`);
    if (!takenIds.has(candidate)) {
      return candidate;
    }
    attempt += 1;
  }

  throw new Error('Unable to reserve unique level id for migrated level.');
}

export function createDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_levels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      author_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS level_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      moves INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_level_scores_rank
      ON level_scores(level_id, moves ASC, duration_ms ASC, created_at ASC);
  `);

  const distinctScoreNamesStmt = db.prepare(`
    SELECT DISTINCT player_name AS playerName
    FROM level_scores;
  `);

  const distinctAuthorNamesStmt = db.prepare(`
    SELECT DISTINCT author_name AS authorName
    FROM user_levels;
  `);

  const distinctLevelNamesStmt = db.prepare(`
    SELECT DISTINCT name AS levelName
    FROM user_levels;
  `);

  const allLevelIdsStmt = db.prepare(`
    SELECT id
    FROM user_levels
    ORDER BY created_at ASC, id ASC;
  `);

  const updateScoreNameStmt = db.prepare(`
    UPDATE level_scores
    SET player_name = ?
    WHERE player_name = ?;
  `);

  const updateAuthorNameStmt = db.prepare(`
    UPDATE user_levels
    SET author_name = ?
    WHERE author_name = ?;
  `);

  const updateLevelNameStmt = db.prepare(`
    UPDATE user_levels
    SET name = ?
    WHERE name = ?;
  `);

  const updateLevelIdStmt = db.prepare(`
    UPDATE user_levels
    SET id = ?
    WHERE id = ?;
  `);

  const updateScoreLevelIdStmt = db.prepare(`
    UPDATE level_scores
    SET level_id = ?
    WHERE level_id = ?;
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const row of distinctScoreNamesStmt.all()) {
      const next = normalizeStoredPlayerName(row.playerName);
      if (next !== row.playerName) {
        updateScoreNameStmt.run(next, row.playerName);
      }
    }

    for (const row of distinctAuthorNamesStmt.all()) {
      const next = normalizeStoredPlayerName(row.authorName);
      if (next !== row.authorName) {
        updateAuthorNameStmt.run(next, row.authorName);
      }
    }

    for (const row of distinctLevelNamesStmt.all()) {
      const next = normalizeStoredLevelName(row.levelName);
      if (next !== row.levelName) {
        updateLevelNameStmt.run(next, row.levelName);
      }
    }

    const rows = allLevelIdsStmt.all();
    const takenIds = new Set(rows.map((row) => row.id));
    for (const row of rows) {
      const normalized = normalizeStoredLevelId(row.id);
      if (normalized === row.id) {
        continue;
      }

      takenIds.delete(row.id);
      const nextId = reserveUniqueLevelId(normalized, takenIds);
      updateScoreLevelIdStmt.run(nextId, row.id);
      updateLevelIdStmt.run(nextId, row.id);
      takenIds.add(nextId);
    }

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  const listLevelsStmt = db.prepare(`
    SELECT id, name, text, author_name AS authorName, created_at AS createdAt, updated_at AS updatedAt
    FROM user_levels
    ORDER BY updated_at DESC;
  `);

  const upsertLevelStmt = db.prepare(`
    INSERT INTO user_levels(id, name, text, author_name, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      text=excluded.text,
      author_name=excluded.author_name,
      updated_at=excluded.updated_at;
  `);

  const getLevelStmt = db.prepare(`
    SELECT id, name, text, author_name AS authorName, created_at AS createdAt, updated_at AS updatedAt
    FROM user_levels
    WHERE id = ?;
  `);

  const insertScoreStmt = db.prepare(`
    INSERT INTO level_scores(level_id, player_name, moves, duration_ms, created_at)
    VALUES(?, ?, ?, ?, ?);
  `);

  const topScoresStmt = db.prepare(`
    SELECT player_name AS playerName, moves, duration_ms AS durationMs, created_at AS createdAt
    FROM level_scores
    WHERE level_id = ?
    ORDER BY moves ASC, duration_ms ASC, created_at ASC
    LIMIT ?;
  `);

  const deleteLevelStmt = db.prepare(`
    DELETE FROM user_levels
    WHERE id = ?;
  `);

  const deleteScoresForLevelStmt = db.prepare(`
    DELETE FROM level_scores
    WHERE level_id = ?;
  `);

  return {
    listLevels() {
      return listLevelsStmt.all();
    },

    upsertLevel(level) {
      const now = Date.now();
      const existing = getLevelStmt.get(level.id);
      const createdAt = existing?.createdAt ?? now;
      upsertLevelStmt.run(level.id, level.name, level.text, level.authorName, createdAt, now);
      return getLevelStmt.get(level.id);
    },

    insertScore(score) {
      const now = Date.now();
      insertScoreStmt.run(score.levelId, score.playerName, score.moves, score.durationMs, now);
    },

    getTopScores(levelId, limit = 10) {
      return topScoresStmt.all(levelId, limit);
    },

    deleteLevel(levelId) {
      const deleted = deleteLevelStmt.run(levelId);
      if (!deleted.changes) {
        return false;
      }

      deleteScoresForLevelStmt.run(levelId);
      return true;
    },
  };
}
