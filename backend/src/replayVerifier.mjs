const REPLAY_MAX_MOVES = 10000;

const DIRECTION_VECTORS = {
  u: { x: 0, y: -1 },
  d: { x: 0, y: 1 },
  l: { x: -1, y: 0 },
  r: { x: 1, y: 0 },
};

function parseLevelGrid(levelText) {
  if (typeof levelText !== 'string') {
    throw new Error('Level data is invalid.');
  }

  const lines = levelText.replace(/\r/g, '').split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    throw new Error('Level data is empty.');
  }

  const width = lines[0].length;
  if (width <= 0) {
    throw new Error('Level width is invalid.');
  }

  const grid = [];
  const players = [];
  const enemies = [];

  for (let y = 0; y < lines.length; y += 1) {
    const line = lines[y];
    if (line.length !== width) {
      throw new Error('Level rows have inconsistent widths.');
    }

    const row = [];
    for (let x = 0; x < line.length; x += 1) {
      const tile = line[x];
      row.push(tile);
      if (tile === 'P') {
        players.push({ id: players.length, x, y });
        continue;
      }

      if (tile === '1') {
        enemies.push({ id: enemies.length, x, y });
      }
    }
    grid.push(row);
  }

  if (players.length === 0) {
    throw new Error('Level has no players.');
  }

  return {
    grid,
    players,
    enemies,
    totalPlayers: players.length,
    playersDone: 0,
  };
}

function isWalkable(tileValue) {
  if (tileValue === ' ' || tileValue === 'P') {
    return true;
  }

  const numeric = Number.parseInt(tileValue, 10);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 18;
}

function hasEnemyTouch(state) {
  return state.players.some((player) => state.enemies.some((enemy) => enemy.x === player.x && enemy.y === player.y));
}

function playerOccupies(state, x, y, ignoreId) {
  return state.players.some((player) => player.id !== ignoreId && player.x === x && player.y === y);
}

function runPlayerPhase(state, replayMove) {
  const vector = DIRECTION_VECTORS[replayMove];
  if (!vector) {
    return 'invalid';
  }

  for (const original of [...state.players]) {
    const playerIndex = state.players.findIndex((player) => player.id === original.id);
    if (playerIndex === -1) {
      continue;
    }

    const player = state.players[playerIndex];
    const targetX = player.x + vector.x;
    const targetY = player.y + vector.y;
    const targetTile = state.grid[targetY]?.[targetX];

    if (targetTile === undefined) {
      state.players.splice(playerIndex, 1);
      continue;
    }

    if (isWalkable(targetTile) && !playerOccupies(state, targetX, targetY, player.id)) {
      player.x = targetX;
      player.y = targetY;
    } else if (targetTile === '!') {
      state.playersDone += 1;
      state.players.splice(playerIndex, 1);
      if (state.playersDone >= state.totalPlayers) {
        return 'cleared';
      }
      continue;
    } else if (targetTile === 'x') {
      return 'reset';
    }

    if (state.enemies.some((enemy) => enemy.x === player.x && enemy.y === player.y)) {
      return 'reset';
    }
  }

  return 'playing';
}

function enemyTick(state, enemy) {
  const currentRaw = state.grid[enemy.y]?.[enemy.x];
  const parsedCurrent = Number.parseInt(currentRaw, 10);
  if (!Number.isInteger(parsedCurrent)) {
    return;
  }

  let currentValue = parsedCurrent;
  let moved = false;

  for (let row = enemy.y - 1; row <= enemy.y + 1 && !moved; row += 1) {
    for (let col = enemy.x - 1; col <= enemy.x + 1 && !moved; col += 1) {
      const candidate = state.grid[row]?.[col];
      const newValue = Number.parseInt(candidate ?? '', 10);
      if (Number.isInteger(newValue) && newValue - 1 === currentValue) {
        state.grid[enemy.y][enemy.x] = String(18 - currentValue);
        enemy.x = col;
        enemy.y = row;
        moved = true;
      }

      if (currentValue === 17) {
        currentValue = 1;
      }
    }
  }
}

function runEnemyPhase(state) {
  if (hasEnemyTouch(state)) {
    return 'reset';
  }

  for (const enemy of state.enemies) {
    enemyTick(state, enemy);
    if (hasEnemyTouch(state)) {
      return 'reset';
    }
  }

  if (hasEnemyTouch(state)) {
    return 'reset';
  }

  return 'playing';
}

export function validateReplayInput(input) {
  if (typeof input !== 'string') {
    throw new Error('Replay must be a string.');
  }

  const rawReplay = input.trim().toLowerCase();
  if (rawReplay.length === 0) {
    throw new Error('Replay cannot be empty.');
  }

  let replay = '';
  let consumed = 0;
  const tokenRe = /(\d*)([udlr])/g;

  for (let token = tokenRe.exec(rawReplay); token; token = tokenRe.exec(rawReplay)) {
    if (token.index !== consumed) {
      throw new Error('Replay must use only U, D, L, R moves, with optional counts like 6d.');
    }
    consumed = tokenRe.lastIndex;

    const runLengthText = token[1];
    const direction = token[2];
    const runLength = runLengthText.length === 0 ? 1 : Number.parseInt(runLengthText, 10);

    if (!Number.isInteger(runLength) || runLength <= 0) {
      throw new Error('Replay run length must be a positive integer.');
    }

    if (replay.length + runLength > REPLAY_MAX_MOVES) {
      throw new Error(`Replay cannot exceed ${REPLAY_MAX_MOVES} moves.`);
    }

    replay += direction.repeat(runLength);
  }

  if (consumed !== rawReplay.length || replay.length === 0) {
    throw new Error('Replay must use only U, D, L, R moves, with optional counts like 6d.');
  }

  return replay;
}

export function verifyReplayClearsLevel(levelText, replayInput) {
  const replay = validateReplayInput(replayInput);
  const state = parseLevelGrid(levelText);

  for (let index = 0; index < replay.length; index += 1) {
    if (hasEnemyTouch(state)) {
      return { ok: false, moves: index + 1 };
    }

    const playerResult = runPlayerPhase(state, replay[index]);
    if (playerResult === 'invalid' || playerResult === 'reset') {
      return { ok: false, moves: index + 1 };
    }
    if (playerResult === 'cleared') {
      return { ok: true, moves: index + 1 };
    }

    const enemyResult = runEnemyPhase(state);
    if (enemyResult === 'reset') {
      return { ok: false, moves: index + 1 };
    }
  }

  return { ok: false, moves: replay.length };
}
