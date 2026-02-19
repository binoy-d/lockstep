import { describe, expect, it } from 'vitest';
import { createInitialState, update } from '../../src/core';
import { parseLevelText } from '../../src/core/levelParser';
import type { Direction, ParsedLevel } from '../../src/core/types';
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

function directionVector(direction: Direction): { x: number; y: number } {
  if (direction === 'up') {
    return { x: 0, y: -1 };
  }
  if (direction === 'down') {
    return { x: 0, y: 1 };
  }
  if (direction === 'left') {
    return { x: -1, y: 0 };
  }
  return { x: 1, y: 0 };
}

function isWalkable(tile: string | undefined): boolean {
  if (!tile) {
    return false;
  }

  if (tile === ' ' || tile === 'P') {
    return true;
  }

  const numeric = Number.parseInt(tile, 10);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 18;
}

function couplingStats(level: ParsedLevel, path: Direction[]): {
  playerBlocks: number;
  mixedBlockSteps: number;
  uniqueBlockedPlayers: number;
  uniquePairs: number;
} {
  let state = createInitialState([level], 0);
  const blockedPlayers = new Set<number>();
  const interactionPairs = new Set<string>();
  let playerBlocks = 0;
  let mixedBlockSteps = 0;

  for (const direction of path) {
    const delta = directionVector(direction);
    const players = state.players.map((player) => ({ ...player }));
    const orderedIds = players.map((player) => player.id);

    let stepBlocks = 0;
    let stepMoves = 0;

    for (const playerId of orderedIds) {
      const index = players.findIndex((player) => player.id === playerId);
      if (index === -1) {
        continue;
      }

      const player = players[index];
      const targetX = player.x + delta.x;
      const targetY = player.y + delta.y;
      const targetTile = state.grid[targetY]?.[targetX];

      if (targetTile === undefined || targetTile === '!') {
        players.splice(index, 1);
        continue;
      }

      if (targetTile === 'x') {
        break;
      }

      if (!isWalkable(targetTile)) {
        continue;
      }

      const blocker = players.find((candidate) => candidate.id !== player.id && candidate.x === targetX && candidate.y === targetY);
      if (blocker) {
        stepBlocks += 1;
        blockedPlayers.add(player.id);
        interactionPairs.add(`${player.id}:${blocker.id}`);
        continue;
      }

      player.x = targetX;
      player.y = targetY;
      stepMoves += 1;
    }

    playerBlocks += stepBlocks;
    if (stepBlocks > 0 && stepMoves > 0) {
      mixedBlockSteps += 1;
    }

    state = update(state, { direction }, 16.6667);
    if (state.status === 'game-complete') {
      break;
    }
  }

  return {
    playerBlocks,
    mixedBlockSteps,
    uniqueBlockedPlayers: blockedPlayers.size,
    uniquePairs: interactionPairs.size,
  };
}

