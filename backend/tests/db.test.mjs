import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDatabase } from '../src/db.mjs';
import { normalizeStoredLevelId } from '../src/validation.mjs';

function makeTempPath(name) {
  return join(tmpdir(), `puzzle-backend-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}

test('upserts levels and returns latest level payload', () => {
  const path = makeTempPath('levels');
  const db = createDatabase(path);

  const first = db.upsertLevel({
    id: 'custom-level-1',
    name: 'First',
    text: ['###', '#P#', '###'].join('\n'),
    authorName: 'Ava',
  });

  const second = db.upsertLevel({
    id: 'custom-level-1',
    name: 'First Updated',
    text: ['#####', '#P !#', '#####'].join('\n'),
    authorName: 'Ava',
  });

  assert.equal(first.id, 'custom-level-1');
  assert.equal(second.name, 'First Updated');
  assert.equal(second.ownerUserId, null);
  assert.equal(db.listLevels().length, 1);

  rmSync(path, { force: true });
});

test('returns top 10 scores ordered by moves then duration then time', () => {
  const path = makeTempPath('scores');
  const db = createDatabase(path);

  for (let i = 0; i < 12; i += 1) {
    db.insertScore({
      levelId: 'map1',
      playerName: `P${i}`,
      moves: i % 3 === 0 ? 10 : 12 + i,
      durationMs: 10000 + i,
      replay: `${i + 1}r`,
    });
  }

  db.insertScore({ levelId: 'map1', playerName: 'Fast', moves: 9, durationMs: 12000, replay: '9r' });
  db.insertScore({ levelId: 'map1', playerName: 'Slow', moves: 20, durationMs: 9000, replay: '20r' });

  const top = db.getTopScores('map1', 10);
  assert.equal(top.length, 10);
  assert.equal(top[0].playerName, 'Fast');
  assert.ok(top.every((score) => score.levelId === undefined));

  for (let i = 1; i < top.length; i += 1) {
    const prev = top[i - 1];
    const current = top[i];
    const prevRank = prev.moves * 100000000 + prev.durationMs;
    const currentRank = current.moves * 100000000 + current.durationMs;
    assert.ok(prevRank <= currentRank);
  }

  const sqlite = new DatabaseSync(path);
  const replayRow = sqlite
    .prepare(`
      SELECT replay
      FROM level_scores
      WHERE player_name = 'Fast'
      LIMIT 1;
    `)
    .get();
  sqlite.close();
  assert.equal(replayRow.replay, '9r');

  rmSync(path, { force: true });
});

test('deletes a level and its scores', () => {
  const path = makeTempPath('delete');
  const db = createDatabase(path);

  db.upsertLevel({
    id: 'custom-level-99',
    name: 'Delete Me',
    text: ['###', '#P!', '###'].join('\n'),
    authorName: 'Ava',
  });

  db.insertScore({
    levelId: 'custom-level-99',
    playerName: 'Binoy',
    moves: 12,
    durationMs: 1200,
  });

  assert.equal(db.deleteLevel('custom-level-99'), true);
  assert.equal(db.listLevels().some((level) => level.id === 'custom-level-99'), false);
  assert.equal(db.getTopScores('custom-level-99', 10).length, 0);
  assert.equal(db.deleteLevel('custom-level-99'), false);

  rmSync(path, { force: true });
});

test('manages users, ownership, and per-user progress', () => {
  const path = makeTempPath('users');
  const db = createDatabase(path);

  const user = db.createUser({
    username: 'owner_user',
    passwordHash: 'hash',
    playerName: 'Owner',
    isAdmin: false,
  });

  db.upsertLevel({
    id: 'custom-level-owned',
    name: 'Owned',
    text: ['###', '#P!', '###'].join('\n'),
    authorName: user.playerName,
    ownerUserId: user.id,
  });

  db.upsertLevel({
    id: 'custom-level-unowned',
    name: 'Unowned',
    text: ['###', '#P!', '###'].join('\n'),
    authorName: 'Anon',
    ownerUserId: null,
  });

  const owned = db.getLevel('custom-level-owned');
  assert.equal(owned.ownerUserId, user.id);
  assert.equal(owned.ownerUsername, user.username);

  const assigned = db.assignUnownedLevelsToUser(user.id);
  assert.equal(assigned, 1);
  assert.equal(db.getLevel('custom-level-unowned').ownerUserId, user.id);

  db.saveUserProgress(user.id, 'custom-level-owned');
  const progress = db.getUserProgress(user.id);
  assert.equal(progress.selectedLevelId, 'custom-level-owned');
  assert.equal(progress.userId, user.id);

  const promoted = db.setUserAdmin(user.id, true);
  assert.equal(Boolean(promoted.isAdmin), true);
  const updated = db.updateUserCredentials(user.id, 'hash-2', 'OwnerTwo');
  assert.equal(updated.passwordHash, 'hash-2');
  assert.equal(updated.playerName, 'OwnerTwo');
  assert.equal(db.getUserByUsername('owner_user').id, user.id);

  rmSync(path, { force: true });
});

test('requires account-linked clear proof for publishing levels', () => {
  const path = makeTempPath('publish-proof');
  const db = createDatabase(path);

  const creator = db.createUser({
    username: 'creator_user',
    passwordHash: 'hash',
    playerName: 'Creator',
    isAdmin: false,
  });
  const other = db.createUser({
    username: 'other_user',
    passwordHash: 'hash',
    playerName: 'Other',
    isAdmin: false,
  });

  assert.equal(db.hasUserPublishProof('custom-level-proof', creator.id), false);

  db.insertScore({
    levelId: '__editor-test-level-custom-level-proof',
    playerName: creator.playerName,
    userId: creator.id,
    moves: 11,
    durationMs: 1100,
  });

  assert.equal(db.hasUserPublishProof('custom-level-proof', creator.id), true);
  assert.equal(db.hasUserPublishProof('custom-level-proof', other.id), false);

  rmSync(path, { force: true });
});

test('normalizes legacy offensive player names on startup', () => {
  const path = makeTempPath('legacy-cleanup');
  const hardR = String.fromCharCode(110, 105, 103, 103, 101, 114);
  const sqlite = new DatabaseSync(path);
  sqlite.exec(`
    CREATE TABLE user_levels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      author_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE level_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      moves INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  sqlite
    .prepare(`
      INSERT INTO user_levels(id, name, text, author_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?);
    `)
    .run(hardR, hardR, '###\n#P!\n###', 'GAY', 1, 1);

  sqlite
    .prepare(`
      INSERT INTO level_scores(level_id, player_name, moves, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?);
    `)
    .run(hardR, 'GAY', 12, 1200, 1);
  sqlite.close();

  const db = createDatabase(path);
  const expectedLevelId = normalizeStoredLevelId(hardR);
  const levels = db.listLevels();
  const scores = db.getTopScores(expectedLevelId, 10);
  assert.equal(levels[0].id, expectedLevelId);
  assert.equal(levels[0].name, 'Custom Level');
  assert.equal(levels[0].authorName, 'Issac');
  assert.equal(scores[0].playerName, 'Issac');
  assert.equal(db.getTopScores(hardR, 10).length, 0);

  rmSync(path, { force: true });
});

