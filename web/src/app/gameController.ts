import { createInitialState, restartLevel, setLevel, update } from '../core';
import type { Direction, GameState, ParsedLevel } from '../core';
import { submitScore } from '../runtime/backendApi';
import { saveSettings, type GameSettings } from '../runtime/settingsStorage';
import {
  detectEnemyImpact,
  detectGoalFinishImpact,
  detectLavaImpact,
  type EnemyImpact,
  type LavaImpact,
} from './deathImpact';

export type Screen = 'intro' | 'main' | 'level-select' | 'settings' | 'editor' | 'playing' | 'paused' | 'level-clear';

const DEATH_ANIMATION_MS = 620;
const WIN_TRANSITION_MS = 980;

function directionToReplayMove(direction: Direction): string {
  switch (direction) {
    case 'up':
      return 'u';
    case 'down':
      return 'd';
    case 'left':
      return 'l';
    case 'right':
      return 'r';
  }
}

export interface EnemyDeathAnimationSnapshot extends EnemyImpact {
  kind: 'enemy';
  sequence: number;
  startedAtMs: number;
  durationMs: number;
}

export interface LavaDeathAnimationSnapshot extends LavaImpact {
  kind: 'lava';
  sequence: number;
  startedAtMs: number;
  durationMs: number;
}

export type DeathAnimationSnapshot = EnemyDeathAnimationSnapshot | LavaDeathAnimationSnapshot;

export interface WinTransitionSnapshot {
  sequence: number;
  startedAtMs: number;
  durationMs: number;
  completedMoves: number;
  completedDurationMs: number;
  sourceLevelId: string;
  sourceLevelWidth: number;
  sourceLevelHeight: number;
  portal: {
    x: number;
    y: number;
  };
  playerId: number;
}

export interface LevelClearSummarySnapshot {
  levelId: string;
  levelIndex: number;
  moves: number;
  durationMs: number;
  isFinalLevel: boolean;
  nextLevelIndex: number | null;
}

interface PendingLevelAdvance {
  nextState: GameState;
  transition: Omit<WinTransitionSnapshot, 'sequence' | 'startedAtMs' | 'durationMs'> | null;
}

export interface ControllerSnapshot {
  screen: Screen;
  gameState: GameState;
  levels: ParsedLevel[];
  settings: GameSettings;
  selectedLevelIndex: number;
  playerName: string;
  statusMessage: string | null;
  deathAnimation: DeathAnimationSnapshot | null;
  winTransition: WinTransitionSnapshot | null;
  levelClearSummary: LevelClearSummarySnapshot | null;
}

type Subscriber = (snapshot: ControllerSnapshot) => void;

export class GameController {
  private levels: ParsedLevel[];

  private gameState: GameState;

  private settings: GameSettings;

  private screen: Screen = 'intro';

  private selectedLevelIndex = 0;

  private statusMessage: string | null = null;

  private readonly inputQueue: Direction[] = [];

  private readonly subscribers = new Set<Subscriber>();

  private settingsReturnScreen: Screen = 'main';

  private levelSelectReturnScreen: Screen = 'main';

  private playerName = '';

  private levelStartedAtMs = Date.now();

  private pendingResetState: GameState | null = null;

  private pendingResetDeadlineMs = 0;

  private deathAnimation: DeathAnimationSnapshot | null = null;

  private deathAnimationSequence = 0;

  private winTransition: WinTransitionSnapshot | null = null;

  private winTransitionSequence = 0;

  private levelClearSummary: LevelClearSummarySnapshot | null = null;

  private pendingLevelAdvance: PendingLevelAdvance | null = null;

  private currentRunReplay: string[] = [];

  private readonly pendingScoreSubmissions = new Set<Promise<void>>();

  public constructor(levels: ParsedLevel[], settings: GameSettings) {
    if (levels.length === 0) {
      throw new Error('Cannot initialize controller without levels.');
    }

    this.levels = levels.slice();
    this.settings = settings;
    this.gameState = createInitialState(this.levels, 0);
  }

