import { createSeededRandom } from './rng.mjs';
import { levelModelFromGrid, solveLevel } from './solver.mjs';

function assertInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
}

function validateInputs(options) {
  const seed = String(options.seed ?? '');
  if (seed.length >= 32) {
    throw new Error('seed must be shorter than 32 characters.');
  }

  assertInteger(options.players, 'players', 1, 128);
  assertInteger(options.difficulty, 'difficulty', 1, 100);
  assertInteger(options.width, 'width', 7, 120);
  assertInteger(options.height, 'height', 7, 120);
}

function makeWallGrid(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => '#'));
}

function buildLanePath(width, laneTopY, rows, leftToRightStart) {
  const path = [];
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

function directionName(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) {
    return 'right';
  }
  if (dx === -1 && dy === 0) {
    return 'left';
  }
  if (dx === 0 && dy === 1) {
    return 'down';
  }
  if (dx === 0 && dy === -1) {
    return 'up';
  }

  throw new Error(`Non-adjacent path step: (${from.x},${from.y}) -> (${to.x},${to.y}).`);
}

function buildDesignedSolution(path, difficulty) {
  const moves = [];
  for (let index = difficulty; index > 0; index -= 1) {
    moves.push(directionName(path[index], path[index - 1]));
  }
  return moves;
}

function feasibilityFor(options) {
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

function buildCandidate(options, rng, rowsPerLane) {
  const grid = makeWallGrid(options.width, options.height);
  const laneHeight = rowsPerLane * 2 - 1;
  const innerHeight = options.height - 2;
  const usedRows = options.players * laneHeight + (options.players - 1);
  const freeRows = innerHeight - usedRows;
  const topPadding = freeRows === 0 ? 0 : rng.int(0, freeRows);
  const leftToRightStart = rng.bool();

  let referencePath = null;
  for (let lane = 0; lane < options.players; lane += 1) {
    const laneTopY = 1 + topPadding + lane * (laneHeight + 1);
    const path = buildLanePath(options.width, laneTopY, rowsPerLane, leftToRightStart);
    for (const position of path) {
      grid[position.y][position.x] = ' ';
    }

    const goal = path[0];
    const spawn = path[options.difficulty];
    grid[goal.y][goal.x] = '!';
    grid[spawn.y][spawn.x] = 'P';

    if (!referencePath) {
      referencePath = path;
    }
  }

  return {
    grid,
    path: referencePath,
    rowsPerLane,
  };
}

export function generateLevel(options) {
  const normalized = {
    seed: String(options.seed ?? ''),
    players: options.players,
    difficulty: options.difficulty,
    width: options.width ?? 25,
    height: options.height ?? 16,
    maxAttempts: options.maxAttempts ?? 64,
  };

  validateInputs(normalized);
  assertInteger(normalized.maxAttempts, 'maxAttempts', 1, 1000);

  const feasibility = feasibilityFor(normalized);
  if (!feasibility.feasible) {
    throw new Error(feasibility.reason);
  }

  for (let attempt = 0; attempt < normalized.maxAttempts; attempt += 1) {
    const rng = createSeededRandom(`${normalized.seed}|attempt:${attempt}`);
    const rowsPerLane = rng.int(feasibility.minRowsPerLane, feasibility.maxRowsPerLane);
    const candidate = buildCandidate(normalized, rng, rowsPerLane);
    const levelModel = levelModelFromGrid(candidate.grid);

    if (levelModel.totalPlayers !== normalized.players) {
      continue;
    }

    const solved = solveLevel(levelModel, {
      maxMoves: normalized.difficulty,
      maxVisited: 800000,
    });
    if (solved.minMoves !== normalized.difficulty || !solved.path) {
      continue;
    }

    const designedSolution = buildDesignedSolution(candidate.path, normalized.difficulty);
    const levelText = candidate.grid.map((row) => row.join('')).join('\n');

    return {
      seed: normalized.seed,
      attempt,
      width: normalized.width,
      height: normalized.height,
      players: normalized.players,
      difficulty: normalized.difficulty,
      rowsPerLane,
      levelText,
      minMoves: solved.minMoves,
      solverSolution: solved.path,
      designedSolution,
      visitedStates: solved.visitedStates,
    };
  }

  throw new Error(
    `Unable to generate a solvable level after ${normalized.maxAttempts} attempts for difficulty ${normalized.difficulty}.`,
  );
}