test('removes legacy level-one spoofed 3-move scores on startup', () => {
  const path = makeTempPath('legacy-level-one-score-cleanup');
  const sqlite = new DatabaseSync(path);
  sqlite.exec(`
    CREATE TABLE level_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      moves INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  sqlite
    .prepare(`
      INSERT INTO level_scores(level_id, player_name, moves, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?);
    `)
    .run('map0', 'Spoofer', 3, 500, 1);
  sqlite
    .prepare(`
      INSERT INTO level_scores(level_id, player_name, moves, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?);
    `)
    .run('map0', 'Legit', 4, 1200, 2);
  sqlite.close();

  const db = createDatabase(path);
  const scores = db.getTopScores('map0', 10);
  assert.equal(scores.some((entry) => entry.moves === 3), false);
  assert.equal(scores.some((entry) => entry.moves === 4), true);

  rmSync(path, { force: true });
});

/**
 * Ensures score ownership is persisted for authenticated users while guest scores remain nullable.
 */
test('preserves user-linked and guest score ownership metadata', () => {
  const path = makeTempPath('score-ownership');
  const db = createDatabase(path);
  const user = db.createUser({
    username: 'score_owner',
    passwordHash: 'hash',
    playerName: 'Owner',
    isAdmin: false,
  });

  db.insertScore({
    levelId: 'map0',
    playerName: 'Owner',
    userId: user.id,
    moves: 6,
    durationMs: 900,
    replay: '6r',
  });
  db.insertScore({
    levelId: 'map0',
    playerName: 'Guest',
    moves: 8,
    durationMs: 1200,
    replay: '8r',
  });

  const sqlite = new DatabaseSync(path);
  const rows = sqlite
    .prepare(`
      SELECT player_name AS playerName, user_id AS userId
      FROM level_scores
      WHERE level_id = 'map0'
      ORDER BY player_name ASC;
    `)
    .all();
  sqlite.close();

  const normalizedRows = rows.map((row) => ({ ...row }));
  assert.deepEqual(normalizedRows, [
    { playerName: 'Guest', userId: null },
    { playerName: 'Owner', userId: user.id },
  ]);

  rmSync(path, { force: true });
});

/**
 * Confirms score lookups are properly scoped by level id.
 */
test('keeps leaderboard results isolated by level id', () => {
  const path = makeTempPath('score-level-scope');
  const db = createDatabase(path);

  db.insertScore({ levelId: 'map0', playerName: 'A', moves: 9, durationMs: 900 });
  db.insertScore({ levelId: 'map0', playerName: 'B', moves: 7, durationMs: 1100 });
  db.insertScore({ levelId: 'map1', playerName: 'C', moves: 3, durationMs: 700 });

  const map0Scores = db.getTopScores('map0', 10);
  const map1Scores = db.getTopScores('map1', 10);

  assert.equal(map0Scores.length, 2);
  assert.equal(map0Scores[0].playerName, 'B');
  assert.equal(map1Scores.length, 1);
  assert.equal(map1Scores[0].playerName, 'C');

  rmSync(path, { force: true });
});

/**
 * Documents invalid user-id behavior for publish-proof checks.
 */
test('returns false publish proof for non-integer user ids', () => {
  const path = makeTempPath('publish-proof-invalid-user');
  const db = createDatabase(path);

  assert.equal(db.hasUserPublishProof('map0', null), false);
  assert.equal(db.hasUserPublishProof('map0', undefined), false);
  assert.equal(db.hasUserPublishProof('map0', 0), false);
  assert.equal(db.hasUserPublishProof('map0', Number.NaN), false);

  rmSync(path, { force: true });
});

/**
 * Covers paginated leaderboard reads with player-name search and personal-scope filters.
 */
test('queries leaderboard pages with search and personal scope', () => {
  const path = makeTempPath('scores-query');
  const db = createDatabase(path);

  const userA = db.createUser({
    username: 'ava_user',
    passwordHash: 'hash',
    playerName: 'Ava',
    isAdmin: false,
  });
  const userB = db.createUser({
    username: 'alex_user',
    passwordHash: 'hash',
    playerName: 'Alex',
    isAdmin: false,
  });

  db.insertScore({ levelId: 'map0', playerName: 'Ava', userId: userA.id, moves: 5, durationMs: 1000, replay: '5r' });
  db.insertScore({ levelId: 'map0', playerName: 'Avery', userId: userA.id, moves: 6, durationMs: 1200, replay: '6r' });
  db.insertScore({ levelId: 'map0', playerName: 'Alex', userId: userB.id, moves: 7, durationMs: 1400, replay: '7r' });
  db.insertScore({ levelId: 'map0', playerName: 'Blair', moves: 8, durationMs: 1600, replay: '8r' });
  db.insertScore({ levelId: 'map1', playerName: 'Ava', userId: userA.id, moves: 2, durationMs: 700, replay: '2r' });

  const searchPage = db.queryScores('map0', {
    limit: 2,
    offset: 0,
    searchText: 'av',
    userId: null,
  });
  assert.equal(searchPage.total, 2);
  assert.equal(searchPage.scores.length, 2);
  assert.equal(searchPage.scores[0].playerName, 'Ava');
  assert.equal(searchPage.scores[1].playerName, 'Avery');

  const personalScope = db.queryScores('map0', {
    limit: 10,
    offset: 0,
    searchText: '',
    userId: userA.id,
  });
  assert.equal(personalScope.total, 2);
  assert.equal(personalScope.scores.every((entry) => entry.playerName === 'Ava' || entry.playerName === 'Avery'), true);

  const paged = db.queryScores('map0', {
    limit: 2,
    offset: 2,
    searchText: '',
    userId: null,
  });
  assert.equal(paged.total, 4);
  assert.equal(paged.scores.length, 2);
  assert.equal(paged.scores[0].playerName, 'Alex');
  assert.equal(paged.scores[1].playerName, 'Blair');

  rmSync(path, { force: true });
});

/**
 * Ensures every score submission is retained and replay payloads are persisted for each row.
 */
test('stores every submitted score and replay without dropping duplicates', () => {
  const path = makeTempPath('scores-all-replays');
  const db = createDatabase(path);

  db.insertScore({ levelId: 'map0', playerName: 'Ava', moves: 5, durationMs: 1000, replay: '5r' });
  db.insertScore({ levelId: 'map0', playerName: 'Ava', moves: 5, durationMs: 1000, replay: '5r' });
  db.insertScore({ levelId: 'map0', playerName: 'Ava', moves: 4, durationMs: 900, replay: '4r' });

  const sqlite = new DatabaseSync(path);
  const countRow = sqlite
    .prepare(`
      SELECT COUNT(*) AS total
      FROM level_scores
      WHERE level_id = 'map0';
    `)
    .get();
  const replayRows = sqlite
    .prepare(`
      SELECT replay
      FROM level_scores
      WHERE level_id = 'map0'
      ORDER BY id ASC;
    `)
    .all();
  sqlite.close();

  assert.equal(countRow.total, 3);
  assert.deepEqual(
    replayRows.map((row) => row.replay),
    ['5r', '5r', '4r'],
  );

  rmSync(path, { force: true });
});

/**
 * Verifies wildcard characters in search text are treated literally and query bounds are clamped.
 */
test('escapes wildcard search text and clamps query bounds', () => {
  const path = makeTempPath('scores-search-escape');
  const db = createDatabase(path);

  db.insertScore({ levelId: 'map0', playerName: 'Al%pha', moves: 5, durationMs: 1000, replay: '5r' });
  db.insertScore({ levelId: 'map0', playerName: 'Al_pha', moves: 6, durationMs: 1200, replay: '6r' });
  db.insertScore({ levelId: 'map0', playerName: 'Alpha', moves: 7, durationMs: 1400, replay: '7r' });

  const percentSearch = db.queryScores('map0', {
    limit: 0,
    offset: -5,
    searchText: 'al%',
    userId: -1,
  });
  assert.equal(percentSearch.limit, 1);
  assert.equal(percentSearch.offset, 0);
  assert.equal(percentSearch.total, 1);
  assert.equal(percentSearch.scores[0].playerName, 'Al%pha');

  const underscoreSearch = db.queryScores('map0', {
    limit: 200,
    offset: 0,
    searchText: 'al_',
    userId: null,
  });
  assert.equal(underscoreSearch.limit, 100);
  assert.equal(underscoreSearch.total, 1);
  assert.equal(underscoreSearch.scores[0].playerName, 'Al_pha');

  rmSync(path, { force: true });
});

/**
 * Confirms personal-scope queries return no rows when a user has not posted a score on that level.
 */
test('returns an empty personal leaderboard page when user has no matching scores', () => {
  const path = makeTempPath('scores-personal-empty');
  const db = createDatabase(path);

  const userA = db.createUser({
    username: 'ava_scores_only',
    passwordHash: 'hash',
    playerName: 'Ava',
    isAdmin: false,
  });
  const userB = db.createUser({
    username: 'blair_no_scores',
    passwordHash: 'hash',
    playerName: 'Blair',
    isAdmin: false,
  });

  db.insertScore({ levelId: 'map0', playerName: 'Ava', userId: userA.id, moves: 5, durationMs: 1000, replay: '5r' });

  const personalPage = db.queryScores('map0', {
    limit: 10,
    offset: 0,
    searchText: '',
    userId: userB.id,
  });

  assert.equal(personalPage.total, 0);
  assert.equal(personalPage.scores.length, 0);

  rmSync(path, { force: true });
});
