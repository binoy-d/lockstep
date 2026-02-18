import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReplayInput, verifyReplayClearsLevel } from '../src/replayVerifier.mjs';

test('normalizes replay input', () => {
  assert.equal(validateReplayInput('RDLU'), 'rdlu');
  assert.equal(validateReplayInput('6d2r'), 'ddddddrr');
});

test('rejects replay input with invalid moves', () => {
  assert.throws(() => validateReplayInput('left-right'), /replay must use only/i);
});

test('accepts replay only when it clears the level', () => {
  const levelText = ['#####', '#P !#', '#####'].join('\n');
  const clear = verifyReplayClearsLevel(levelText, 'rr');
  assert.equal(clear.ok, true);
  assert.equal(clear.moves, 2);

  const fail = verifyReplayClearsLevel(levelText, 'll');
  assert.equal(fail.ok, false);
  assert.equal(fail.moves, 2);
});

test('treats numeric path tiles as path markers, not enemy spawns', () => {
  const levelText = ['#####', '#P2!#', '#####'].join('\n');
  const clear = verifyReplayClearsLevel(levelText, '2r');
  assert.equal(clear.ok, true);
  assert.equal(clear.moves, 2);
});
