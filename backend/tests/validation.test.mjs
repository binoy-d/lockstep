import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateDeleteLevelPayload,
  validateLevelId,
  validateLevelPayload,
  validatePlayerName,
  validateScorePayload,
} from '../src/validation.mjs';

test('validates and normalizes level id and player name', () => {
  assert.equal(validateLevelId('custom-level_1'), 'custom-level_1');
  assert.equal(validatePlayerName('  Ava   Lane  '), 'Ava Lane');
});

test('forces specific legacy abusive names to Issac', () => {
  const hardR = String.fromCharCode(110, 105, 103, 103, 101, 114);
  assert.equal(validatePlayerName(hardR), 'Issac');
  assert.equal(validatePlayerName('GAY'), 'Issac');
});

test('rejects profane player names', () => {
  assert.throws(() => validatePlayerName('shithead'), /blocked language/i);
});

test('rejects invalid level payloads', () => {
  assert.throws(
    () =>
      validateLevelPayload({
        id: 'bad id',
        name: 'Bad',
        text: '#',
        authorName: 'Ava',
      }),
    /level id/i,
  );

  assert.throws(
    () =>
      validateLevelPayload({
        id: 'custom-level-1',
        name: 'Bad',
        text: ['###', '# #', '###'].join('\n'),
        authorName: 'Ava',
      }),
    /player spawn/i,
  );
});

test('validates score payload constraints', () => {
  const score = validateScorePayload({
    levelId: 'map1',
    playerName: 'Binoy',
    moves: 22,
    durationMs: 45000,
  });

  assert.equal(score.moves, 22);
  assert.equal(score.durationMs, 45000);

  assert.throws(
    () =>
      validateScorePayload({
        levelId: 'map1',
        playerName: 'X',
        moves: -1,
        durationMs: 10,
      }),
    /player name|moves/i,
  );

  assert.throws(
    () =>
      validateScorePayload({
        levelId: 'map1',
        playerName: 'Binoy',
        moves: 10,
        durationMs: 20,
      }),
    /duration is too low/i,
  );
});

test('validates admin delete payload constraints', () => {
  const payload = validateDeleteLevelPayload({
    levelId: 'custom-level-15',
    password: 'dick',
  });

  assert.equal(payload.levelId, 'custom-level-15');
  assert.equal(payload.password, 'dick');

  assert.throws(
    () =>
      validateDeleteLevelPayload({
        levelId: 'custom level',
        password: 'dick',
      }),
    /level id/i,
  );

  assert.throws(
    () =>
      validateDeleteLevelPayload({
        levelId: 'custom-level-15',
        password: '',
      }),
    /password/i,
  );
});
