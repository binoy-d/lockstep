const DIRECTIONS = [
  { name: 'up', dx: 0, dy: -1 },
  { name: 'right', dx: 1, dy: 0 },
  { name: 'down', dx: 0, dy: 1 },
  { name: 'left', dx: -1, dy: 0 },
];

function isWalkable(tile) {
  if (tile === ' ' || tile === 'P') {
    return true;
  }

  const numeric = Number.parseInt(tile, 10);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 18;
}

function clonePlayers(players) {
  return players.map((player) => ({ id: player.id, x: player.x, y: player.y }));
}

function stateKey(players, doneCount) {
  const parts = players.map((player) => `${player.id}:${player.x},${player.y}`);
  return `${doneCount}|${parts.join(';')}`;
}

function applyMove(level, players, doneCount, direction) {
  const mutablePlayers = clonePlayers(players);
  let nextDoneCount = doneCount;
  const originalIds = mutablePlayers.map((player) => player.id);

  for (const playerId of originalIds) {
    const index = mutablePlayers.findIndex((player) => player.id === playerId);
    if (index === -1) {
      continue;
    }

    const player = mutablePlayers[index];
    const targetX = player.x + direction.dx;
    const targetY = player.y + direction.dy;
    const targetTile = level.grid[targetY]?.[targetX];

    if (targetTile === undefined) {
      mutablePlayers.splice(index, 1);
      continue;
    }

    if (targetTile === '!') {
      mutablePlayers.splice(index, 1);
      nextDoneCount += 1;
      continue;
    }

    if (targetTile === 'x') {
      return null;
    }

    const occupied = mutablePlayers.some(
      (candidate) => candidate.id !== player.id && candidate.x === targetX && candidate.y === targetY,
    );
    if (!occupied && isWalkable(targetTile)) {
      player.x = targetX;
      player.y = targetY;
    }
  }

  mutablePlayers.sort((left, right) => left.id - right.id);
  return {
    players: mutablePlayers,
    doneCount: nextDoneCount,
  };
}

function reconstructPath(goalKey, parentMap, moveMap) {
  const path = [];
  let key = goalKey;
  while (parentMap.get(key) !== null) {
    path.push(moveMap.get(key));
    key = parentMap.get(key);
  }
  path.reverse();
  return path;
}

export function solveLevel(level, options = {}) {
  const maxMoves = Number.isInteger(options.maxMoves) ? options.maxMoves : 200;
  const maxVisited = Number.isInteger(options.maxVisited) ? options.maxVisited : 500000;

  const initialPlayers = clonePlayers(level.players).sort((left, right) => left.id - right.id);
  const initialDoneCount = 0;
  const initialKey = stateKey(initialPlayers, initialDoneCount);

  const queue = [{ key: initialKey, players: initialPlayers, doneCount: initialDoneCount, depth: 0 }];
  const parentMap = new Map([[initialKey, null]]);
  const moveMap = new Map();
  const depthMap = new Map([[initialKey, 0]]);

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;

    if (current.depth >= maxMoves) {
      continue;
    }

    for (const direction of DIRECTIONS) {
      const transitioned = applyMove(level, current.players, current.doneCount, direction);
      if (!transitioned) {
        continue;
      }

      const nextDepth = current.depth + 1;
      const nextKey = stateKey(transitioned.players, transitioned.doneCount);
      if (depthMap.has(nextKey)) {
        continue;
      }

      depthMap.set(nextKey, nextDepth);
      parentMap.set(nextKey, current.key);
      moveMap.set(nextKey, direction.name);

      if (transitioned.doneCount === level.totalPlayers) {
        return {
          minMoves: nextDepth,
          path: reconstructPath(nextKey, parentMap, moveMap),
          visitedStates: depthMap.size,
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

      queue.push({
        key: nextKey,
        players: transitioned.players,
        doneCount: transitioned.doneCount,
        depth: nextDepth,
      });
    }
  }

  return {
    minMoves: null,
    path: null,
    visitedStates: depthMap.size,
    truncated: false,
  };
}

export function levelModelFromGrid(grid) {
  const players = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x] === 'P') {
        players.push({ id: players.length, x, y });
      }
    }
  }

  return {
    width: grid[0]?.length ?? 0,
    height: grid.length,
    grid,
    players,
    totalPlayers: players.length,
  };
}
