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
  laneHeight: number;
  maxDifficulty: number;
}

interface LaneSpec {
  topY: number;
  height: number;
}

interface LocalPoint {
  x: number;
  y: number;
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
  laneHeight: number;
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
    maxAttempts: options.maxAttempts ?? 96,
  };

  if (normalized.seed.length >= 32) {
    throw new Error('seed must be shorter than 32 characters.');
  }

  assertInteger(normalized.players, 'players', 1, 128);
  assertInteger(normalized.difficulty, 'difficulty', 1, 100);
  assertInteger(normalized.width, 'width', 7, 120);
  assertInteger(normalized.height, 'height', 7, 120);
  assertInteger(normalized.maxAttempts, 'maxAttempts', 1, 2000);
  return normalized;
}

function cloneGrid(grid: string[][]): string[][] {
  return grid.map((row) => row.slice());
}

function shuffleDirections(random: SeededRandom): Direction[] {
  const directions = [...SOLVER_DIRECTIONS];
  for (let index = directions.length - 1; index > 0; index -= 1) {
    const swapIndex = random.int(0, index);
    const next = directions[index];
    directions[index] = directions[swapIndex];
    directions[swapIndex] = next;
  }
  return directions;
}

function directionDelta(direction: Direction): { dx: number; dy: number } {
  if (direction === 'up') {
    return { dx: 0, dy: -1 };
  }
  if (direction === 'down') {
    return { dx: 0, dy: 1 };
  }
  if (direction === 'left') {
    return { dx: -1, dy: 0 };
  }
  return { dx: 1, dy: 0 };
}

function pointKey(point: LocalPoint): string {
  return `${point.x},${point.y}`;
}

function countTurns(path: LocalPoint[]): number {
  if (path.length <= 2) {
    return 0;
  }

  let turns = 0;
  let previousDx = path[1].x - path[0].x;
  let previousDy = path[1].y - path[0].y;
  for (let index = 2; index < path.length; index += 1) {
    const dx = path[index].x - path[index - 1].x;
    const dy = path[index].y - path[index - 1].y;
    if (dx !== previousDx || dy !== previousDy) {
      turns += 1;
    }
    previousDx = dx;
    previousDy = dy;
  }
  return turns;
}

function within(point: LocalPoint, width: number, height: number): boolean {
  return point.x >= 0 && point.x < width && point.y >= 0 && point.y < height;
}

function satisfiesClearance(candidate: LocalPoint, previous: LocalPoint | null, used: Set<string>): boolean {
  const adjacent = [
    { x: candidate.x + 1, y: candidate.y },
    { x: candidate.x - 1, y: candidate.y },
    { x: candidate.x, y: candidate.y + 1 },
    { x: candidate.x, y: candidate.y - 1 },
  ];

  for (const neighbor of adjacent) {
    const key = pointKey(neighbor);
    if (!used.has(key)) {
      continue;
    }

    if (previous && neighbor.x === previous.x && neighbor.y === previous.y) {
      continue;
    }

    return false;
  }

  return true;
}

function findPathWithDifficulty(
  width: number,
  height: number,
  difficulty: number,
  random: SeededRandom,
): LocalPoint[] | null {
  const targetLength = difficulty + 1;
  const maxWork = Math.max(15000, targetLength * 2000);

  for (let startAttempt = 0; startAttempt < 48; startAttempt += 1) {
    const start: LocalPoint = {
      x: random.int(0, width - 1),
      y: random.int(0, height - 1),
    };

    const path: LocalPoint[] = [start];
    const used = new Set<string>([pointKey(start)]);
    const branchStack: Direction[][] = [shuffleDirections(random)];
    let work = 0;

    while (path.length > 0) {
      if (path.length === targetLength) {
        return path.slice();
      }

      if (work > maxWork) {
        break;
      }

      const current = path[path.length - 1];
      const choices = branchStack[branchStack.length - 1];
      if (choices.length === 0) {
        const removed = path.pop();
        branchStack.pop();
        if (removed) {
          used.delete(pointKey(removed));
        }
        continue;
      }

      const direction = choices.pop() as Direction;
      const delta = directionDelta(direction);
      const candidate = {
        x: current.x + delta.dx,
        y: current.y + delta.dy,
      };
      work += 1;

      if (!within(candidate, width, height)) {
        continue;
      }

      const key = pointKey(candidate);
      if (used.has(key)) {
        continue;
      }

      if (!satisfiesClearance(candidate, current, used)) {
        continue;
      }

      path.push(candidate);
      used.add(key);
      branchStack.push(shuffleDirections(random));
    }
  }

  return null;
}

function buildLanes(options: Required<GenerateAdminLevelOptions>, random: SeededRandom): LaneSpec[] {
  const interiorHeight = options.height - 2;
  const laneHeight = Math.floor((interiorHeight - (options.players - 1)) / options.players);
  const usedRows = options.players * laneHeight + (options.players - 1);
  const freeRows = interiorHeight - usedRows;
  const topPadding = freeRows <= 0 ? 0 : random.int(0, freeRows);

  const lanes: LaneSpec[] = [];
  for (let index = 0; index < options.players; index += 1) {
    lanes.push({
      topY: 1 + topPadding + index * (laneHeight + 1),
      height: laneHeight,
    });
  }

  return lanes;
}