describe('admin level tools', () => {
  /**
   * Verifies deterministic generation with the same seed and constraints.
   */
  it(
    'generates deterministic layouts for identical inputs',
    { timeout: 20000 },
    () => {
      const options = {
        seed: 'admin-seed',
        players: 2,
        difficulty: 24,
        width: 25,
        height: 16,
        maxAttempts: 16,
      };

      const first = generateAdminLevel(options);
      const second = generateAdminLevel(options);

      expect(first.levelText).toBe(second.levelText);
      expect(first.minMoves).toBeGreaterThanOrEqual(24);
      expect(first.solverPath).toEqual(second.solverPath);
    },
  );

  /**
   * Ensures generated levels are solved in exactly the requested minimum move count.
   */
  it('matches generated difficulty to exact minimum solve length', { timeout: 20000 }, () => {
    const generated = generateAdminLevel({
      seed: 'difficulty-match',
      players: 1,
      difficulty: 64,
      width: 25,
      height: 16,
      maxAttempts: 32,
    });

    expect(generated.minMoves).toBe(64);
    expect(generated.solverPath).toHaveLength(64);
  });

  /**
   * Confirms feasibility checks reject impossible layout capacity requests for fixed map size.
   */
  it('rejects infeasible player and difficulty requests', () => {
    expect(() =>
      generateAdminLevel({
        seed: 'impossible',
        players: 4,
        difficulty: 30,
        width: 7,
        height: 7,
      }),
    ).toThrow(/Difficulty 30 exceeds this layout capacity/i);
  });

  /**
   * Validates guard rails for obviously invalid input values.
   */
  it('validates seed length and player count constraints', () => {
    expect(() =>
      generateAdminLevel({
        seed: 'x'.repeat(32),
        players: 2,
        difficulty: 20,
        width: 25,
        height: 16,
      }),
    ).toThrow(/seed must be shorter than 32 characters/i);

    expect(() =>
      generateAdminLevel({
        seed: 'bad-player-count',
        players: 0,
        difficulty: 20,
        width: 25,
        height: 16,
      }),
    ).toThrow(/players must be an integer between 1 and 128/i);
  });

  /**
   * Ensures generated maps include lava pressure and directional turns (not just straight corridors).
   */
  it('builds non-trivial geometry with lava constraints', { timeout: 20000 }, () => {
    const generated = generateAdminLevel({
      seed: 'geometry-check',
      players: 1,
      difficulty: 42,
      width: 25,
      height: 16,
      maxAttempts: 48,
    });

    const lavaCount = generated.levelText.split('').filter((tile) => tile === 'x').length;
    const turnCount = countTurns(generated.solverPath);
    expect(lavaCount).toBeGreaterThan(20);
    expect(turnCount).toBeGreaterThan(3);
  });

  /**
   * Ensures multiplayer outputs are selected for actual blocking interactions in the optimal path.
   */
  it('prioritizes multi-player coupling interactions', { timeout: 20000 }, () => {
    const generated = generateAdminLevel({
      seed: 'coupling-priority',
      players: 2,
      difficulty: 22,
      width: 25,
      height: 16,
      maxAttempts: 32,
    });

    const stats = couplingStats(generated.level, generated.solverPath);
    expect(generated.minMoves).toBeGreaterThanOrEqual(22);
    expect(stats.playerBlocks).toBeGreaterThanOrEqual(2);
    expect(stats.mixedBlockSteps).toBeGreaterThanOrEqual(1);
    expect(stats.uniqueBlockedPlayers).toBeGreaterThanOrEqual(1);
    expect(stats.uniquePairs).toBeGreaterThanOrEqual(1);
  });

  /**
   * Verifies higher difficulty requests still produce exact-length solutions with turning variety.
   */
  it('supports harder coupled generation targets above 20 moves', { timeout: 20000 }, () => {
    const generated = generateAdminLevel({
      seed: 'difficulty-48-coupled',
      players: 2,
      difficulty: 28,
      width: 25,
      height: 16,
      maxAttempts: 48,
    });

    const turns = countTurns(generated.solverPath);
    const stats = couplingStats(generated.level, generated.solverPath);
    expect(generated.minMoves).toBeGreaterThanOrEqual(28);
    expect(turns).toBeGreaterThanOrEqual(3);
    expect(stats.playerBlocks).toBeGreaterThanOrEqual(3);
    expect(stats.uniquePairs).toBeGreaterThanOrEqual(1);
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

  /**
   * Confirms solver truncation reporting when exploration exceeds maxVisited.
   */
  it('reports solver truncation when maxVisited is too low', () => {
    const open = parseLevelText(
      'wide-open',
      [
        '#########',
        '#P     !#',
        '#       #',
        '#       #',
        '#     P #',
        '#########',
      ].join('\n'),
      'Wide Open',
    );

    const solved = solveLevelForAdmin(open, { maxMoves: 50, maxVisited: 20 });
    expect(solved.minMoves).toBeNull();
    expect(solved.path).toBeNull();
    expect(solved.truncated).toBe(true);
  });
});
