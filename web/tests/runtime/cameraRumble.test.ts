import { describe, expect, it } from 'vitest';
import { createInitialState, parseLevelText } from '../../src/core';
import { resolveCameraSwayImpulse } from '../../src/runtime/cameraRumble';
import type { GameState, TurnEvent } from '../../src/core/types';

function makeState(): GameState {
  const level = parseLevelText('map0', ['#####', '#P !#', '#####'].join('\n'));
  return createInitialState([level], 0);
}

function withEvent(state: GameState, lastEvent: TurnEvent): GameState {
  return {
    ...state,
    lastEvent,
  };
}

describe('camera sway', () => {
  it('does not produce sway outside gameplay screen', () => {
    const base = makeState();
    const next = withEvent(base, 'turn-processed');
    expect(resolveCameraSwayImpulse('paused', base, next)).toBeNull();
    expect(resolveCameraSwayImpulse('main', base, next)).toBeNull();
  });

  it('does not produce sway without state transition', () => {
    const base = makeState();
    expect(resolveCameraSwayImpulse('playing', null, base)).toBeNull();
    expect(resolveCameraSwayImpulse('playing', base, base)).toBeNull();
  });

  it('maps non-movement events to sway impulses', () => {
    const base = makeState();

    expect(resolveCameraSwayImpulse('playing', base, withEvent(base, 'level-reset'))).toEqual({
      x: 0,
      y: 0.85,
    });
    expect(resolveCameraSwayImpulse('playing', base, withEvent(base, 'level-advanced'))).toEqual({
      x: 0,
      y: -0.7,
    });
    expect(resolveCameraSwayImpulse('playing', base, withEvent(base, 'game-complete'))).toEqual({
      x: 0,
      y: -0.9,
    });
    expect(resolveCameraSwayImpulse('playing', base, withEvent(base, 'none'))).toBeNull();
  });

  it('uses centroid movement for turn-processed sway direction', () => {
    const base = makeState();
    const moved = {
      ...base,
      players: base.players.map((player) => ({ ...player, x: player.x + 1 })),
      lastEvent: 'turn-processed' as const,
    };

    expect(resolveCameraSwayImpulse('playing', base, moved)).toEqual({ x: 1, y: 0 });
  });
});
