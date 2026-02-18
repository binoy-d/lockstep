import { beforeEach, describe, expect, it, vi } from 'vitest';

const { submitScoreMock } = vi.hoisted(() => ({
  submitScoreMock: vi.fn(),
}));

vi.mock('../../src/runtime/backendApi', () => ({
  submitScore: submitScoreMock,
}));

import { GameController } from '../../src/app/gameController';
import { parseLevelText } from '../../src/core/levelParser';
import { submitScore } from '../../src/runtime/backendApi';

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
  const mockedSubmitScore = vi.mocked(submitScore);

  beforeEach(() => {
    mockedSubmitScore.mockReset();
    mockedSubmitScore.mockResolvedValue([]);
  });

  /**
   * Validates initial app lifecycle transitions used by the intro cinematic.
   */
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

  /**
   * Ensures the editor entrypoint can be opened from the main menu.
   */
  it('switches to editor screen', () => {
    const controller = makeController();
    controller.openEditor();
    expect(controller.getSnapshot().screen).toBe('editor');
  });

  /**
   * Verifies returning to the intro screen from both editor and gameplay states.
   */
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

  /**
   * Confirms custom level publish flow rewires playable state to the saved level.
   */
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

  /**
   * Protects against duplicate level IDs creating broken parallel entries.
   */
  it('updates existing level by id', () => {
    const controller = makeController();
    const replacement = parseLevelText('map1', ['#####', '#P!##', '#####'].join('\n'));

    const index = controller.upsertLevel(replacement);
    expect(index).toBe(1);
    expect(controller.getSnapshot().levels[1].grid[1][2]).toBe('!');
  });

  /**
   * Guards gameplay start behind a player identity to keep score submissions valid.
   */
  it('requires a player name before starting gameplay', () => {
    const controller = makeController();

    controller.startSelectedLevel();
    expect(controller.getSnapshot().screen).toBe('main');
    expect(controller.getSnapshot().statusMessage).toMatch(/player name/i);

    controller.setPlayerName('Ava');
    controller.startSelectedLevel();
    expect(controller.getSnapshot().screen).toBe('playing');
  });

  /**
   * Ensures level clear transitions preserve animation metadata before the next level starts.
   */
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

  /**
   * Verifies level select constraints and return-to-origin behavior from intro and pause.
   */
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

  /**
   * Checks final-level completion state exits to main menu with summary text.
   */
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

  /**
   * Ensures enemy collisions animate before state reset and preserve impact metadata.
   */
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

  /**
   * Ensures lava collisions follow the same delayed reset behavior as enemy impacts.
   */
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

  /**
   * Prevents deep-link level-select navigation from interrupting live gameplay states.
   */
  it('ignores deep-link level-select requests from playing and paused screens', () => {
    const controller = makeController();
    controller.setPlayerName('Ava');
    controller.startSelectedLevel();
    expect(controller.getSnapshot().screen).toBe('playing');

    controller.openLevelSelectFromDeepLink('from-link');
    expect(controller.getSnapshot().screen).toBe('playing');

    controller.openPauseMenu();
    expect(controller.getSnapshot().screen).toBe('paused');
    controller.openLevelSelectFromDeepLink('from-link');
    expect(controller.getSnapshot().screen).toBe('paused');
  });

  /**
   * Validates index clamping so external UI callers cannot select invalid levels.
   */
  it('clamps selected level index updates to the valid range', () => {
    const controller = makeController();
    controller.setSelectedLevel(-99);
    expect(controller.getSnapshot().selectedLevelIndex).toBe(0);

    controller.setSelectedLevel(999);
    expect(controller.getSnapshot().selectedLevelIndex).toBe(1);
  });

  /**
   * Confirms pause toggling only applies to gameplay screens and leaves menus untouched.
   */
  it('toggles pause only while actively playing', () => {
    const controller = makeController();

    controller.togglePause();
    expect(controller.getSnapshot().screen).toBe('main');

    controller.setPlayerName('Ava');
    controller.startSelectedLevel();
    expect(controller.getSnapshot().screen).toBe('playing');

    controller.togglePause();
    expect(controller.getSnapshot().screen).toBe('paused');

    controller.togglePause();
    expect(controller.getSnapshot().screen).toBe('playing');
  });

  /**
   * Verifies replay action restarts the exact cleared level instead of advancing.
   */
  it('restarts the cleared level when replay is requested from level-clear screen', () => {
    const controller = makeController();
    controller.setPlayerName('Ava');
    controller.startLevel(0);
    controller.queueDirection('right');
    controller.fixedUpdate(16.67);
    expect(controller.getSnapshot().screen).toBe('level-clear');

    controller.replayClearedLevel();
    const replaySnapshot = controller.getSnapshot();
    expect(replaySnapshot.screen).toBe('playing');
    expect(replaySnapshot.gameState.levelId).toBe('map0');
    expect(replaySnapshot.gameState.moves).toBe(0);
  });

  /**
   * Ensures input buffering caps at four queued moves and replay compression reflects that cap.
   */
  it('limits queued input to four moves and compresses replay payloads', async () => {
    const level = parseLevelText('queue-level', ['########', '#P   !##', '########'].join('\n'));
    const controller = new GameController([level], makeSettings());
    controller.finishIntro();
    controller.setPlayerName('Ava');
    controller.startSelectedLevel();

    controller.queueDirection('right');
    controller.queueDirection('right');
    controller.queueDirection('right');
    controller.queueDirection('right');
    controller.queueDirection('right');

    for (let i = 0; i < 6; i += 1) {
      controller.fixedUpdate(16.67);
    }

    const snapshot = controller.getSnapshot();
    expect(snapshot.screen).toBe('level-clear');
    expect(snapshot.levelClearSummary?.moves).toBe(4);

    await controller.waitForPendingScoreSubmissions();
    expect(mockedSubmitScore).toHaveBeenCalledTimes(1);
    expect(mockedSubmitScore).toHaveBeenCalledWith(
      expect.objectContaining({
        levelId: 'queue-level',
        moves: 4,
        replay: '4r',
      }),
    );
  });

  /**
   * Protects level deletion edge cases where removal should be rejected.
   */
  it('returns false when deleting a missing level or the final remaining level', () => {
    const singleLevel = new GameController(
      [parseLevelText('solo', ['#####', '#P!##', '#####'].join('\n'))],
      makeSettings(),
    );
    singleLevel.finishIntro();

    expect(singleLevel.removeLevel('missing')).toBe(false);
    expect(singleLevel.removeLevel('solo')).toBe(false);

    const controller = makeController();
    expect(controller.removeLevel('missing')).toBe(false);
  });

  /**
   * Ensures deleting an active level resets runtime state back to a safe menu screen.
   */
  it('returns to intro and resets state when deleting a level mid-run', () => {
    const controller = makeController();
    controller.setPlayerName('Ava');
    controller.startLevel(1);
    expect(controller.getSnapshot().screen).toBe('playing');
    expect(controller.getSnapshot().gameState.levelId).toBe('map1');

    expect(controller.removeLevel('map1')).toBe(true);
    const snapshot = controller.getSnapshot();
    expect(snapshot.screen).toBe('intro');
    expect(snapshot.levels).toHaveLength(1);
    expect(snapshot.gameState.levelId).toBe('map0');
    expect(snapshot.selectedLevelIndex).toBe(0);
  });

  /**
   * Confirms asynchronous score writes are surfaced to subscribers once they complete.
   */
  it('waits for pending score submissions and exposes the latest submitted scoreboard', async () => {
    mockedSubmitScore.mockResolvedValueOnce([
      {
        playerName: 'Ava',
        moves: 1,
        durationMs: 600,
        createdAt: Date.now(),
      },
    ]);

    const controller = makeController();
    controller.setPlayerName('Ava');
    controller.startLevel(0);
    controller.queueDirection('right');
    controller.fixedUpdate(16.67);

    expect(controller.getSnapshot().latestSubmittedScore).toBeNull();
    await controller.waitForPendingScoreSubmissions();

    expect(mockedSubmitScore).toHaveBeenCalledWith(
      expect.objectContaining({
        levelId: 'map0',
        moves: 1,
        replay: 'r',
      }),
    );

    const submitted = controller.getSnapshot().latestSubmittedScore;
    expect(submitted).toMatchObject({
      sequence: 1,
      levelId: 'map0',
      moves: 1,
      scores: [
        {
          playerName: 'Ava',
          moves: 1,
          durationMs: 600,
        },
      ],
    });
  });

  /**
   * Ensures failed score submissions stay non-fatal and do not publish stale score snapshots.
   */
  it('swallows score API failures without writing latest submitted score metadata', async () => {
    mockedSubmitScore.mockRejectedValueOnce(new Error('backend down'));

    const controller = makeController();
    controller.setPlayerName('Ava');
    controller.startLevel(0);
    controller.queueDirection('right');
    controller.fixedUpdate(16.67);

    await controller.waitForPendingScoreSubmissions();
    expect(controller.getSnapshot().latestSubmittedScore).toBeNull();
  });

  /**
   * Verifies every successful submission increments a sequence counter for UI reconciliation.
   */
  it('increments the score submission sequence across multiple clears', async () => {
    mockedSubmitScore
      .mockResolvedValueOnce([
        { playerName: 'Ava', moves: 1, durationMs: 500, createdAt: 1 },
      ])
      .mockResolvedValueOnce([
        { playerName: 'Ava', moves: 1, durationMs: 450, createdAt: 2 },
      ]);

    const controller = makeController();
    controller.setPlayerName('Ava');
    controller.startLevel(0);

    controller.queueDirection('right');
    controller.fixedUpdate(16.67);
    await controller.waitForPendingScoreSubmissions();
    expect(controller.getSnapshot().latestSubmittedScore?.sequence).toBe(1);

    controller.replayClearedLevel();
    controller.queueDirection('right');
    controller.fixedUpdate(16.67);
    await controller.waitForPendingScoreSubmissions();

    const latest = controller.getSnapshot().latestSubmittedScore;
    expect(latest?.sequence).toBe(2);
    expect(latest?.scores[0].durationMs).toBe(450);
    expect(mockedSubmitScore).toHaveBeenCalledTimes(2);
  });
});
