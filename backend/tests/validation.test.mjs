import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateDeleteLevelPayload,
  validateLoginPayload,
  validateLevelId,
  validateLevelPayload,
  validateProgressPayload,
  normalizeStoredLevelId,
  validateRegisterPayload,
  validatePlayerName,
  validateScorePayload,
  validateUsername,
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

test('rejects profane level names', () => {
  const hardR = String.fromCharCode(110, 105, 103, 103, 101, 114);
  assert.throws(
    () =>
      validateLevelPayload({
        id: 'custom-level-8',
        name: hardR,
        text: ['###', '#P!', '###'].join('\n'),
      }),
    /level name contains blocked language/i,
  );
});

test('rejects profane level ids and normalizes stored legacy ids', () => {
  const hardR = String.fromCharCode(110, 105, 103, 103, 101, 114);
  assert.throws(() => validateLevelId(hardR), /level id contains blocked language/i);
  assert.match(normalizeStoredLevelId(hardR), /^custom-level-[a-f0-9]{10}$/);
});

test('rejects invalid level payloads', () => {
  assert.throws(
    () =>
      validateLevelPayload({
        id: 'bad id',
        name: 'Bad',
        text: '#',
      }),
    /level id/i,
  );

  assert.throws(
    () =>
      validateLevelPayload({
        id: 'custom-level-1',
        name: 'Bad',
        text: ['###', '# #', '###'].join('\n'),
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
    replay: 'r'.repeat(22),
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
        replay: '',
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
        replay: 'r'.repeat(10),
      }),
    /duration is too low/i,
  );

  assert.throws(
    () =>
      validateScorePayload({
        levelId: 'map1',
        playerName: 'Binoy',
        moves: 10,
        durationMs: 5000,
        replay: 'r'.repeat(9),
      }),
    /moves must match replay length/i,
  );
});

test('validates delete payload constraints', () => {
  const payload = validateDeleteLevelPayload({
    levelId: 'custom-level-15',
  });

  assert.equal(payload.levelId, 'custom-level-15');

  assert.throws(
    () =>
      validateDeleteLevelPayload({
        levelId: 'custom level',
      }),
    /level id/i,
  );
});

test('validates account and progress payload constraints', () => {
  const register = validateRegisterPayload({
    username: 'Test_User',
    password: 'secretpass',
    playerName: 'Ava Lane',
  });
  assert.deepEqual(register, {
    username: 'test_user',
    password: 'secretpass',
    playerName: 'Ava Lane',
  });

  const fallbackRegister = validateRegisterPayload({
    username: 'player_77',
    password: 'secretpass',
  });
  assert.equal(fallbackRegister.playerName, 'player_77');

  const login = validateLoginPayload({
    username: 'Player_77',
    password: 'secretpass',
  });
  assert.deepEqual(login, {
    username: 'player_77',
    password: 'secretpass',
  });

  const progress = validateProgressPayload({
    selectedLevelId: 'custom-level-9',
  });
  assert.equal(progress.selectedLevelId, 'custom-level-9');

  assert.equal(validateUsername('Abc_123'), 'abc_123');
  assert.throws(() => validateRegisterPayload({ username: 'ab', password: 'short' }), /username|password/i);
});
