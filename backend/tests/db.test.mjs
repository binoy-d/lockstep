import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDatabase } from '../src/db.mjs';

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
    });
  }

  db.insertScore({ levelId: 'map1', playerName: 'Fast', moves: 9, durationMs: 12000 });
  db.insertScore({ levelId: 'map1', playerName: 'Slow', moves: 20, durationMs: 9000 });

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
    .run('map-x', hardR, '###\n#P!\n###', 'GAY', 1, 1);

  sqlite
    .prepare(`
      INSERT INTO level_scores(level_id, player_name, moves, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?);
    `)
    .run('map-x', 'GAY', 12, 1200, 1);
  sqlite.close();

  const db = createDatabase(path);
  const levels = db.listLevels();
  const scores = db.getTopScores('map-x', 10);
  assert.equal(levels[0].name, 'Custom Level');
  assert.equal(levels[0].authorName, 'Issac');
  assert.equal(scores[0].playerName, 'Issac');

  rmSync(path, { force: true });
});
