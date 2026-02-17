import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeStoredLevelId, normalizeStoredLevelName, validatePlayerName, validateUsername } from './validation.mjs';

const EDITOR_TEST_LEVEL_ID_PREFIX = '__editor-test-level-';

function normalizeStoredPlayerName(raw) {
  try {
    return validatePlayerName(raw);
  } catch {
    return 'Player';
  }
}

function normalizeStoredUsername(raw) {
  try {
    return validateUsername(raw);
  } catch {
    return 'player';
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

function maybeAddColumn(db, sql) {
  try {
    db.exec(sql);
  } catch (error) {
    if (error instanceof Error && /duplicate column name/i.test(error.message)) {
      return;
    }

    throw error;
  }
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
      owner_user_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS level_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      user_id INTEGER,
      moves INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      player_name TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_progress (
      user_id INTEGER PRIMARY KEY,
      selected_level_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_level_scores_rank
      ON level_scores(level_id, moves ASC, duration_ms ASC, created_at ASC);

    CREATE INDEX IF NOT EXISTS idx_users_username
      ON users(username);
  `);

  maybeAddColumn(db, `ALTER TABLE user_levels ADD COLUMN owner_user_id INTEGER;`);
  maybeAddColumn(db, `ALTER TABLE level_scores ADD COLUMN user_id INTEGER;`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_levels_owner
      ON user_levels(owner_user_id);

    CREATE INDEX IF NOT EXISTS idx_level_scores_user_level
      ON level_scores(user_id, level_id);
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

  const distinctUsernamesStmt = db.prepare(`
    SELECT DISTINCT username
    FROM users;
  `);

  const distinctUserPlayerNamesStmt = db.prepare(`
    SELECT DISTINCT player_name AS playerName
    FROM users;
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

  const updateProgressLevelIdStmt = db.prepare(`
    UPDATE user_progress
    SET selected_level_id = ?
    WHERE selected_level_id = ?;
  `);

  const updateUsernameStmt = db.prepare(`
    UPDATE users
    SET username = ?, updated_at = ?
    WHERE username = ?;
  `);

  const updateUserPlayerNameStmt = db.prepare(`
    UPDATE users
    SET player_name = ?, updated_at = ?
    WHERE player_name = ?;
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

    const now = Date.now();
    for (const row of distinctUsernamesStmt.all()) {
      const next = normalizeStoredUsername(row.username);
      if (next !== row.username) {
        try {
          updateUsernameStmt.run(next, now, row.username);
        } catch {
          // Keep original when normalization would collide with an existing username.
        }
      }
    }

    for (const row of distinctUserPlayerNamesStmt.all()) {
      const next = normalizeStoredPlayerName(row.playerName);
      if (next !== row.playerName) {
        updateUserPlayerNameStmt.run(next, now, row.playerName);
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
      updateProgressLevelIdStmt.run(nextId, row.id);
      updateLevelIdStmt.run(nextId, row.id);
      takenIds.add(nextId);
    }

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  const listLevelsStmt = db.prepare(`
    SELECT
      l.id,
      l.name,
      l.text,
      l.author_name AS authorName,
      l.owner_user_id AS ownerUserId,
      u.username AS ownerUsername,
      l.created_at AS createdAt,
      l.updated_at AS updatedAt
    FROM user_levels AS l
    LEFT JOIN users AS u ON u.id = l.owner_user_id
    ORDER BY l.updated_at DESC;
  `);

  const upsertLevelStmt = db.prepare(`
    INSERT INTO user_levels(id, name, text, author_name, owner_user_id, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      text=excluded.text,
      author_name=excluded.author_name,
      owner_user_id=excluded.owner_user_id,
      updated_at=excluded.updated_at;
  `);

  const getLevelStmt = db.prepare(`
    SELECT
      l.id,
      l.name,
      l.text,
      l.author_name AS authorName,
      l.owner_user_id AS ownerUserId,
      u.username AS ownerUsername,
      l.created_at AS createdAt,
      l.updated_at AS updatedAt
    FROM user_levels AS l
    LEFT JOIN users AS u ON u.id = l.owner_user_id
    WHERE l.id = ?;
  `);

  const insertScoreStmt = db.prepare(`
    INSERT INTO level_scores(level_id, player_name, user_id, moves, duration_ms, created_at)
    VALUES(?, ?, ?, ?, ?, ?);
  `);

  const topScoresStmt = db.prepare(`
    SELECT player_name AS playerName, moves, duration_ms AS durationMs, created_at AS createdAt
    FROM level_scores
    WHERE level_id = ?
    ORDER BY moves ASC, duration_ms ASC, created_at ASC
    LIMIT ?;
  `);

  const hasPublishProofStmt = db.prepare(`
    SELECT 1
    FROM level_scores
    WHERE user_id = ?
      AND (level_id = ? OR level_id = ?)
    LIMIT 1;
  `);

  const deleteLevelStmt = db.prepare(`
    DELETE FROM user_levels
    WHERE id = ?;
  `);

  const deleteScoresForLevelStmt = db.prepare(`
    DELETE FROM level_scores
    WHERE level_id = ?;
  `);

  const insertUserStmt = db.prepare(`
    INSERT INTO users(username, password_hash, player_name, is_admin, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?);
  `);

  const userByUsernameStmt = db.prepare(`
    SELECT
      id,
      username,
      password_hash AS passwordHash,
      player_name AS playerName,
      is_admin AS isAdmin,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM users
    WHERE username = ?;
  `);

  const userByIdStmt = db.prepare(`
    SELECT
      id,
      username,
      password_hash AS passwordHash,
      player_name AS playerName,
      is_admin AS isAdmin,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM users
    WHERE id = ?;
  `);

  const setUserAdminStmt = db.prepare(`
    UPDATE users
    SET is_admin = ?, updated_at = ?
    WHERE id = ?;
  `);

  const updateUserCredentialsStmt = db.prepare(`
    UPDATE users
    SET password_hash = ?, player_name = ?, updated_at = ?
    WHERE id = ?;
  `);

  const assignUnownedLevelsStmt = db.prepare(`
    UPDATE user_levels
    SET owner_user_id = ?
    WHERE owner_user_id IS NULL;
  `);

  const upsertProgressStmt = db.prepare(`
    INSERT INTO user_progress(user_id, selected_level_id, updated_at)
    VALUES(?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      selected_level_id = excluded.selected_level_id,
      updated_at = excluded.updated_at;
  `);

  const getProgressStmt = db.prepare(`
    SELECT user_id AS userId, selected_level_id AS selectedLevelId, updated_at AS updatedAt
    FROM user_progress
    WHERE user_id = ?;
  `);

  return {
    listLevels() {
      return listLevelsStmt.all();
    },

    getLevel(levelId) {
      return getLevelStmt.get(levelId) ?? null;
    },

    upsertLevel(level) {
      const now = Date.now();
      const existing = getLevelStmt.get(level.id);
      const createdAt = existing?.createdAt ?? now;
      const ownerUserId = Number.isInteger(level.ownerUserId) ? level.ownerUserId : null;
      upsertLevelStmt.run(
        level.id,
        level.name,
        level.text,
        level.authorName,
        ownerUserId,
        createdAt,
        now,
      );
      return getLevelStmt.get(level.id);
    },

    insertScore(score) {
      const now = Date.now();
      insertScoreStmt.run(
        score.levelId,
        score.playerName,
        Number.isInteger(score.userId) ? score.userId : null,
        score.moves,
        score.durationMs,
        now,
      );
    },

    getTopScores(levelId, limit = 10) {
      return topScoresStmt.all(levelId, limit);
    },

    hasUserPublishProof(levelId, userId) {
      if (!Number.isInteger(userId) || userId <= 0) {
        return false;
      }

      const editorTestLevelId = `${EDITOR_TEST_LEVEL_ID_PREFIX}${levelId}`;
      return Boolean(hasPublishProofStmt.get(userId, levelId, editorTestLevelId));
    },

    deleteLevel(levelId) {
      const deleted = deleteLevelStmt.run(levelId);
      if (!deleted.changes) {
        return false;
      }

      deleteScoresForLevelStmt.run(levelId);
      return true;
    },

    createUser(user) {
      const now = Date.now();
      insertUserStmt.run(user.username, user.passwordHash, user.playerName, user.isAdmin ? 1 : 0, now, now);
      return userByUsernameStmt.get(user.username) ?? null;
    },

    getUserByUsername(username) {
      return userByUsernameStmt.get(username) ?? null;
    },

    getUserById(userId) {
      return userByIdStmt.get(userId) ?? null;
    },

    setUserAdmin(userId, isAdmin) {
      setUserAdminStmt.run(isAdmin ? 1 : 0, Date.now(), userId);
      return userByIdStmt.get(userId) ?? null;
    },

    updateUserCredentials(userId, passwordHash, playerName) {
      updateUserCredentialsStmt.run(passwordHash, playerName, Date.now(), userId);
      return userByIdStmt.get(userId) ?? null;
    },

    assignUnownedLevelsToUser(userId) {
      const result = assignUnownedLevelsStmt.run(userId);
      return result.changes;
    },

    saveUserProgress(userId, selectedLevelId) {
      upsertProgressStmt.run(userId, selectedLevelId, Date.now());
      return getProgressStmt.get(userId) ?? null;
    },

    getUserProgress(userId) {
      return getProgressStmt.get(userId) ?? null;
    },
  };
}
