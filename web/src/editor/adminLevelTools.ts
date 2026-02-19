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
  maxDifficulty: number;
}

interface LocalPoint {
  x: number;
  y: number;
}

interface CouplingMetrics {
  playerBlocks: number;
  mixedBlockSteps: number;
  uniqueBlockedPlayers: number;
  uniquePairs: number;
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

function countDirectionTurns(path: Direction[]): number {
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

function within(point: LocalPoint, width: number, height: number): boolean {
  return point.x >= 0 && point.x < width && point.y >= 0 && point.y < height;
}

function neighbors(point: LocalPoint): LocalPoint[] {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ];
}

function shuffleInPlace<T>(items: T[], random: SeededRandom): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = random.int(0, index);
    const next = items[index];
    items[index] = items[swapIndex];
    items[swapIndex] = next;
  }
}

function countNeighborMembership(point: LocalPoint, keys: Set<string>): number {
  let count = 0;
  for (const candidate of neighbors(point)) {
    if (keys.has(pointKey(candidate))) {
      count += 1;
    }
  }
  return count;
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

function findPathWithLength(
  width: number,
  height: number,
  targetLength: number,
  random: SeededRandom,
): LocalPoint[] | null {
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

function feasibilityFor(options: Required<GenerateAdminLevelOptions>): FeasibilityResult {
  const interiorWidth = options.width - 2;
  const interiorHeight = options.height - 2;
  const interiorCapacity = interiorWidth * interiorHeight;
  const maxDifficulty = Math.max(1, Math.floor(interiorCapacity / 2) - 2);

  if (interiorWidth < 3 || interiorHeight < 3) {
    return {
      feasible: false,
      reason: `Map size ${options.width}x${options.height} is too small for level generation.`,
      maxDifficulty,
    };
  }

  if (options.players > options.difficulty) {
    return {
      feasible: false,
      reason: `Difficulty ${options.difficulty} must be at least players ${options.players}.`,
      maxDifficulty,
    };
  }

  if (options.difficulty > maxDifficulty) {
    return {
      feasible: false,
      reason: `Difficulty ${options.difficulty} exceeds this layout capacity (max ${maxDifficulty}) for ${options.width}x${options.height}.`,
      maxDifficulty,
    };
  }

  return {
    feasible: true,
    maxDifficulty,
  };
}

function addSpawnCandidate(
  candidates: number[][],
  seen: Set<string>,
  pathLength: number,
  players: number,
  indexes: number[],
): void {
  if (indexes.length !== players) {
    return;
  }

  const uniqueSorted = Array.from(new Set(indexes))
    .filter((index) => index > 0 && index < pathLength)
    .sort((left, right) => left - right);
  if (uniqueSorted.length !== players) {
    return;
  }

  const key = uniqueSorted.join(',');
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push(uniqueSorted);
}

function buildSpawnIndexCandidates(
  pathLength: number,
  players: number,
  difficulty: number,
  random: SeededRandom,
): number[][] {
  if (pathLength <= players + 1) {
    return [];
  }

  const candidates: number[][] = [];
  const seen = new Set<string>();
  const corePlayers = Math.min(players, 2);
  const expandCore = (coreIndexes: number[]): number[] => {
    if (players <= coreIndexes.length) {
      return coreIndexes.slice(0, players);
    }

    const expanded = [...coreIndexes];
    const used = new Set(expanded);
    let cursor = 1;
    while (expanded.length < players && cursor < pathLength) {
      if (!used.has(cursor)) {
        expanded.push(cursor);
        used.add(cursor);
      }
      cursor += 1;
    }
    return expanded;
  };

  const addExpandedCandidate = (indexes: number[]) => {
    addSpawnCandidate(candidates, seen, pathLength, players, expandCore(indexes));
  };

  const maxEnd = Math.min(pathLength - 1, difficulty + Math.max(4, players * 2));
  const anchorEnd = Math.max(corePlayers, Math.min(maxEnd, difficulty));

  const preferredEnds: number[] = [];
  for (let end = anchorEnd; end >= Math.max(corePlayers, anchorEnd - 18); end -= 1) {
    preferredEnds.push(end);
  }
  for (let end = anchorEnd + 1; end <= maxEnd; end += 1) {
    preferredEnds.push(end);
  }

  if (players === 1) {
    addExpandedCandidate([anchorEnd]);
  }

  for (const end of preferredEnds.slice(0, 6)) {
    const contiguousStart = Math.max(1, end - (corePlayers - 1));
    addExpandedCandidate(Array.from({ length: corePlayers }, (_, offset) => contiguousStart + offset));

    const lowBound = Math.max(1, end - (corePlayers + 8));
    const randomCluster = new Set<number>([end]);
    while (randomCluster.size < corePlayers) {
      randomCluster.add(random.int(lowBound, end));
    }
    addExpandedCandidate(Array.from(randomCluster));

  }

  const globalStarts: number[] = [];
  const globalMaxStart = Math.max(1, pathLength - corePlayers);
  for (let start = 1; start <= globalMaxStart; start += 1) {
    globalStarts.push(start);
  }
  shuffleInPlace(globalStarts, random);
  for (const start of globalStarts.slice(0, 2)) {
    addExpandedCandidate(Array.from({ length: corePlayers }, (_, offset) => start + offset));
  }

  return candidates;
}

function carveCouplingPockets(
  path: LocalPoint[],
  width: number,
  height: number,
  difficulty: number,
  random: SeededRandom,
): Set<string> {
  const open = new Set(path.map(pointKey));
  const hubIndex = Math.min(path.length - 2, Math.max(2, difficulty));
  const hubRadius = Math.max(2, Math.floor(path.length / 14));

  for (let index = 1; index < path.length - 1; index += 1) {
    const source = path[index];
    const candidates = neighbors(source).filter((candidate) => within(candidate, width, height));
    shuffleInPlace(candidates, random);

    const nearHub = Math.abs(index - hubIndex) <= hubRadius;
    const carveBudget = 1;
    const carveChance = nearHub ? 0.38 : 0.12;
    let carved = 0;

    for (const candidate of candidates) {
      if (carved >= carveBudget) {
        break;
      }

      const candidateKey = pointKey(candidate);
      if (open.has(candidateKey)) {
        continue;
      }

      if (countNeighborMembership(candidate, open) !== 1) {
        continue;
      }

      if (random.nextFloat() > carveChance) {
        continue;
      }

      open.add(candidateKey);
      carved += 1;

      const extension = {
        x: candidate.x + (candidate.x - source.x),
        y: candidate.y + (candidate.y - source.y),
      };
      if (
        carved < carveBudget &&
        within(extension, width, height) &&
        !open.has(pointKey(extension)) &&
        countNeighborMembership(extension, open) <= 1 &&
        random.nextFloat() < (nearHub ? 0.22 : 0.08)
      ) {
        open.add(pointKey(extension));
        carved += 1;
      }
    }
  }

  return open;
}

function buildGridFromPath(
  options: Required<GenerateAdminLevelOptions>,
  random: SeededRandom,
  path: LocalPoint[],
  spawnIndexes: number[],
  openKeys: Set<string>,
): string[][] {
  const interiorWidth = options.width - 2;
  const interiorHeight = options.height - 2;
  const grid = Array.from({ length: options.height }, () => Array.from({ length: options.width }, () => '#'));

  for (let y = 0; y < interiorHeight; y += 1) {
    for (let x = 0; x < interiorWidth; x += 1) {
      const point = { x, y };
      const key = pointKey(point);
      const absoluteX = x + 1;
      const absoluteY = y + 1;

      if (openKeys.has(key)) {
        grid[absoluteY][absoluteX] = ' ';
        continue;
      }

      const openNeighbors = neighbors(point).filter(
        (neighbor) => within(neighbor, interiorWidth, interiorHeight) && openKeys.has(pointKey(neighbor)),
      ).length;

      if (openNeighbors >= 2) {
        grid[absoluteY][absoluteX] = '#';
      } else if (openNeighbors === 1) {
        grid[absoluteY][absoluteX] = random.nextFloat() < 0.22 ? 'x' : '#';
      } else {
        grid[absoluteY][absoluteX] = random.nextFloat() < 0.45 ? 'x' : '#';
      }
    }
  }

  const goal = path[0];
  grid[goal.y + 1][goal.x + 1] = '!';
  for (const index of spawnIndexes) {
    const spawn = path[index];
    grid[spawn.y + 1][spawn.x + 1] = 'P';
  }

  return grid;
}

function isWalkable(tileValue: string | undefined): boolean {
  if (!tileValue) {
    return false;
  }

  if (tileValue === ' ' || tileValue === 'P') {
    return true;
  }

  const numeric = Number.parseInt(tileValue, 10);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 18;
}

function analyzeCoupling(level: ParsedLevel, solverPath: Direction[]): CouplingMetrics | null {
  let state = createInitialState([level], 0);
  let playerBlocks = 0;
  let mixedBlockSteps = 0;
  const blockedPlayers = new Set<number>();
  const interactionPairs = new Set<string>();

  for (const direction of solverPath) {
    const delta = directionDelta(direction);
    const players = state.players.map((player) => ({ ...player }));
    const orderedIds = players.map((player) => player.id);

    let stepBlocks = 0;
    let movedPlayers = 0;
    let reset = false;

    for (const playerId of orderedIds) {
      const index = players.findIndex((player) => player.id === playerId);
      if (index === -1) {
        continue;
      }

      const player = players[index];
      const targetX = player.x + delta.dx;
      const targetY = player.y + delta.dy;
      const targetTile = state.grid[targetY]?.[targetX];

      if (targetTile === undefined || targetTile === '!') {
        players.splice(index, 1);
        continue;
      }

      if (targetTile === 'x') {
        reset = true;
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
      movedPlayers += 1;
    }

    if (reset) {
      return null;
    }

    playerBlocks += stepBlocks;
    if (stepBlocks > 0 && movedPlayers > 0) {
      mixedBlockSteps += 1;
    }

    state = update(state, { direction }, 16.6667);
    if (state.lastEvent === 'level-reset') {
      return null;
    }

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

function couplingThresholdsFor(options: Required<GenerateAdminLevelOptions>, attempt: number): {
  minimumBlocks: number;
  minimumMixedSteps: number;
  minimumBlockedPlayers: number;
  minimumPairs: number;
} {
  if (options.players <= 1) {
    return {
      minimumBlocks: 0,
      minimumMixedSteps: 0,
      minimumBlockedPlayers: 0,
      minimumPairs: 0,
    };
  }

  const progress =
    options.maxAttempts <= 1 ? 1 : Math.min(1, Math.max(0, attempt / Math.max(1, options.maxAttempts - 1)));
  const relax = 1 - progress * 0.3;
  const baseBlocks = Math.max(options.players * 2, Math.floor(options.difficulty / 6));
  return {
    minimumBlocks: Math.max(options.players, Math.floor(baseBlocks * relax)),
    minimumMixedSteps: Math.max(1, Math.floor((baseBlocks / 3) * relax)),
    minimumBlockedPlayers: Math.max(2, Math.min(options.players, Math.ceil(options.players * relax))),
    minimumPairs: Math.max(1, Math.min(options.players - 1, Math.ceil((options.players - 1) * relax))),
  };
}

function couplingScore(path: Direction[], coupling: CouplingMetrics | null): number {
  const turns = countDirectionTurns(path);
  if (!coupling) {
    return turns * 2;
  }

  return (
    turns * 2 +
    coupling.playerBlocks * 8 +
    coupling.mixedBlockSteps * 10 +
    coupling.uniqueBlockedPlayers * 14 +
    coupling.uniquePairs * 18
  );
}

function laneHeightForPlayers(height: number, players: number): number {
  const interior = height - 2;
  return Math.floor((interior - (players - 1)) / players);
}

function hasInterestingGeometry(path: LocalPoint[], difficulty: number): boolean {
  if (difficulty < 8) {
    return true;
  }

  const turns = countTurns(path);
  const minimumTurns = Math.max(3, Math.floor(difficulty / 8));
  return turns >= minimumTurns;
}

function hasUsefulCouplingFallback(
  options: Required<GenerateAdminLevelOptions>,
  coupling: CouplingMetrics | null,
): boolean {
  if (options.players <= 1) {
    return true;
  }

  return coupling !== null && coupling.playerBlocks > 0 && coupling.uniquePairs > 0;
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

export function generateAdminLevel(options: GenerateAdminLevelOptions): GeneratedAdminLevel {
  const normalized = normalizeInputs(options);
  const feasibility = feasibilityFor(normalized);
  if (!feasibility.feasible) {
    throw new Error(feasibility.reason);
  }

  const interiorWidth = normalized.width - 2;
  const interiorHeight = normalized.height - 2;
  const laneHeight = laneHeightForPlayers(normalized.height, normalized.players);
  const solverMaxMoves = normalized.players > 1 ? normalized.difficulty + Math.max(12, normalized.players * 5) : normalized.difficulty;
  const maxAllowedOvershoot = normalized.players > 1 ? Math.max(8, normalized.players * 4) : 0;
  let bestFallback:
    | {
        attempt: number;
        grid: string[][];
        levelText: string;
        parsed: ParsedLevel;
        solvedPath: Direction[];
        solvedMoves: number;
        visitedStates: number;
        score: number;
      }
    | null = null;

  for (let attempt = 0; attempt < normalized.maxAttempts; attempt += 1) {
    const random = createSeededRandom(`${normalized.seed}|attempt:${attempt}`);
    const targetLength =
      normalized.difficulty +
      normalized.players +
      random.int(1, Math.max(6, normalized.players * 2 + 8));
    if (targetLength > interiorWidth * interiorHeight) {
      continue;
    }

    const localPath = findPathWithLength(interiorWidth, interiorHeight, targetLength, random);
    if (!localPath || localPath.length <= normalized.difficulty) {
      continue;
    }

    if (!hasInterestingGeometry(localPath.slice(0, normalized.difficulty + 1), normalized.difficulty)) {
      continue;
    }

    const openKeys = carveCouplingPockets(localPath, interiorWidth, interiorHeight, normalized.difficulty, random);
    const spawnCandidates = buildSpawnIndexCandidates(localPath.length, normalized.players, normalized.difficulty, random);
    if (spawnCandidates.length === 0) {
      continue;
    }

    const thresholds = couplingThresholdsFor(normalized, attempt);

    for (const spawnIndexes of spawnCandidates) {
      const grid = buildGridFromPath(normalized, random, localPath, spawnIndexes, openKeys);
      const levelText = grid.map((row) => row.join('')).join('\n');
      let parsed: ParsedLevel;
      try {
        parsed = parseLevelText(`admin-generated-${attempt}`, levelText, `Generated ${normalized.seed}`);
      } catch {
        continue;
      }

      if (parsed.playerSpawns.length !== normalized.players) {
        continue;
      }

      const solved = solveLevelForAdmin(parsed, {
        maxMoves: solverMaxMoves,
        maxVisited: 120000,
      });
      if (!solved.path || solved.minMoves === null) {
        continue;
      }

      const matchesDifficulty =
        normalized.players === 1
          ? solved.minMoves === normalized.difficulty
          : solved.minMoves >= normalized.difficulty &&
            solved.minMoves <= normalized.difficulty + maxAllowedOvershoot;
      if (!matchesDifficulty) {
        continue;
      }

      const coupling = normalized.players > 1 ? analyzeCoupling(parsed, solved.path) : null;
      if (normalized.players > 1 && coupling === null) {
        continue;
      }

      const turns = countDirectionTurns(solved.path);
      if (turns < Math.max(2, Math.floor(normalized.difficulty / 10))) {
        continue;
      }

      const meetsThresholds =
        normalized.players === 1 ||
        (coupling !== null &&
          coupling.playerBlocks >= thresholds.minimumBlocks &&
          coupling.mixedBlockSteps >= thresholds.minimumMixedSteps &&
          coupling.uniqueBlockedPlayers >= thresholds.minimumBlockedPlayers &&
          coupling.uniquePairs >= thresholds.minimumPairs);

      const score = couplingScore(solved.path, coupling) - Math.abs(solved.minMoves - normalized.difficulty) * 6;
      if (meetsThresholds) {
        return {
          seed: normalized.seed,
          attempt,
          players: normalized.players,
          difficulty: normalized.difficulty,
          width: normalized.width,
          height: normalized.height,
          laneHeight,
          level: parsed,
          grid: cloneGrid(grid),
          levelText,
          minMoves: solved.minMoves,
          solverPath: solved.path,
          visitedStates: solved.visitedStates,
        };
      }

      if (!hasUsefulCouplingFallback(normalized, coupling)) {
        continue;
      }

      if (!bestFallback || score > bestFallback.score) {
        bestFallback = {
          attempt,
          grid: cloneGrid(grid),
          levelText,
          parsed,
          solvedPath: solved.path,
          solvedMoves: solved.minMoves,
          visitedStates: solved.visitedStates,
          score,
        };
      }
    }
  }

  if (bestFallback) {
    return {
      seed: normalized.seed,
      attempt: bestFallback.attempt,
      players: normalized.players,
      difficulty: normalized.difficulty,
      width: normalized.width,
      height: normalized.height,
      laneHeight,
      level: bestFallback.parsed,
      grid: cloneGrid(bestFallback.grid),
      levelText: bestFallback.levelText,
      minMoves: bestFallback.solvedMoves,
      solverPath: bestFallback.solvedPath,
      visitedStates: bestFallback.visitedStates,
    };
  }

  throw new Error(
    `Unable to generate a smart solvable level after ${normalized.maxAttempts} attempts for difficulty ${normalized.difficulty}.`,
  );
}
