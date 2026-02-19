import { describe, expect, it } from 'vitest';
import { parseLevelText } from '../../src/core/levelParser';
import { generateAdminLevel, solveLevelForAdmin } from '../../src/editor/adminLevelTools';

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
      difficulty: 38,
      width: 25,
      height: 16,
      maxAttempts: 64,
    });

    expect(generated.minMoves).toBe(38);
    expect(generated.solverPath).toHaveLength(38);
  });

  /**
   * Confirms feasibility checks reject impossible lane layouts for fixed map size.
   */
  it('rejects infeasible player and difficulty requests', () => {
    expect(() =>
      generateAdminLevel({
        seed: 'impossible',
        players: 4,
        difficulty: 80,
        width: 25,
        height: 16,
      }),
    ).toThrow(/No layout can satisfy players=4, difficulty=80, size=25x16/i);
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
