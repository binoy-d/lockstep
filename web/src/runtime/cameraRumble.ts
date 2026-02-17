import type { Screen } from '../app/gameController';
import type { GameState, TurnEvent } from '../core/types';

export interface CameraSwayImpulse {
  x: number;
  y: number;
}

const SWAY_BY_EVENT: Partial<Record<TurnEvent, CameraSwayImpulse>> = {
  'level-reset': { x: 0, y: 0.85 },
  'level-advanced': { x: 0, y: -0.7 },
  'game-complete': { x: 0, y: -0.9 },
};

function centroid(state: GameState): { x: number; y: number } | null {
  if (state.players.length === 0) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  for (const player of state.players) {
    sumX += player.x;
    sumY += player.y;
  }

  return {
    x: sumX / state.players.length,
    y: sumY / state.players.length,
  };
}

export function resolveCameraSwayImpulse(
  screen: Screen,
  previousState: GameState | null,
  nextState: GameState,
): CameraSwayImpulse | null {
  if (screen !== 'playing') {
    return null;
  }

  if (!previousState || previousState === nextState) {
    return null;
  }

  if (nextState.lastEvent === 'turn-processed') {
    const previousCenter = centroid(previousState);
    const nextCenter = centroid(nextState);
    if (!previousCenter || !nextCenter) {
      return null;
    }

    const dx = nextCenter.x - previousCenter.x;
    const dy = nextCenter.y - previousCenter.y;
    if (dx === 0 && dy === 0) {
      return null;
    }

    return { x: dx, y: dy };
  }

  return SWAY_BY_EVENT[nextState.lastEvent] ?? null;
}