  public subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getSnapshot());
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  public getSnapshot(): ControllerSnapshot {
    return {
      screen: this.screen,
      gameState: this.gameState,
      levels: this.levels,
      settings: this.settings,
      selectedLevelIndex: this.selectedLevelIndex,
      playerName: this.playerName,
      statusMessage: this.statusMessage,
      deathAnimation: this.deathAnimation,
      winTransition: this.winTransition,
      levelClearSummary: this.levelClearSummary,
    };
  }

  public startSelectedLevel(): void {
    this.startLevel(this.selectedLevelIndex);
  }

  public startLevel(levelIndex: number): void {
    if (!this.playerName) {
      this.statusMessage = 'Enter a player name before playing.';
      this.emit();
      return;
    }

    const clamped = Math.max(0, Math.min(levelIndex, this.levels.length - 1));
    this.selectedLevelIndex = clamped;
    this.gameState = setLevel(this.gameState, clamped);
    this.screen = 'playing';
    this.statusMessage = null;
    this.inputQueue.length = 0;
    this.currentRunReplay = [];
    this.clearLevelClearState();
    this.levelStartedAtMs = Date.now();
    this.clearTransientEffects();
    this.emit();
  }

  public openMainMenu(): void {
    this.screen = 'intro';
    this.inputQueue.length = 0;
    this.currentRunReplay = [];
    this.clearLevelClearState();
    this.clearTransientEffects();
    this.emit();
  }

  public finishIntro(): void {
    if (this.screen !== 'intro') {
      return;
    }

    this.screen = 'main';
    this.emit();
  }

  public openEditor(): void {
    this.screen = 'editor';
    this.inputQueue.length = 0;
    this.currentRunReplay = [];
    this.clearLevelClearState();
    this.clearTransientEffects();
    this.emit();
  }

  public openLevelSelect(): boolean {
    if (this.screen !== 'paused' && this.screen !== 'intro') {
      return false;
    }

    if (!this.playerName) {
      this.statusMessage = 'Enter a player name before opening level select.';
      this.emit();
      return false;
    }

    this.levelSelectReturnScreen = this.screen;
    this.screen = 'level-select';
    this.emit();
    return true;
  }

  public openLevelSelectFromDeepLink(message?: string): void {
    if (this.screen !== 'intro' && this.screen !== 'main' && this.screen !== 'level-select') {
      return;
    }

    if (this.screen !== 'level-select') {
      this.levelSelectReturnScreen = this.screen;
    }

    this.screen = 'level-select';
    if (message) {
      this.statusMessage = message;
    }
    this.emit();
  }

  public closeLevelSelect(): void {
    if (this.screen !== 'level-select') {
      return;
    }

    this.screen = this.levelSelectReturnScreen;
    this.emit();
  }

  public openSettings(): void {
    this.settingsReturnScreen = this.screen;
    this.screen = 'settings';
    this.emit();
  }

  public closeSettings(): void {
    this.screen = this.settingsReturnScreen;
    this.emit();
  }

  public togglePause(): void {
    if (this.screen === 'playing') {
      this.screen = 'paused';
      this.emit();
      return;
    }

    if (this.screen === 'paused') {
      this.screen = 'playing';
      this.emit();
    }
  }

  public openPauseMenu(): void {
    if (this.screen !== 'playing') {
      return;
    }

    this.screen = 'paused';
    this.emit();
  }

  public restartCurrentLevel(): void {
    this.gameState = restartLevel(this.gameState);
    this.screen = 'playing';
    this.statusMessage = null;
    this.inputQueue.length = 0;
    this.currentRunReplay = [];
    this.clearLevelClearState();
    this.levelStartedAtMs = Date.now();
    this.clearTransientEffects();
    this.emit();
  }

  public replayClearedLevel(): void {
    if (this.screen !== 'level-clear' || !this.levelClearSummary) {
      return;
    }

    const levelIndex = this.levelClearSummary.levelIndex;
    this.selectedLevelIndex = levelIndex;
    this.gameState = setLevel(this.gameState, levelIndex);
    this.screen = 'playing';
    this.statusMessage = null;
    this.inputQueue.length = 0;
    this.currentRunReplay = [];
    this.levelStartedAtMs = Date.now();
    this.clearLevelClearState();
    this.clearTransientEffects();
    this.emit();
  }

  public continueAfterLevelClear(): void {
    if (this.screen !== 'level-clear' || !this.levelClearSummary) {
      return;
    }

    const summary = this.levelClearSummary;
    if (summary.isFinalLevel || !this.pendingLevelAdvance) {
      this.screen = 'main';
      this.statusMessage = `All levels complete. Final clear: ${summary.moves} moves in ${(summary.durationMs / 1000).toFixed(1)}s.`;
      this.selectedLevelIndex = summary.levelIndex;
      this.inputQueue.length = 0;
      this.currentRunReplay = [];
      this.clearLevelClearState();
      this.clearTransientEffects();
      this.emit();
      return;
    }

    const nowMs = Date.now();
    const pendingAdvance = this.pendingLevelAdvance;
    this.gameState = pendingAdvance.nextState;
    this.selectedLevelIndex = pendingAdvance.nextState.levelIndex;
    this.screen = 'playing';
    this.statusMessage = null;
    this.inputQueue.length = 0;
    this.currentRunReplay = [];
    this.levelStartedAtMs = nowMs;
    this.clearLevelClearState();
    this.clearTransientEffects();
    if (pendingAdvance.transition) {
      this.winTransitionSequence += 1;
      this.winTransition = {
        ...pendingAdvance.transition,
        sequence: this.winTransitionSequence,
        startedAtMs: nowMs,
        durationMs: WIN_TRANSITION_MS,
      };
    }
    this.emit();
  }

  public queueDirection(direction: Direction): void {
    if (this.screen !== 'playing') {
      return;
    }

    if (this.pendingResetState) {
      return;
    }

    if (this.inputQueue.length >= 4) {
      return;
    }

    this.inputQueue.push(direction);
  }

  public fixedUpdate(dtMs: number): void {
    if (this.screen !== 'playing') {
      return;
    }

    const nowMs = Date.now();
    if (this.winTransition && nowMs >= this.winTransition.startedAtMs + this.winTransition.durationMs) {
      this.winTransition = null;
    }

    if (this.pendingResetState) {
      if (nowMs >= this.pendingResetDeadlineMs) {
        this.gameState = this.pendingResetState;
        this.levelStartedAtMs = nowMs;
        this.currentRunReplay = [];
        this.clearTransientEffects();
        this.emit();
      }
      return;
    }

    const direction = this.inputQueue.shift() ?? null;
    if (!direction) {
      return;
    }

    const previous = this.gameState;
    const completedLevelId = previous.levelId;
    const completedLevelIndex = previous.levelIndex;
    const completedMoves = previous.moves + 1;
    this.currentRunReplay.push(directionToReplayMove(direction));
    const replayForAttempt = this.currentRunReplay.join('');

    const next = update(previous, { direction }, dtMs);
    if (next.lastEvent === 'level-reset') {
      const enemyImpact = detectEnemyImpact(previous, direction);
      if (enemyImpact) {
        this.queueDeathReset(next, nowMs, {
          kind: 'enemy',
          ...enemyImpact,
        });
        this.statusMessage = `Player ${enemyImpact.playerId + 1} hit enemy ${enemyImpact.enemyId + 1}.`;
        this.emit();
        return;
      }

      const lavaImpact = detectLavaImpact(previous, direction);
      if (lavaImpact) {
        this.queueDeathReset(next, nowMs, {
          kind: 'lava',
          ...lavaImpact,
        });
        this.statusMessage = `Player ${lavaImpact.playerId + 1} fell into lava.`;
        this.emit();
        return;
      }
    }

    this.deathAnimation = null;

    if (next.lastEvent === 'level-advanced') {
      const durationMs = Math.max(0, nowMs - this.levelStartedAtMs);
      const finishImpact = detectGoalFinishImpact(previous, direction);
      let pendingTransition: PendingLevelAdvance['transition'] = null;
      const sourceLevel = previous.levels[previous.levelId];
      if (sourceLevel) {
        const fallbackPortal =
          sourceLevel.grid
            .flatMap((row, y) => row.map((tile, x) => ({ tile, x, y })))
            .find((cell) => cell.tile === '!') ?? null;

        const portal = finishImpact?.portal ?? (fallbackPortal ? { x: fallbackPortal.x, y: fallbackPortal.y } : null);
        if (portal) {
          pendingTransition = {
            completedMoves,
            completedDurationMs: durationMs,
            sourceLevelId: previous.levelId,
            sourceLevelWidth: sourceLevel.width,
            sourceLevelHeight: sourceLevel.height,
            portal,
            playerId: finishImpact?.playerId ?? 0,
          };
        }
      }

      this.pendingLevelAdvance = {
        nextState: next,
        transition: pendingTransition,
      };
      this.levelClearSummary = {
        levelId: completedLevelId,
        levelIndex: completedLevelIndex,
        moves: completedMoves,
        durationMs,
        isFinalLevel: false,
        nextLevelIndex: next.levelIndex,
      };
      this.screen = 'level-clear';
      this.statusMessage = `Level clear: ${completedMoves} moves in ${(durationMs / 1000).toFixed(1)}s.`;
      this.inputQueue.length = 0;
      this.currentRunReplay = [];
      this.gameState = previous;
      this.queueScoreSubmission(completedLevelId, completedMoves, durationMs, replayForAttempt);
      this.emit();
      return;
    }

    if (next.status === 'game-complete') {
      const finalMoves = next.moves;
      const durationMs = Math.max(0, nowMs - this.levelStartedAtMs);
      this.pendingLevelAdvance = null;
      this.levelClearSummary = {
        levelId: completedLevelId,
        levelIndex: completedLevelIndex,
        moves: finalMoves,
        durationMs,
        isFinalLevel: true,
        nextLevelIndex: null,
      };
      this.screen = 'level-clear';
      this.statusMessage = `All levels complete. Final clear: ${finalMoves} moves in ${(durationMs / 1000).toFixed(1)}s.`;
      this.inputQueue.length = 0;
      this.currentRunReplay = [];
      this.gameState = previous;
      this.queueScoreSubmission(completedLevelId, finalMoves, durationMs, replayForAttempt);
      this.emit();
      return;
    }

    this.gameState = next;
    if (next.lastEvent === 'level-reset') {
      this.levelStartedAtMs = nowMs;
      this.currentRunReplay = [];
    }

    this.emit();
  }

  public setSelectedLevel(levelIndex: number): void {
    const clamped = Math.max(0, Math.min(levelIndex, this.levels.length - 1));
    this.selectedLevelIndex = clamped;
    this.emit();
  }

  public setPlayerName(name: string): void {
    this.playerName = name.trim().slice(0, 32);
    this.emit();
  }

  public getPlayerName(): string {
    return this.playerName;
  }

  public async waitForPendingScoreSubmissions(): Promise<void> {
    if (this.pendingScoreSubmissions.size === 0) {
      return;
    }

    await Promise.allSettled(Array.from(this.pendingScoreSubmissions));
  }

  public upsertLevel(level: ParsedLevel): number {
    const existingIndex = this.levels.findIndex((entry) => entry.id === level.id);
    if (existingIndex === -1) {
      this.levels.push(level);
    } else {
      this.levels[existingIndex] = level;
    }

    const levelIndex = existingIndex === -1 ? this.levels.length - 1 : existingIndex;
    this.selectedLevelIndex = levelIndex;
    this.gameState = createInitialState(this.levels, levelIndex);
    this.statusMessage = `Saved level ${level.id}`;
    this.levelStartedAtMs = Date.now();
    this.currentRunReplay = [];
    this.clearLevelClearState();
    this.clearTransientEffects();
    this.emit();
    return levelIndex;
  }

  public removeLevel(levelId: string): boolean {
    const index = this.levels.findIndex((entry) => entry.id === levelId);
    if (index === -1 || this.levels.length <= 1) {
      return false;
    }

    this.levels.splice(index, 1);

    if (this.selectedLevelIndex > index) {
      this.selectedLevelIndex -= 1;
    } else if (this.selectedLevelIndex >= this.levels.length) {
      this.selectedLevelIndex = this.levels.length - 1;
    }

    this.selectedLevelIndex = Math.max(0, this.selectedLevelIndex);
    this.gameState = createInitialState(this.levels, this.selectedLevelIndex);

    if (this.screen === 'playing' || this.screen === 'paused') {
      this.screen = 'intro';
    }

    this.statusMessage = `Deleted level ${levelId}`;
    this.levelStartedAtMs = Date.now();
    this.inputQueue.length = 0;
    this.currentRunReplay = [];
    this.clearLevelClearState();
    this.clearTransientEffects();
    this.emit();
    return true;
  }

  public setMusicVolume(volume: number): void {
    this.settings = {
      ...this.settings,
      musicVolume: Math.min(1, Math.max(0, volume)),
    };
    saveSettings(this.settings);
    this.emit();
  }

  public setSfxVolume(volume: number): void {
    this.settings = {
      ...this.settings,
      sfxVolume: Math.min(1, Math.max(0, volume)),
    };
    saveSettings(this.settings);
    this.emit();
  }

  public setLightingEnabled(enabled: boolean): void {
    this.settings = {
      ...this.settings,
      lightingEnabled: enabled,
    };
    saveSettings(this.settings);
    this.emit();
  }

  public setCameraSwayEnabled(enabled: boolean): void {
    this.settings = {
      ...this.settings,
      cameraSwayEnabled: enabled,
    };
    saveSettings(this.settings);
    this.emit();
  }

  public setShowFps(enabled: boolean): void {
    this.settings = {
      ...this.settings,
      showFps: enabled,
    };
    saveSettings(this.settings);
    this.emit();
  }

  public setMobileRotateClockwise(enabled: boolean): void {
    this.settings = {
      ...this.settings,
      mobileRotateClockwise: enabled,
    };
    saveSettings(this.settings);
    this.emit();
  }

  public setMobileFlipHorizontal(enabled: boolean): void {
    this.setMobileRotateClockwise(enabled);
  }

  public isPlaying(): boolean {
    return this.screen === 'playing';
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }

  private clearTransientEffects(): void {
    this.pendingResetState = null;
    this.pendingResetDeadlineMs = 0;
    this.deathAnimation = null;
    this.winTransition = null;
  }

  private clearLevelClearState(): void {
    this.levelClearSummary = null;
    this.pendingLevelAdvance = null;
  }

  private queueDeathReset(
    pendingResetState: GameState,
    nowMs: number,
    deathAnimation:
      | Omit<EnemyDeathAnimationSnapshot, 'sequence' | 'startedAtMs' | 'durationMs'>
      | Omit<LavaDeathAnimationSnapshot, 'sequence' | 'startedAtMs' | 'durationMs'>,
  ): void {
    this.pendingResetState = pendingResetState;
    this.pendingResetDeadlineMs = nowMs + DEATH_ANIMATION_MS;
    this.deathAnimationSequence += 1;
    this.deathAnimation = {
      ...deathAnimation,
      sequence: this.deathAnimationSequence,
      startedAtMs: nowMs,
      durationMs: DEATH_ANIMATION_MS,
    };
    this.inputQueue.length = 0;
    this.currentRunReplay = [];
  }

  private queueScoreSubmission(levelId: string, moves: number, durationMs: number, replay: string): void {
    const task = this.submitCompletedScore(levelId, moves, durationMs, replay).catch(() => {
      // Non-fatal.
    });
    this.pendingScoreSubmissions.add(task);
    void task.finally(() => {
      this.pendingScoreSubmissions.delete(task);
    });
  }

  private async submitCompletedScore(levelId: string, moves: number, durationMs: number, replay: string): Promise<void> {
    if (!this.playerName) {
      return;
    }

    try {
      await submitScore({
        levelId,
        playerName: this.playerName,
        moves,
        durationMs,
        replay,
      });
    } catch {
      // Non-fatal: keep gameplay responsive if backend is unavailable.
    }
  }
}
