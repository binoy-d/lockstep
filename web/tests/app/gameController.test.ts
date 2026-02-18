import { describe, expect, it, vi } from 'vitest';
import { parseLevelText } from '../../src/core/levelParser';
import { GameController } from '../../src/app/gameController';

function makeSettings() {
  return {
    musicVolume: 0.5,
    sfxVolume: 0.85,
    lightingEnabled: true,
    cameraSwayEnabled: true,
    showFps: false,
    mobileRotateClockwise: false,
  };
}

function makeController() {
  const levels = [
    parseLevelText('map0', ['#####', '#P!##', '#####'].join('\n')),
    parseLevelText('map1', ['#####', '#P ##', '#####'].join('\n')),
  ];

  const controller = new GameController(levels, makeSettings());

  controller.finishIntro();
  return controller;
}

describe('game controller', () => {
  it('starts on intro screen and transitions to main when intro completes', () => {
    const levels = [parseLevelText('map0', ['#####', '#P!##', '#####'].join('\n'))];
    const controller = new GameController(levels, {
      ...makeSettings(),
      musicVolume: 0.4,
    });

    expect(controller.getSnapshot().screen).toBe('intro');
    controller.finishIntro();
    expect(controller.getSnapshot().screen).toBe('main');
  });

  it('switches to editor screen', () => {
    const controller = makeController();
    controller.openEditor();
    expect(controller.getSnapshot().screen).toBe('editor');
  });

  it('routes main menu actions back to intro title screen', () => {
    const controller = makeController();
    controller.openEditor();
    controller.openMainMenu();
    expect(controller.getSnapshot().screen).toBe('intro');

    controller.finishIntro();
    controller.setPlayerName('Ava');
    controller.startSelectedLevel();
    controller.openPauseMenu();
    controller.openMainMenu();
    expect(controller.getSnapshot().screen).toBe('intro');
  });

  it('upserts level and rebuilds playable state', () => {
    const controller = makeController();
    const custom = parseLevelText('custom-level-1', ['#####', '#P !#', '#####'].join('\n'));

    const index = controller.upsertLevel(custom);
    const snapshot = controller.getSnapshot();

    expect(index).toBe(2);
    expect(snapshot.levels).toHaveLength(3);
    expect(snapshot.selectedLevelIndex).toBe(2);
    expect(snapshot.gameState.levelId).toBe('custom-level-1');

    controller.setPlayerName('Tester');
    controller.startLevel(index);
    expect(controller.getSnapshot().screen).toBe('playing');
    expect(controller.getSnapshot().gameState.levelId).toBe('custom-level-1');
  });

  it('updates existing level by id', () => {
    const controller = makeController();
    const replacement = parseLevelText('map1', ['#####', '#P!##', '#####'].join('\n'));

    const index = controller.upsertLevel(replacement);
    expect(index).toBe(1);
    expect(controller.getSnapshot().levels[1].grid[1][2]).toBe('!');
  });

  it('requires a player name before starting gameplay', () => {
    const controller = makeController();

    controller.startSelectedLevel();
    expect(controller.getSnapshot().screen).toBe('main');
    expect(controller.getSnapshot().statusMessage).toMatch(/player name/i);

    controller.setPlayerName('Ava');
    controller.startSelectedLevel();
    expect(controller.getSnapshot().screen).toBe('playing');
  });

  it('shows a level-clear screen, then emits win transition after continue', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    let now = 3000;
    nowSpy.mockImplementation(() => now);

    try {
      const levels = [
        parseLevelText('map0', ['#####', '#P!##', '#####'].join('\n')),
        parseLevelText('map1', ['#####', '#P ##', '#####'].join('\n')),
      ];
      const controller = new GameController(levels, makeSettings());

      controller.finishIntro();
      controller.setPlayerName('Ava');
      controller.startLevel(0);
      controller.queueDirection('right');
      controller.fixedUpdate(16.67);

      const snapshot = controller.getSnapshot();
      expect(snapshot.screen).toBe('level-clear');
      expect(snapshot.levelClearSummary).toMatchObject({
        levelId: 'map0',
        moves: 1,
        isFinalLevel: false,
      });
      expect(snapshot.winTransition).toBeNull();
      expect(snapshot.gameState.levelId).toBe('map0');

      controller.continueAfterLevelClear();
      const continued = controller.getSnapshot();
      expect(continued.screen).toBe('playing');
      expect(continued.gameState.levelId).toBe('map1');
      expect(continued.levelClearSummary).toBeNull();
      expect(continued.winTransition).toMatchObject({
        sourceLevelId: 'map0',
        sourceLevelWidth: 5,
        sourceLevelHeight: 3,
        portal: { x: 2, y: 1 },
        playerId: 0,
      });

      now += (continued.winTransition?.durationMs ?? 0) + 1;
      controller.queueDirection('right');
      controller.fixedUpdate(16.67);
      expect(controller.getSnapshot().winTransition).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('requires player name before opening level select, then allows from intro and pause', () => {
    const levels = [
      parseLevelText('map0', ['#####', '#P!##', '#####'].join('\n')),
      parseLevelText('map1', ['#####', '#P ##', '#####'].join('\n')),
    ];
    const introController = new GameController(levels, makeSettings());

    expect(introController.getSnapshot().screen).toBe('intro');
    introController.openLevelSelect();
    expect(introController.getSnapshot().screen).toBe('intro');
    expect(introController.getSnapshot().statusMessage).toMatch(/player name/i);

    introController.setPlayerName('Ava');
    introController.openLevelSelect();
    expect(introController.getSnapshot().screen).toBe('level-select');
    introController.closeLevelSelect();
    expect(introController.getSnapshot().screen).toBe('intro');

    const controller = makeController();
    controller.setPlayerName('Ava');
    controller.startSelectedLevel();
    controller.openPauseMenu();
    expect(controller.getSnapshot().screen).toBe('paused');

    controller.openLevelSelect();
    expect(controller.getSnapshot().screen).toBe('level-select');

    controller.closeLevelSelect();
    expect(controller.getSnapshot().screen).toBe('paused');
  });

  it('shows final clear summary and returns to main on continue', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(5000);

    try {
      const levels = [parseLevelText('map0', ['#####', '#P!##', '#####'].join('\n'))];
      const controller = new GameController(levels, makeSettings());

      controller.finishIntro();
      controller.setPlayerName('Ava');
      controller.startSelectedLevel();
      controller.queueDirection('right');
      controller.fixedUpdate(16.67);

      const cleared = controller.getSnapshot();
      expect(cleared.screen).toBe('level-clear');
      expect(cleared.levelClearSummary?.isFinalLevel).toBe(true);
      expect(cleared.levelClearSummary?.moves).toBe(1);

      controller.continueAfterLevelClear();
      const finished = controller.getSnapshot();
      expect(finished.screen).toBe('main');
      expect(finished.levelClearSummary).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('shows enemy death animation before applying level reset', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    let now = 1000;
    nowSpy.mockImplementation(() => now);

    try {
      const enemyLevel = parseLevelText('enemy', ['######', '#P12 #', '######'].join('\n'));
      const controller = new GameController([enemyLevel], makeSettings());

      controller.finishIntro();
      controller.setPlayerName('Ava');
      controller.startSelectedLevel();

      controller.queueDirection('right');
      controller.fixedUpdate(16.67);

      const deathSnapshot = controller.getSnapshot();
      expect(deathSnapshot.deathAnimation).not.toBeNull();
      expect(deathSnapshot.gameState.moves).toBe(0);
      expect(deathSnapshot.deathAnimation).toMatchObject({
        kind: 'enemy',
        playerId: 0,
        enemyId: 0,
        intersection: { x: 2, y: 1 },
      });

      const waitMs = deathSnapshot.deathAnimation?.durationMs ?? 0;
      now += waitMs - 1;
      controller.fixedUpdate(16.67);
      expect(controller.getSnapshot().gameState.moves).toBe(0);

      now += 2;
      controller.fixedUpdate(16.67);
      const resetSnapshot = controller.getSnapshot();
      expect(resetSnapshot.deathAnimation).toBeNull();
      expect(resetSnapshot.gameState.lastEvent).toBe('level-reset');
      expect(resetSnapshot.gameState.moves).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('shows lava death animation before applying level reset', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    let now = 2000;
    nowSpy.mockImplementation(() => now);

    try {
      const lavaLevel = parseLevelText('lava', ['#####', '#Px #', '#####'].join('\n'));
      const controller = new GameController([lavaLevel], makeSettings());

      controller.finishIntro();
      controller.setPlayerName('Ava');
      controller.startSelectedLevel();

      controller.queueDirection('right');
      controller.fixedUpdate(16.67);

      const deathSnapshot = controller.getSnapshot();
      expect(deathSnapshot.deathAnimation).not.toBeNull();
      expect(deathSnapshot.deathAnimation).toMatchObject({
        kind: 'lava',
        playerId: 0,
        intersection: { x: 2, y: 1 },
      });
      expect(deathSnapshot.statusMessage).toMatch(/lava/i);

      const waitMs = deathSnapshot.deathAnimation?.durationMs ?? 0;
      now += waitMs + 1;
      controller.fixedUpdate(16.67);

      const resetSnapshot = controller.getSnapshot();
      expect(resetSnapshot.deathAnimation).toBeNull();
      expect(resetSnapshot.gameState.lastEvent).toBe('level-reset');
      expect(resetSnapshot.gameState.moves).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
