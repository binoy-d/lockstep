import { createInitialState, parseLevelText, update } from '../core';
import type { Direction, GameState, ParsedLevel } from '../core/types';

const SOLVER_DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];

interface SeededRandom {
  nextFloat: () => number;
  int: (min: number, max: number) => number;
  bool: () => boolean;
}

interface FeasibilityResult {
  feasible: boolean;
  reason?: string;
  minRowsPerLane: number;
  maxRowsPerLane: number;
}

export interface SolverOptions {
  maxMoves?: number;
  maxVisited?: number;
}

export interface SolverResult {
  minMoves: number | null;
  path: Direction[] | null;
  visitedStates: number;
  truncated: boolean;
}

export interface GenerateAdminLevelOptions {
  seed: string;
  players: number;
  difficulty: number;
  width: number;
  height: number;
  maxAttempts?: number;
}

export interface GeneratedAdminLevel {
  seed: string;
  attempt: number;
  players: number;
  difficulty: number;
  width: number;
  height: number;
  rowsPerLane: number;
  level: ParsedLevel;
  grid: string[][];
  levelText: string;
  minMoves: number;
  solverPath: Direction[];
  visitedStates: number;
}

function xmur3(input: string): () => number {
  let hash = 1779033703 ^ input.length;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return function nextSeed() {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return function next() {
    value += 0x6d2b79f5;
    let candidate = Math.imul(value ^ (value >>> 15), 1 | value);
    candidate ^= candidate + Math.imul(candidate ^ (candidate >>> 7), 61 | candidate);
    return ((candidate ^ (candidate >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededRandom(seed: string): SeededRandom {
  const seedFactory = xmur3(seed);
  const random = mulberry32(seedFactory());

  return {
    nextFloat() {
      return random();
    },

    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new Error(`Invalid random range [${String(min)}, ${String(max)}].`);
      }

      const span = max - min + 1;
      return min + Math.floor(random() * span);
    },

    bool() {
      return random() < 0.5;
    },
  };
}

function assertInteger(value: number, name: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
}

function normalizeInputs(options: GenerateAdminLevelOptions): Required<GenerateAdminLevelOptions> {
  const normalized = {
    seed: String(options.seed ?? ''),
    players: options.players,
    difficulty: options.difficulty,
    width: options.width,
    height: options.height,
    maxAttempts: options.maxAttempts ?? 64,
  };

  if (normalized.seed.length >= 32) {
    throw new Error('seed must be shorter than 32 characters.');
  }

  assertInteger(normalized.players, 'players', 1, 128);
  assertInteger(normalized.difficulty, 'difficulty', 1, 100);
  assertInteger(normalized.width, 'width', 7, 120);
  assertInteger(normalized.height, 'height', 7, 120);
  assertInteger(normalized.maxAttempts, 'maxAttempts', 1, 1000);
  return normalized;
}

function buildStateKey(state: GameState): string {
  const players = state.players
    .slice()
    .sort((left, right) => left.id - right.id)
    .map((player) => `${player.id}:${player.x},${player.y}`)
    .join(';');
  const enemies = state.enemies
    .slice()
    .sort((left, right) => left.id - right.id)
    .map((enemy) => `${enemy.id}:${enemy.x},${enemy.y}`)
    .join(';');
  const grid = state.grid.map((row) => row.join('')).join('|');
  return `${state.playersDone}|${players}|${enemies}|${grid}`;
}

function reconstructPath(
  goalKey: string,
  parentMap: Map<string, string | null>,
  moveMap: Map<string, Direction>,
): Direction[] {
  const path: Direction[] = [];
  let key = goalKey;
  while (parentMap.get(key) !== null) {
    const move = moveMap.get(key);
    if (!move) {
      break;
    }
    path.push(move);
    key = parentMap.get(key) ?? key;
  }
  path.reverse();
  return path;
}

export function solveLevelForAdmin(level: ParsedLevel, options: SolverOptions = {}): SolverResult {
  const maxMoves =
    typeof options.maxMoves === 'number' && Number.isInteger(options.maxMoves) ? options.maxMoves : 220;
  const maxVisited =
    typeof options.maxVisited === 'number' && Number.isInteger(options.maxVisited) ? options.maxVisited : 400000;
  const initialState = createInitialState([level], 0);
  const initialKey = buildStateKey(initialState);
  const queue: Array<{ key: string; state: GameState; depth: number }> = [
    { key: initialKey, state: initialState, depth: 0 },
  ];
  const parentMap = new Map<string, string | null>([[initialKey, null]]);
  const moveMap = new Map<string, Direction>();
  const depthMap = new Map<string, number>([[initialKey, 0]]);

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;

    if (current.depth >= maxMoves) {
      continue;
    }

    for (const direction of SOLVER_DIRECTIONS) {
      const next = update(current.state, { direction }, 16.6667);
      if (next.lastEvent === 'level-reset') {
        continue;
      }

      const nextDepth = current.depth + 1;
      const nextKey = buildStateKey(next);
      if (depthMap.has(nextKey)) {
        continue;
      }

      depthMap.set(nextKey, nextDepth);
      parentMap.set(nextKey, current.key);
      moveMap.set(nextKey, direction);

      if (next.status === 'game-complete') {
        return {
          minMoves: nextDepth,
          path: reconstructPath(nextKey, parentMap, moveMap),
          visitedStates: depthMap.size,
          truncated: false,
        };
      }

      if (depthMap.size > maxVisited) {
        return {
          minMoves: null,
          path: null,
          visitedStates: depthMap.size,
          truncated: true,
        };
      }

      queue.push({ key: nextKey, state: next, depth: nextDepth });
    }
  }

  return {
    minMoves: null,
    path: null,
    visitedStates: depthMap.size,
    truncated: false,
  };
}

function makeWallGrid(width: number, height: number): string[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => '#'));
}

function buildLanePath(width: number, laneTopY: number, rows: number, leftToRightStart: boolean): Array<{ x: number; y: number }> {
  const path: Array<{ x: number; y: number }> = [];
  let leftToRight = leftToRightStart;

  for (let row = 0; row < rows; row += 1) {
    const y = laneTopY + row * 2;
    if (leftToRight) {
      for (let x = 1; x <= width - 2; x += 1) {
        path.push({ x, y });
      }
    } else {
      for (let x = width - 2; x >= 1; x -= 1) {
        path.push({ x, y });
      }
    }

    if (row < rows - 1) {
      const connectorX = leftToRight ? width - 2 : 1;
      path.push({ x: connectorX, y: y + 1 });
    }
    leftToRight = !leftToRight;
  }

  return path;
}

function feasibilityFor(options: Required<GenerateAdminLevelOptions>): FeasibilityResult {
  const innerWidth = options.width - 2;
  const innerHeight = options.height - 2;
  const minRowsPerLane = Math.ceil((options.difficulty + 2) / (innerWidth + 1));
  const maxLaneHeight = Math.floor((innerHeight - (options.players - 1)) / options.players);
  const maxRowsPerLane = Math.floor((maxLaneHeight + 1) / 2);

  if (maxRowsPerLane < minRowsPerLane) {
    return {
      feasible: false,
      reason: `No layout can satisfy players=${options.players}, difficulty=${options.difficulty}, size=${options.width}x${options.height}.`,
      minRowsPerLane,
      maxRowsPerLane,
    };
  }

  return {
    feasible: true,
    minRowsPerLane,
    maxRowsPerLane,
  };
}

function cloneGrid(grid: string[][]): string[][] {
  return grid.map((row) => row.slice());
}

function buildCandidate(
  options: Required<GenerateAdminLevelOptions>,
  random: SeededRandom,
  rowsPerLane: number,
): string[][] {
  const grid = makeWallGrid(options.width, options.height);
  const laneHeight = rowsPerLane * 2 - 1;
  const innerHeight = options.height - 2;
  const usedRows = options.players * laneHeight + (options.players - 1);
  const freeRows = innerHeight - usedRows;
  const topPadding = freeRows === 0 ? 0 : random.int(0, freeRows);
  const leftToRightStart = random.bool();

  for (let lane = 0; lane < options.players; lane += 1) {
    const laneTopY = 1 + topPadding + lane * (laneHeight + 1);
    const path = buildLanePath(options.width, laneTopY, rowsPerLane, leftToRightStart);
    for (const tile of path) {
      grid[tile.y][tile.x] = ' ';
    }

    const goal = path[0];
    const spawn = path[options.difficulty];
    grid[goal.y][goal.x] = '!';
    grid[spawn.y][spawn.x] = 'P';
  }

  return grid;
}

export function generateAdminLevel(options: GenerateAdminLevelOptions): GeneratedAdminLevel {
  const normalized = normalizeInputs(options);
  const feasibility = feasibilityFor(normalized);
  if (!feasibility.feasible) {
    throw new Error(feasibility.reason);
  }

  for (let attempt = 0; attempt < normalized.maxAttempts; attempt += 1) {
    const random = createSeededRandom(`${normalized.seed}|attempt:${attempt}`);
    const rowsPerLane = random.int(feasibility.minRowsPerLane, feasibility.maxRowsPerLane);
    const grid = buildCandidate(normalized, random, rowsPerLane);
    const levelText = grid.map((row) => row.join('')).join('\n');
    const parsed = parseLevelText(`admin-generated-${attempt}`, levelText, `Generated ${normalized.seed}`);
    if (parsed.playerSpawns.length !== normalized.players) {
      continue;
    }

    const solved = solveLevelForAdmin(parsed, {
      maxMoves: normalized.difficulty,
      maxVisited: 800000,
    });
    if (!solved.path || solved.minMoves !== normalized.difficulty) {
      continue;
    }

    return {
      seed: normalized.seed,
      attempt,
      players: normalized.players,
      difficulty: normalized.difficulty,
      width: normalized.width,
      height: normalized.height,
      rowsPerLane,
      level: parsed,
      grid: cloneGrid(grid),
      levelText,
      minMoves: solved.minMoves,
      solverPath: solved.path,
      visitedStates: solved.visitedStates,
    };
  }

  throw new Error(
    `Unable to generate a solvable level after ${normalized.maxAttempts} attempts for difficulty ${normalized.difficulty}.`,
  );
}