function feasibilityFor(options: Required<GenerateAdminLevelOptions>): FeasibilityResult {
  const interiorHeight = options.height - 2;
  const laneHeight = Math.floor((interiorHeight - (options.players - 1)) / options.players);
  const laneWidth = options.width - 2;

  if (laneHeight < 2 || laneWidth < 3) {
    return {
      feasible: false,
      reason: `Map size ${options.width}x${options.height} is too small for ${options.players} synchronized lanes.`,
      laneHeight,
      maxDifficulty: 0,
    };
  }

  const maxCellsWithSpacing = Math.floor((laneWidth * laneHeight + 1) / 2);
  const maxDifficulty = Math.max(1, maxCellsWithSpacing - 1);
  if (options.difficulty > maxDifficulty) {
    return {
      feasible: false,
      reason: `Difficulty ${options.difficulty} exceeds this layout capacity (max ${maxDifficulty}) for ${options.players} players on ${options.width}x${options.height}.`,
      laneHeight,
      maxDifficulty,
    };
  }

  return {
    feasible: true,
    laneHeight,
    maxDifficulty,
  };
}

function buildGridFromPath(
  options: Required<GenerateAdminLevelOptions>,
  random: SeededRandom,
  lanes: LaneSpec[],
  path: LocalPoint[],
): string[][] {
  const grid = Array.from({ length: options.height }, () => Array.from({ length: options.width }, () => '#'));
  const lanePathKeys = new Set(path.map(pointKey));

  for (const lane of lanes) {
    for (let localY = 0; localY < lane.height; localY += 1) {
      for (let localX = 0; localX < options.width - 2; localX += 1) {
        const absoluteX = localX + 1;
        const absoluteY = lane.topY + localY;
        grid[absoluteY][absoluteX] = random.nextFloat() < 0.82 ? 'x' : '#';
      }
    }

    for (const tile of path) {
      const x = tile.x + 1;
      const y = lane.topY + tile.y;
      grid[y][x] = ' ';
    }

    for (const tile of path) {
      const neighbors = [
        { x: tile.x + 1, y: tile.y },
        { x: tile.x - 1, y: tile.y },
        { x: tile.x, y: tile.y + 1 },
        { x: tile.x, y: tile.y - 1 },
      ];
      for (const neighbor of neighbors) {
        if (neighbor.x < 0 || neighbor.x >= options.width - 2 || neighbor.y < 0 || neighbor.y >= lane.height) {
          continue;
        }

        if (lanePathKeys.has(pointKey(neighbor))) {
          continue;
        }

        grid[lane.topY + neighbor.y][neighbor.x + 1] = 'x';
      }
    }

    const goal = path[0];
    const spawn = path[path.length - 1];
    grid[lane.topY + goal.y][goal.x + 1] = '!';
    grid[lane.topY + spawn.y][spawn.x + 1] = 'P';
  }

  return grid;
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
    typeof options.maxMoves === 'number' && Number.isInteger(options.maxMoves) ? options.maxMoves : 260;
  const maxVisited =
    typeof options.maxVisited === 'number' && Number.isInteger(options.maxVisited) ? options.maxVisited : 550000;

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

function hasInterestingGeometry(path: LocalPoint[], difficulty: number, laneHeight: number): boolean {
  if (difficulty < 10 || laneHeight < 3) {
    return true;
  }

  const turns = countTurns(path);
  const minTurns = Math.max(2, Math.floor(difficulty / 7));
  return turns >= minTurns;
}

export function generateAdminLevel(options: GenerateAdminLevelOptions): GeneratedAdminLevel {
  const normalized = normalizeInputs(options);
  const feasibility = feasibilityFor(normalized);
  if (!feasibility.feasible) {
    throw new Error(feasibility.reason);
  }

  const laneWidth = normalized.width - 2;

  for (let attempt = 0; attempt < normalized.maxAttempts; attempt += 1) {
    const random = createSeededRandom(`${normalized.seed}|attempt:${attempt}`);
    const lanes = buildLanes(normalized, random);
    const localPath = findPathWithDifficulty(laneWidth, feasibility.laneHeight, normalized.difficulty, random);
    if (!localPath) {
      continue;
    }

    if (!hasInterestingGeometry(localPath, normalized.difficulty, feasibility.laneHeight)) {
      continue;
    }

    const grid = buildGridFromPath(normalized, random, lanes, localPath);
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
      laneHeight: feasibility.laneHeight,
      level: parsed,
      grid: cloneGrid(grid),
      levelText,
      minMoves: solved.minMoves,
      solverPath: solved.path,
      visitedStates: solved.visitedStates,
    };
  }

  throw new Error(
    `Unable to generate a smart solvable level after ${normalized.maxAttempts} attempts for difficulty ${normalized.difficulty}.`,
  );
}
