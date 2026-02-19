import assert from 'node:assert/strict';
import test from 'node:test';
import { generateLevel } from './generator.mjs';
import { levelModelFromGrid, solveLevel } from './solver.mjs';

function gridFromText(raw) {
  return raw.split('\n').map((line) => line.split(''));
}

/**
 * Verifies deterministic generation from identical parameters and seed.
 */
test('generateLevel is deterministic for identical inputs', () => {
  const input = {
    seed: 'determinism-seed',
    players: 2,
    difficulty: 28,
    width: 25,
    height: 16,
    maxAttempts: 32,
  };

  const first = generateLevel(input);
  const second = generateLevel(input);

  assert.equal(first.levelText, second.levelText);
  assert.deepEqual(first.solverSolution, second.solverSolution);
  assert.equal(first.minMoves, 28);
});

/**
 * Confirms generated levels are solved in exactly the requested minimum move count.
 */
test('generated level solver minimum matches requested difficulty', () => {
  const difficulty = 40;
  const generated = generateLevel({
    seed: 'exact-difficulty',
    players: 1,
    difficulty,
    width: 25,
    height: 16,
    maxAttempts: 64,
  });

  assert.equal(generated.minMoves, difficulty);
  assert.equal(generated.solverSolution.length, difficulty);

  const solved = solveLevel(levelModelFromGrid(gridFromText(generated.levelText)), {
    maxMoves: difficulty,
  });
  assert.equal(solved.minMoves, difficulty);
});

/**
 * Ensures multiple isolated player lanes can be generated and solved together.
 */
test('supports multiple players when layout capacity permits', () => {
  const generated = generateLevel({
    seed: 'multi-player',
    players: 3,
    difficulty: 12,
    width: 25,
    height: 16,
    maxAttempts: 64,
  });

  const playerCount = generated.levelText.split('').filter((char) => char === 'P').length;
  assert.equal(playerCount, 3);
  assert.equal(generated.minMoves, 12);
});

/**
 * Documents impossible parameter combinations for fixed-size maps.
 */
test('rejects infeasible player and difficulty combinations', () => {
  assert.throws(
    () =>
      generateLevel({
        seed: 'too-many-lanes',
        players: 4,
        difficulty: 80,
        width: 25,
        height: 16,
      }),
    /No layout can satisfy players=4, difficulty=80, size=25x16/i,
  );
});

/**
 * Validates seed-length constraints from the public API contract.
 */
test('rejects seed strings with length >= 32 characters', () => {
  assert.throws(
    () =>
      generateLevel({
        seed: '01234567890123456789012345678901',
        players: 1,
        difficulty: 10,
        width: 25,
        height: 16,
      }),
    /seed must be shorter than 32 characters/i,
  );
});
