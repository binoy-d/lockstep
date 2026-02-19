import { describe, expect, it } from 'vitest';
import { parseLevelText } from '../../src/core/levelParser';
import { generateAdminLevel, solveLevelForAdmin } from '../../src/editor/adminLevelTools';

function countTurns(path: string[]): number {
  if (path.length <= 1) {
    return 0;
  }

  let turns = 0;
  let previous = path[0];
  for (let index = 1; index < path.length; index += 1) {
    if (path[index] !== previous) {
      turns += 1;
    }
    previous = path[index];
  }
  return turns;
}

describe('admin level tools', () => {
  /**
   * Verifies deterministic generation with the same seed and constraints.
   */
  it('generates deterministic layouts for identical inputs', () => {
    const options = {
      seed: 'admin-seed',
      players: 2,
      difficulty: 24,
      width: 25,
      height: 16,
      maxAttempts: 32,
    };

    const first = generateAdminLevel(options);
    const second = generateAdminLevel(options);

    expect(first.levelText).toBe(second.levelText);
    expect(first.minMoves).toBe(24);
    expect(first.solverPath).toEqual(second.solverPath);
  });

  /**
   * Ensures generated levels are solved in exactly the requested minimum move count.
   */
  it('matches generated difficulty to exact minimum solve length', () => {
    const generated = generateAdminLevel({
      seed: 'difficulty-match',
      players: 1,
      difficulty: 64,
      width: 25,
      height: 16,
      maxAttempts: 64,
    });

    expect(generated.minMoves).toBe(64);
    expect(generated.solverPath).toHaveLength(64);
  });

  /**
   * Confirms feasibility checks reject impossible lane layouts for fixed map size.
   */
  it('rejects infeasible player and difficulty requests', () => {
    expect(() =>
      generateAdminLevel({
        seed: 'impossible',
        players: 4,
        difficulty: 30,
        width: 25,
        height: 16,
      }),
    ).toThrow(/Difficulty 30 exceeds this layout capacity/i);
  });

  /**
   * Ensures generated maps include lava pressure and directional turns (not just straight corridors).
   */
  it('builds non-trivial geometry with lava constraints', () => {
    const generated = generateAdminLevel({
      seed: 'geometry-check',
      players: 1,
      difficulty: 42,
      width: 25,
      height: 16,
      maxAttempts: 96,
    });

    const lavaCount = generated.levelText.split('').filter((tile) => tile === 'x').length;
    const turnCount = countTurns(generated.solverPath);
    expect(lavaCount).toBeGreaterThan(20);
    expect(turnCount).toBeGreaterThan(3);
  });

  /**
   * Validates solver behavior on an unsolvable map by returning no path.
   */
  it('returns null path for unsolvable levels', () => {
    const blocked = parseLevelText(
      'blocked',
      ['#####', '#P###', '###!#', '#####'].join('\n'),
      'Blocked',
    );

    const solved = solveLevelForAdmin(blocked, { maxMoves: 50, maxVisited: 10000 });
    expect(solved.minMoves).toBeNull();
    expect(solved.path).toBeNull();
    expect(solved.truncated).toBe(false);
  });
});
