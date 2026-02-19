import type { ControllerSnapshot, GameController } from '../app/gameController';
import { parseLevelText } from '../core/levelParser';
import type { Direction, ParsedLevel } from '../core/types';
import { generateAdminLevel, solveLevelForAdmin } from '../editor/adminLevelTools';
import {
  EDITOR_TILE_PALETTE,
  cloneGrid,
  createGrid,
  ensureParseableLevel,
  levelIdFromInput,
  nextCustomLevelId,
  resizeGrid,
  sanitizeDimension,
  serializeGrid,
  shouldPaintOnHover,
  validateGridForEditor,
} from '../editor/levelEditorUtils';
import {
  deleteCustomLevel,
  fetchScoresPage,
  fetchUserProgress,
  initializeApiSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  saveCustomLevel,
  saveUserProgress,
  type AuthState,
  type LevelScoreRecord,
  type ScorePageRecord,
} from '../runtime/backendApi';
import { isTextInputFocused } from '../runtime/inputFocus';
import { getLevelLabel, getLevelName } from '../runtime/levelMeta';
import { LockstepIntroCinematic } from './introCinematic';

const EDITOR_TEST_LEVEL_ID = '__editor-test-level';
const SCORE_PAGE_SIZE = 10;

interface ScoreQueryOptions {
  scope: 'all' | 'personal';
  searchText: string;
  page: number;
  pageSize: number;
}

function asElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing required selector: ${selector}`);
  }

  return element as T;
}

function describeTile(tile: string): string {
  if (tile === '#') {
    return 'Wall (#)';
  }
  if (tile === ' ') {
    return 'Floor (space)';
  }
  if (tile === 'P') {
    return 'Player spawn (P)';
  }
  if (tile === '!') {
    return 'Goal (!)';
  }
  if (tile === 'x') {
    return 'Lava (x)';
  }

  return `Enemy path (${tile})`;
}

function tileClass(tile: string): string {
  if (tile === '#') {
    return 'tile-wall';
  }
  if (tile === ' ') {
    return 'tile-floor';
  }
  if (tile === 'P') {
    return 'tile-player';
  }
  if (tile === '!') {
    return 'tile-goal';
  }
  if (tile === 'x') {
    return 'tile-lava';
  }

  return 'tile-path';
}

function levelPreviewTileClass(tile: string): string {
  if (tile === '#') {
    return 'level-card-cell-wall';
  }
  if (tile === ' ') {
    return 'level-card-cell-floor';
  }
  if (tile === 'P') {
    return 'level-card-cell-player';
  }
  if (tile === '!') {
    return 'level-card-cell-goal';
  }
  if (tile === 'x') {
    return 'level-card-cell-lava';
  }

  return 'level-card-cell-path';
}

function isIntroStartKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

function isLikelyMobileDevice(): boolean {
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const userAgent = navigator.userAgent.toLowerCase();
  const hasMobileUserAgent = /android|iphone|ipad|ipod|mobile/.test(userAgent);
  const hasTouch = navigator.maxTouchPoints > 0;
  return hasCoarsePointer || hasMobileUserAgent || hasTouch;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

interface OverlayUiOptions {
  builtInLevelCount?: number;
  customLevelOwners?: Map<
    string,
    {
      ownerUserId: number | null;
      ownerUsername: string | null;
    }
  >;
  autoStartFromDeepLink?: boolean;
}

export class OverlayUI {
  private readonly root: HTMLElement;

  private readonly controller: GameController;

  private readonly builtInLevelCount: number;

  private readonly customLevelOwners = new Map<
    string,
    {
      ownerUserId: number | null;
      ownerUsername: string | null;
    }
  >();

  private readonly levelSelect: HTMLSelectElement;

  private readonly levelSelectGrid: HTMLElement;

  private readonly levelSelectSearchInput: HTMLInputElement;

  private readonly levelSelectScopeSelect: HTMLSelectElement;

  private readonly levelSelectSearchEmpty: HTMLElement;

  private readonly levelSelectCurrentText: HTMLElement;

  private readonly statusText: HTMLElement;

  private readonly playerNameInput: HTMLInputElement;

  private readonly playButton: HTMLButtonElement;

  private readonly levelStartButton: HTMLButtonElement;

  private readonly pauseLevelSelectButton: HTMLButtonElement;

  private readonly mainCurrentLevelText: HTMLElement;

  private readonly musicVolumeSlider: HTMLInputElement;

  private readonly sfxVolumeSlider: HTMLInputElement;

  private readonly lightingToggle: HTMLInputElement;

  private readonly cameraSwayToggle: HTMLInputElement;

  private readonly showFpsToggle: HTMLInputElement;

  private readonly panels: Record<string, HTMLElement>;

  private readonly introPanel: HTMLElement;

  private readonly introStartButton: HTMLButtonElement;

  private readonly introLevelSelectButton: HTMLButtonElement;

  private readonly introPlayerNameInput: HTMLInputElement;

  private readonly introCurrentLevelText: HTMLElement;

  private readonly accountStatus: HTMLElement;

  private readonly accountFeedback: HTMLElement;

  private readonly accountUsernameInput: HTMLInputElement;

  private readonly accountPasswordInput: HTMLInputElement;

  private readonly accountPlayerNameInput: HTMLInputElement;

  private readonly accountLoginButton: HTMLButtonElement;

  private readonly accountRegisterButton: HTMLButtonElement;

  private readonly accountLogoutButton: HTMLButtonElement;

  private readonly introAccountPanel: HTMLElement;

  private readonly introAccountButton: HTMLButtonElement;

  private readonly introSettingsPanel: HTMLElement;

  private readonly introSettingsButton: HTMLButtonElement;

  private readonly introSettingsCloseButton: HTMLButtonElement;

  private readonly introMusicVolumeSlider: HTMLInputElement;

  private readonly introSfxVolumeSlider: HTMLInputElement;

  private readonly introLightingToggle: HTMLInputElement;

  private readonly introCameraSwayToggle: HTMLInputElement;

  private readonly introShowFpsToggle: HTMLInputElement;

  private readonly introCinematic: LockstepIntroCinematic;

  private readonly scoreList: HTMLOListElement;

  private readonly scoreStatus: HTMLElement;

  private readonly scoreSearchInput: HTMLInputElement;

  private readonly scoreScopeSelect: HTMLSelectElement;

  private readonly scorePagePrevButton: HTMLButtonElement;

  private readonly scorePageNextButton: HTMLButtonElement;

  private readonly scorePageText: HTMLElement;

  private readonly hudScoreboard: HTMLElement;

  private readonly hudScoreList: HTMLOListElement;

  private readonly hudScoreStatus: HTMLElement;

  private readonly levelClearLevelText: HTMLElement;

  private readonly levelClearMovesText: HTMLElement;

  private readonly levelClearTimeText: HTMLElement;

  private readonly levelClearScoreList: HTMLOListElement;

  private readonly levelClearScoreStatus: HTMLElement;

  private readonly levelClearReplayButton: HTMLButtonElement;

  private readonly levelClearContinueButton: HTMLButtonElement;

  private readonly editorIdInput: HTMLInputElement;

  private readonly editorNameInput: HTMLInputElement;

  private readonly editorWidthInput: HTMLInputElement;

  private readonly editorHeightInput: HTMLInputElement;

  private readonly editorPlayerNameInput: HTMLInputElement;

  private readonly editorGridRoot: HTMLElement;

  private readonly editorFeedback: HTMLElement;

  private readonly editorSelectedTile: HTMLElement;

  private readonly editorPaletteRoot: HTMLElement;

  private readonly editorSaveButton: HTMLButtonElement;

  private readonly editorSavePlayButton: HTMLButtonElement;

  private readonly editorDeleteButton: HTMLButtonElement;

  private readonly editorAutoGenerateButton: HTMLButtonElement;

  private readonly pauseTestBackButton: HTMLButtonElement;

  private readonly pauseTestSolverButton: HTMLButtonElement;

  private readonly mobileSwipeHint: HTMLElement;

  private readonly mobileOpenMenuButton: HTMLButtonElement;

  private readonly mobileOpenSettingsButton: HTMLButtonElement;

  private readonly mobileOnlySettings: HTMLElement[];

  private readonly isMobileDevice: boolean;

  private authState: AuthState = { authenticated: false, user: null };

  private authBusy = false;

  private lastSavedProgressLevelId: string | null = null;

  private pendingProgressLevelId: string | null = null;

  private editorPaletteButtons = new Map<string, HTMLButtonElement>();

  private editorGrid: string[][] = this.createBlankGrid(25, 16);

  private editorTile = '#';

  private isEditorPainting = false;

  private editorTestingPublishLevelId: string | null = null;

  private editorLoadedLevelId: string | null = null;

  private adminSolverBusy = false;

  private solverPlayback:
    | {
        levelId: string;
        path: Direction[];
        nextIndex: number;
        baseMoves: number;
        timerId: number;
      }
    | null = null;

  private lastSnapshot: ControllerSnapshot | null = null;

  private readonly scoreCache = new Map<string, ScorePageRecord>();

  private readonly inFlightScoreRequestMap = new Map<string, Promise<ScorePageRecord>>();

  private scorePanelRequestNonce = 0;

  private scorePanelQuery: ScoreQueryOptions = {
    scope: 'all',
    searchText: '',
    page: 1,
    pageSize: SCORE_PAGE_SIZE,
  };

  private scorePanelLastResult: ScorePageRecord | null = null;

  private lastScorePanelLevelId: string | null = null;

  private lastRenderedScreen: ControllerSnapshot['screen'] | null = null;

  private lastRenderedHudLevelId: string | null = null;

  private lastRenderedLevelClearKey: string | null = null;

  private lastHandledScoreSubmissionSequence = 0;

  private levelSelectCardButtons = new Map<number, HTMLButtonElement>();

  private levelSelectCardContainers = new Map<number, HTMLElement>();

  private autoStartFromDeepLinkPending = false;

  private lastSyncedUrlLevelId: string | null = null;

  public constructor(root: HTMLElement, controller: GameController, options: OverlayUiOptions = {}) {
    this.root = root;
    this.controller = controller;
    const totalLevels = controller.getSnapshot().levels.length;
    this.builtInLevelCount = Math.max(0, Math.min(options.builtInLevelCount ?? 0, totalLevels));
    if (options.customLevelOwners) {
      for (const [levelId, owner] of options.customLevelOwners) {
        this.customLevelOwners.set(levelId, {
          ownerUserId: owner.ownerUserId,
          ownerUsername: owner.ownerUsername,
        });
      }
    }
    this.autoStartFromDeepLinkPending = Boolean(options.autoStartFromDeepLink);

    this.root.innerHTML = this.buildMarkup();

    this.panels = {
      intro: asElement<HTMLElement>(this.root, '[data-panel="intro"]'),
      main: asElement<HTMLElement>(this.root, '[data-panel="main"]'),
      levelSelect: asElement<HTMLElement>(this.root, '[data-panel="level-select"]'),
      settings: asElement<HTMLElement>(this.root, '[data-panel="settings"]'),
      editor: asElement<HTMLElement>(this.root, '[data-panel="editor"]'),
      levelClear: asElement<HTMLElement>(this.root, '[data-panel="level-clear"]'),
      pause: asElement<HTMLElement>(this.root, '[data-panel="pause"]'),
    };

    this.introPanel = asElement<HTMLElement>(this.root, '[data-panel="intro"]');
    this.introStartButton = asElement<HTMLButtonElement>(this.root, '#btn-intro-start');
    this.introLevelSelectButton = asElement<HTMLButtonElement>(this.root, '#btn-intro-level-select');
    this.introPlayerNameInput = asElement<HTMLInputElement>(this.root, '#intro-player-name-input');
    this.introCurrentLevelText = asElement<HTMLElement>(this.root, '#intro-current-level');
    this.accountStatus = asElement<HTMLElement>(this.root, '#account-status');
    this.accountFeedback = asElement<HTMLElement>(this.root, '#account-feedback');
    this.accountUsernameInput = asElement<HTMLInputElement>(this.root, '#account-username-input');
    this.accountPasswordInput = asElement<HTMLInputElement>(this.root, '#account-password-input');
    this.accountPlayerNameInput = asElement<HTMLInputElement>(this.root, '#account-player-name-input');
    this.accountLoginButton = asElement<HTMLButtonElement>(this.root, '#btn-account-login');
    this.accountRegisterButton = asElement<HTMLButtonElement>(this.root, '#btn-account-register');
    this.accountLogoutButton = asElement<HTMLButtonElement>(this.root, '#btn-account-logout');
    this.introAccountPanel = asElement<HTMLElement>(this.root, '#intro-account-panel');
    this.introAccountButton = asElement<HTMLButtonElement>(this.root, '#btn-intro-account-toggle');
    this.introSettingsPanel = asElement<HTMLElement>(this.root, '#intro-settings-panel');
    this.introSettingsButton = asElement<HTMLButtonElement>(this.root, '#btn-intro-settings-toggle');
    this.introSettingsCloseButton = asElement<HTMLButtonElement>(this.root, '#btn-intro-settings-close');
    this.introMusicVolumeSlider = asElement<HTMLInputElement>(this.root, '#intro-settings-music-volume');
    this.introSfxVolumeSlider = asElement<HTMLInputElement>(this.root, '#intro-settings-sfx-volume');
    this.introLightingToggle = asElement<HTMLInputElement>(this.root, '#intro-settings-lighting');
    this.introCameraSwayToggle = asElement<HTMLInputElement>(this.root, '#intro-settings-camera-sway');
    this.introShowFpsToggle = asElement<HTMLInputElement>(this.root, '#intro-settings-show-fps');
    this.introCinematic = new LockstepIntroCinematic({
      elements: {
        panel: this.introPanel,
        canvas: asElement<HTMLCanvasElement>(this.root, '#intro-canvas'),
        title: asElement<HTMLElement>(this.root, '#intro-title'),
        line: asElement<HTMLElement>(this.root, '#intro-line'),
        skipHint: asElement<HTMLElement>(this.root, '#intro-skip-hint'),
      },
      onComplete: () => {
        this.controller.finishIntro();
      },
    });

    this.levelSelect = asElement<HTMLSelectElement>(this.root, '#level-select-input');
    this.levelSelectGrid = asElement<HTMLElement>(this.root, '#level-select-grid');
    this.levelSelectSearchInput = asElement<HTMLInputElement>(this.root, '#level-select-search-input');
    this.levelSelectScopeSelect = asElement<HTMLSelectElement>(this.root, '#level-select-scope-select');
    this.levelSelectSearchEmpty = asElement<HTMLElement>(this.root, '#level-select-search-empty');
    this.levelSelectCurrentText = asElement<HTMLElement>(this.root, '#level-select-current');
    this.statusText = asElement<HTMLElement>(this.root, '#menu-status');
    this.playerNameInput = asElement<HTMLInputElement>(this.root, '#player-name-input');
    this.mainCurrentLevelText = asElement<HTMLElement>(this.root, '#main-current-level');
    this.playButton = asElement<HTMLButtonElement>(this.root, '#btn-play');
    this.levelStartButton = asElement<HTMLButtonElement>(this.root, '#btn-level-start');
    this.pauseLevelSelectButton = asElement<HTMLButtonElement>(this.root, '#btn-pause-level-select');
    this.musicVolumeSlider = asElement<HTMLInputElement>(this.root, '#settings-music-volume');
    this.sfxVolumeSlider = asElement<HTMLInputElement>(this.root, '#settings-sfx-volume');
    this.lightingToggle = asElement<HTMLInputElement>(this.root, '#settings-lighting');
    this.cameraSwayToggle = asElement<HTMLInputElement>(this.root, '#settings-camera-sway');
    this.showFpsToggle = asElement<HTMLInputElement>(this.root, '#settings-show-fps');
    this.scoreList = asElement<HTMLOListElement>(this.root, '#score-list');
    this.scoreStatus = asElement<HTMLElement>(this.root, '#score-status');
    this.scoreSearchInput = asElement<HTMLInputElement>(this.root, '#score-search-input');
    this.scoreScopeSelect = asElement<HTMLSelectElement>(this.root, '#score-scope-select');
    this.scorePagePrevButton = asElement<HTMLButtonElement>(this.root, '#btn-score-page-prev');
    this.scorePageNextButton = asElement<HTMLButtonElement>(this.root, '#btn-score-page-next');
    this.scorePageText = asElement<HTMLElement>(this.root, '#score-page-text');
    this.hudScoreboard = asElement<HTMLElement>(this.root, '#hud-scoreboard');
    this.hudScoreList = asElement<HTMLOListElement>(this.root, '#hud-score-list');
    this.hudScoreStatus = asElement<HTMLElement>(this.root, '#hud-score-status');
    this.levelClearLevelText = asElement<HTMLElement>(this.root, '#level-clear-level');
    this.levelClearMovesText = asElement<HTMLElement>(this.root, '#level-clear-moves');
    this.levelClearTimeText = asElement<HTMLElement>(this.root, '#level-clear-time');
    this.levelClearScoreList = asElement<HTMLOListElement>(this.root, '#level-clear-score-list');
    this.levelClearScoreStatus = asElement<HTMLElement>(this.root, '#level-clear-score-status');
    this.levelClearReplayButton = asElement<HTMLButtonElement>(this.root, '#btn-level-clear-replay');
    this.levelClearContinueButton = asElement<HTMLButtonElement>(this.root, '#btn-level-clear-continue');

    this.editorNameInput = asElement<HTMLInputElement>(this.root, '#editor-level-name');
    this.editorIdInput = asElement<HTMLInputElement>(this.root, '#editor-level-id');
    this.editorWidthInput = asElement<HTMLInputElement>(this.root, '#editor-width');
    this.editorHeightInput = asElement<HTMLInputElement>(this.root, '#editor-height');
    this.editorPlayerNameInput = asElement<HTMLInputElement>(this.root, '#editor-player-name-input');
    this.editorGridRoot = asElement<HTMLElement>(this.root, '#editor-grid');
    this.editorFeedback = asElement<HTMLElement>(this.root, '#editor-feedback');
    this.editorSelectedTile = asElement<HTMLElement>(this.root, '#editor-selected-tile');
    this.editorPaletteRoot = asElement<HTMLElement>(this.root, '#editor-palette');
    this.editorSaveButton = asElement<HTMLButtonElement>(this.root, '#btn-editor-save');
    this.editorSavePlayButton = asElement<HTMLButtonElement>(this.root, '#btn-editor-save-play');
    this.editorDeleteButton = asElement<HTMLButtonElement>(this.root, '#btn-editor-delete');
    this.editorAutoGenerateButton = asElement<HTMLButtonElement>(this.root, '#btn-editor-auto-generate');
    this.pauseTestBackButton = asElement<HTMLButtonElement>(this.root, '#btn-test-back-editor');
    this.pauseTestSolverButton = asElement<HTMLButtonElement>(this.root, '#btn-test-solver');
    this.mobileSwipeHint = asElement<HTMLElement>(this.root, '#mobile-swipe-hint');
    this.mobileOpenMenuButton = asElement<HTMLButtonElement>(this.root, '#btn-mobile-open-menu');
    this.mobileOpenSettingsButton = asElement<HTMLButtonElement>(this.root, '#btn-mobile-open-settings');
    this.mobileOnlySettings = Array.from(this.root.querySelectorAll<HTMLElement>('[data-mobile-only]'));
    this.isMobileDevice = isLikelyMobileDevice();
    if (!this.isMobileDevice) {
      for (const setting of this.mobileOnlySettings) {
        setting.hidden = true;
      }
    }
    if (this.controller.getSnapshot().settings.mobileRotateClockwise) {
      this.controller.setMobileRotateClockwise(false);
    }

    this.buildPalette();
    this.renderEditorGrid();
    this.bindEvents();
    this.controller.subscribe((snapshot) => this.render(snapshot));
    void this.initializeAccountState();
  }

  private buildMarkup(): string {
    return `
      <section class="intro-overlay" data-panel="intro">
        <canvas id="intro-canvas" aria-hidden="true"></canvas>
        <div class="intro-settings-corner">
          <div class="intro-corner-buttons">
            <button type="button" id="btn-intro-account-toggle" aria-label="Open account menu">Account</button>
            <button type="button" id="btn-intro-settings-toggle" aria-label="Open intro settings" title="Settings">
              &#9881;
            </button>
          </div>
          <div class="intro-account-panel account-panel" id="intro-account-panel" hidden>
            <h3>Account</h3>
            <p class="account-status" id="account-status" aria-live="polite">Not signed in.</p>
            <label for="account-username-input">Username</label>
            <input
              id="account-username-input"
              type="text"
              maxlength="24"
              placeholder="lowercase_username"
              autocapitalize="none"
              spellcheck="false"
            />
            <label for="account-password-input">Password</label>
            <input id="account-password-input" type="password" maxlength="128" placeholder="password" />
            <label for="account-player-name-input">Player Name (optional for register)</label>
            <input id="account-player-name-input" type="text" maxlength="32" placeholder="Defaults to username" />
            <div class="button-row account-button-row">
              <button type="button" id="btn-account-login">Sign In</button>
              <button type="button" id="btn-account-register">Register</button>
              <button type="button" id="btn-account-logout">Sign Out</button>
            </div>
            <p class="account-feedback" id="account-feedback" aria-live="polite">
              Publish levels and save progress with an account.
            </p>
          </div>
          <div class="intro-settings-panel" id="intro-settings-panel" hidden>
            <h3>Settings</h3>
            <label for="intro-settings-music-volume">Music Volume</label>
            <input id="intro-settings-music-volume" type="range" min="0" max="1" step="0.05" />
            <label for="intro-settings-sfx-volume">SFX Volume</label>
            <input id="intro-settings-sfx-volume" type="range" min="0" max="1" step="0.05" />
            <label class="checkbox-row">
              <input id="intro-settings-lighting" type="checkbox" />
              Lighting effects
            </label>
            <label class="checkbox-row">
              <input id="intro-settings-camera-sway" type="checkbox" />
              Camera sway
            </label>
            <label class="checkbox-row">
              <input id="intro-settings-show-fps" type="checkbox" />
              Show FPS
            </label>
            <button type="button" id="btn-intro-settings-close">Done</button>
          </div>
        </div>
        <div class="intro-content">
          <h1 id="intro-title">LOCKSTEP</h1>
          <p id="intro-line"></p>
          <p id="intro-skip-hint" class="intro-skip-hint">Press Start anytime to skip</p>
        </div>
        <aside class="intro-menu-dock">
          <div class="intro-menu-fields">
            <h2>Enter Lockstep</h2>
            <label for="intro-player-name-input">Player Name</label>
            <input id="intro-player-name-input" type="text" maxlength="32" placeholder="Enter your name" />
            <div class="intro-level-readout">
              Current Level
              <strong id="intro-current-level">Level 1</strong>
            </div>
            <p class="intro-level-hint">Press <kbd>ESC</kbd> in-game to open Level Select.</p>
            <p class="intro-level-hint" data-mobile-only>Mobile: swipe anywhere to move.</p>
          </div>
          <div class="button-row intro-button-row">
            <button type="button" id="btn-intro-start">Start</button>
            <button type="button" id="btn-intro-level-select">Levels</button>
          </div>
        </aside>
      </section>

      <div class="menu-status" id="menu-status" aria-live="polite"></div>
      <button
        type="button"
        class="mobile-corner-control"
        id="btn-mobile-open-menu"
        data-mobile-only
        aria-label="Open pause menu"
        title="Menu"
        hidden
      >
        &#9776;
      </button>
      <button
        type="button"
        class="mobile-corner-control"
        id="btn-mobile-open-settings"
        data-mobile-only
        aria-label="Open settings"
        title="Settings"
        hidden
      >
        &#9881;
      </button>
      <div class="mobile-swipe-hint" id="mobile-swipe-hint" data-mobile-only hidden>
        Swipe anywhere to move.
      </div>
      <aside class="hud-scoreboard" id="hud-scoreboard" hidden>
        <h3>High Scores</h3>
        <div id="hud-score-status" class="score-status">Lower is better (moves, then time)</div>
        <ol id="hud-score-list" class="score-list"></ol>
      </aside>

      <section class="menu-panel" data-panel="main">
        <h1>LOCKSTEP</h1>
        <p>Move all white squares to green goals. Avoid lava and enemies.</p>
        <p class="main-level-readout">Current Level: <strong id="main-current-level">Level 1</strong></p>
        <p class="main-level-hint">Level Select is available in the <kbd>ESC</kbd> pause menu.</p>
        <label for="player-name-input">Player Name (required)</label>
        <input id="player-name-input" type="text" maxlength="32" placeholder="Enter your name" />

        <div class="button-row">
          <button type="button" id="btn-play">Play</button>
          <button type="button" id="btn-open-levels">Levels</button>
          <button type="button" id="btn-main-settings">Settings</button>
        </div>
      </section>

      <section class="menu-panel menu-panel-level-select-page" data-panel="level-select" hidden>
        <header class="level-select-header">
          <div class="level-select-header-copy">
            <h2>Level Select</h2>
            <p>Pick a map to play, copy any map into the editor, or create a blank one with +.</p>
          </div>
          <div class="level-select-header-actions">
            <button type="button" id="btn-level-start">Play Selected</button>
            <button type="button" id="btn-level-back">Back</button>
          </div>
        </header>

        <div class="level-select-controls">
          <div class="level-select-control-field">
            <label for="level-select-scope-select" class="level-select-search-label">Show</label>
            <select id="level-select-scope-select" class="level-select-control-input">
              <option value="all">All levels</option>
              <option value="builtin">Built-in levels</option>
              <option value="mine">Levels I built</option>
            </select>
          </div>
          <div class="level-select-control-field level-select-control-field-search">
            <label for="level-select-search-input" class="level-select-search-label">Search by level name</label>
            <input
              id="level-select-search-input"
              class="level-select-control-input level-select-control-search-input"
              type="search"
              placeholder="e.g. relay, custom, maze"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
        </div>

        <div class="level-select-layout">
          <section class="level-select-grid-panel">
            <select id="level-select-input" class="level-select-hidden-input" aria-hidden="true" tabindex="-1"></select>
            <p id="level-select-search-empty" class="level-select-search-empty" hidden>No levels match this search.</p>
            <div id="level-select-grid" class="level-select-grid" role="listbox" aria-label="Level grid"></div>
          </section>

          <aside class="level-select-score-panel">
            <h3 id="level-select-current">Level 1</h3>
            <div class="score-panel-controls">
              <div class="score-panel-control-field">
                <label for="score-scope-select" class="level-select-search-label">Scores</label>
                <select id="score-scope-select" class="level-select-control-input">
                  <option value="all">All Players</option>
                  <option value="personal">My Scores</option>
                </select>
              </div>
              <div class="score-panel-control-field">
                <label for="score-search-input" class="level-select-search-label">Find Player</label>
                <input
                  id="score-search-input"
                  class="level-select-control-input level-select-control-search-input"
                  type="search"
                  placeholder="Search by player name"
                  autocomplete="off"
                  spellcheck="false"
                />
              </div>
            </div>
            <div id="score-status" class="score-status">Top 10 scores (lower is better)</div>
            <ol id="score-list" class="score-list level-select-score-list"></ol>
            <div class="score-pagination">
              <button type="button" id="btn-score-page-prev">Previous</button>
              <span id="score-page-text">Page 1</span>
              <button type="button" id="btn-score-page-next">Next</button>
            </div>
          </aside>
        </div>
      </section>

      <section class="menu-panel" data-panel="settings" hidden>
        <h2>Settings</h2>
        <label for="settings-music-volume">Music Volume</label>
        <input id="settings-music-volume" type="range" min="0" max="1" step="0.05" />

        <label for="settings-sfx-volume">SFX Volume</label>
        <input id="settings-sfx-volume" type="range" min="0" max="1" step="0.05" />

        <label class="checkbox-row">
          <input id="settings-lighting" type="checkbox" />
          Lighting effects
        </label>
        <label class="checkbox-row">
          <input id="settings-camera-sway" type="checkbox" />
          Camera sway
        </label>
        <label class="checkbox-row">
          <input id="settings-show-fps" type="checkbox" />
          Show FPS
        </label>

        <div class="button-row">
          <button type="button" id="btn-settings-back">Back</button>
        </div>
      </section>

      <section class="menu-panel menu-panel-editor-page" data-panel="editor" hidden>
        <header class="editor-page-header">
          <div>
            <h2>Level Editor</h2>
            <p>Paint tiles, then test and publish.</p>
          </div>
          <div class="editor-page-header-actions">
            <label for="editor-player-name-input">Player Name</label>
            <input id="editor-player-name-input" type="text" maxlength="32" placeholder="Required to save/play" />
            <button type="button" id="btn-editor-back">Back to Intro</button>
          </div>
        </header>

        <div class="editor-page-layout">
          <aside class="editor-sidebar">
            <section class="editor-card">
              <h3>Map Setup</h3>
              <label for="editor-level-name">Level Name (required)</label>
              <input id="editor-level-name" type="text" maxlength="64" placeholder="Enter level name" />
              <label for="editor-level-id">Level ID</label>
              <input id="editor-level-id" type="text" placeholder="auto-generated-from-name" readonly />
              <div class="editor-dimensions">
                <div>
                  <label for="editor-width">Width</label>
                  <input id="editor-width" type="number" min="4" max="80" value="25" />
                </div>
                <div>
                  <label for="editor-height">Height</label>
                  <input id="editor-height" type="number" min="4" max="80" value="16" />
                </div>
              </div>
              <button type="button" id="btn-editor-resize">Resize Grid</button>
            </section>

            <section class="editor-card">
              <h3>Tiles</h3>
              <div class="editor-palette" id="editor-palette"></div>
              <p class="editor-selected">Selected: <strong id="editor-selected-tile">Wall (#)</strong></p>
            </section>

            <section class="editor-card">
              <h3>Save</h3>
              <div class="button-row editor-card-buttons">
                <button type="button" id="btn-editor-save">Publish Level</button>
                <button type="button" id="btn-editor-save-play">Test + Play</button>
                <button type="button" id="btn-editor-auto-generate" hidden>Auto Generate (Admin)</button>
                <button type="button" id="btn-editor-delete" class="button-danger">Delete Published Level</button>
                <button type="button" id="btn-editor-export">Download .txt</button>
              </div>
              <div class="editor-feedback" id="editor-feedback" aria-live="polite"></div>
            </section>
          </aside>

          <section class="editor-workspace">
            <div class="editor-grid-scroll">
              <div class="editor-grid" id="editor-grid" role="grid" aria-label="Level tile grid"></div>
            </div>
          </section>
        </div>
      </section>

      <section class="menu-panel menu-panel-level-clear" data-panel="level-clear" hidden>
        <h2>Level Clear</h2>
        <p class="level-clear-level-name"><strong id="level-clear-level">Level</strong></p>
        <div class="level-clear-stats">
          <div class="level-clear-stat">
            <span>Moves</span>
            <strong id="level-clear-moves">0</strong>
          </div>
          <div class="level-clear-stat">
            <span>Time</span>
            <strong id="level-clear-time">0.0s</strong>
          </div>
        </div>
        <h3 class="level-clear-scores-title">High Scores</h3>
        <div id="level-clear-score-status" class="score-status">Lower is better (moves, then time)</div>
        <ol id="level-clear-score-list" class="score-list level-clear-score-list"></ol>
        <div class="button-row level-clear-actions">
          <button type="button" id="btn-level-clear-replay">Replay Level</button>
          <button type="button" id="btn-level-clear-continue">Continue</button>
        </div>
      </section>

      <section class="menu-panel" data-panel="pause" hidden>
        <h2>Paused</h2>
        <p>Resume play or jump to another level.</p>
        <div class="button-row">
          <button type="button" id="btn-resume">Resume</button>
          <button type="button" id="btn-restart">Restart</button>
          <button type="button" id="btn-pause-level-select">Level Select</button>
          <button type="button" id="btn-test-back-editor" hidden>Back to Editor (Test)</button>
          <button type="button" id="btn-test-solver" hidden>Run Solver (Admin)</button>
          <button type="button" id="btn-main-menu">Main Menu</button>
          <button type="button" id="btn-pause-settings">Settings</button>
        </div>
      </section>
    `;
  }

  private bindEvents(): void {
    this.introStartButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.startFromIntro();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-intro-level-select').addEventListener('click', () => {
      this.closeIntroPanels();
      this.openLevelSelectFromMenu();
    });

    this.introAccountButton.addEventListener('click', () => {
      const shouldOpen = this.introAccountPanel.hidden;
      this.closeIntroSettings();
      this.introAccountPanel.hidden = !shouldOpen;
      if (shouldOpen) {
        if (this.authState.authenticated) {
          this.accountLogoutButton.focus();
        } else {
          this.accountUsernameInput.focus();
        }
      }
    });

    this.accountLoginButton.addEventListener('click', () => {
      void this.signInAccount();
    });

    this.accountRegisterButton.addEventListener('click', () => {
      void this.registerNewAccount();
    });

    this.accountLogoutButton.addEventListener('click', () => {
      void this.signOutAccount();
    });

    const refreshAccountForm = () => {
      this.refreshAccountUi(this.lastSnapshot ?? this.controller.getSnapshot());
    };
    this.accountUsernameInput.addEventListener('input', refreshAccountForm);
    this.accountPasswordInput.addEventListener('input', refreshAccountForm);
    this.accountPlayerNameInput.addEventListener('input', refreshAccountForm);

    this.accountPasswordInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      void this.signInAccount();
    });

    this.introSettingsButton.addEventListener('click', () => {
      const shouldOpen = this.introSettingsPanel.hidden;
      this.closeIntroAccountMenu();
      this.introSettingsPanel.hidden = !shouldOpen;
      if (shouldOpen) {
        this.introMusicVolumeSlider.focus();
      }
    });

    this.introSettingsCloseButton.addEventListener('click', () => {
      this.closeIntroPanels();
      this.introSettingsButton.focus();
    });

    this.introPanel.addEventListener('pointerdown', (event) => {
      if (this.introSettingsPanel.hidden && this.introAccountPanel.hidden) {
        return;
      }

      const target = event.target as Node;
      const clickedSettingsToggle = target === this.introSettingsButton || this.introSettingsButton.contains(target);
      const clickedAccountToggle = target === this.introAccountButton || this.introAccountButton.contains(target);
      if (clickedSettingsToggle || clickedAccountToggle) {
        return;
      }

      const clickedSettingsPanel = this.introSettingsPanel.contains(target);
      const clickedAccountPanel = this.introAccountPanel.contains(target);
      if (!clickedSettingsPanel && !clickedAccountPanel) {
        this.closeIntroPanels();
      }
    });

    this.playButton.addEventListener('click', () => {
      this.controller.startSelectedLevel();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-open-levels').addEventListener('click', () => {
      this.openLevelSelectFromMenu();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-main-settings').addEventListener('click', () => {
      this.controller.openSettings();
    });

    this.levelStartButton.addEventListener('click', () => {
      const level = Number.parseInt(this.levelSelect.value, 10);
      this.controller.startLevel(level);
    });

    asElement<HTMLButtonElement>(this.root, '#btn-level-back').addEventListener('click', () => {
      this.controller.closeLevelSelect();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-settings-back').addEventListener('click', () => {
      this.controller.closeSettings();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-resume').addEventListener('click', () => {
      this.controller.togglePause();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-restart').addEventListener('click', () => {
      this.controller.restartCurrentLevel();
    });

    this.levelClearReplayButton.addEventListener('click', () => {
      this.controller.replayClearedLevel();
    });

    this.levelClearContinueButton.addEventListener('click', () => {
      this.controller.continueAfterLevelClear();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-main-menu').addEventListener('click', () => {
      if (this.editorTestingPublishLevelId) {
        this.returnFromEditorTest();
        return;
      }
      this.controller.openMainMenu();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-pause-level-select').addEventListener('click', () => {
      this.openLevelSelectFromMenu();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-pause-settings').addEventListener('click', () => {
      this.controller.openSettings();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-editor-resize').addEventListener('click', () => {
      this.resizeEditorGrid();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-editor-save').addEventListener('click', () => {
      void this.publishEditorLevel();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-editor-save-play').addEventListener('click', () => {
      this.startEditorTestPlay();
    });

    this.editorDeleteButton.addEventListener('click', () => {
      void this.deleteEditorLevel();
    });

    this.editorAutoGenerateButton.addEventListener('click', () => {
      this.autoGenerateEditorLevel();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-editor-export').addEventListener('click', () => {
      this.exportEditorText();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-editor-back').addEventListener('click', () => {
      this.controller.openMainMenu();
    });

    this.pauseTestBackButton.addEventListener('click', () => {
      this.returnFromEditorTest();
    });

    this.pauseTestSolverButton.addEventListener('click', () => {
      void this.toggleAdminSolverForPlaytest();
    });

    this.playerNameInput.addEventListener('input', () => {
      this.controller.setPlayerName(this.playerNameInput.value);
    });

    this.introPlayerNameInput.addEventListener('input', () => {
      this.controller.setPlayerName(this.introPlayerNameInput.value);
    });

    this.editorPlayerNameInput.addEventListener('input', () => {
      this.controller.setPlayerName(this.editorPlayerNameInput.value);
    });

    this.levelSelect.addEventListener('change', () => {
      const level = Number.parseInt(this.levelSelect.value, 10);
      this.controller.setSelectedLevel(level);
      void this.loadScoresForSelectedLevel(true);
    });

    this.levelSelectSearchInput.addEventListener('input', () => {
      this.applyLevelSearchFilter();
    });

    this.levelSelectScopeSelect.addEventListener('change', () => {
      this.applyLevelSearchFilter();
    });

    this.scoreSearchInput.addEventListener('input', () => {
      this.scorePanelQuery.searchText = this.scoreSearchInput.value.trim();
      this.scorePanelQuery.page = 1;
      void this.loadScoresForSelectedLevel(true);
    });

    this.scoreScopeSelect.addEventListener('change', () => {
      this.scorePanelQuery.scope = this.scoreScopeSelect.value === 'personal' ? 'personal' : 'all';
      this.scorePanelQuery.page = 1;
      void this.loadScoresForSelectedLevel(true);
    });

    this.scorePagePrevButton.addEventListener('click', () => {
      if (this.scorePanelQuery.page <= 1) {
        return;
      }

      this.scorePanelQuery.page -= 1;
      void this.loadScoresForSelectedLevel(false);
    });

    this.scorePageNextButton.addEventListener('click', () => {
      const totalPages = this.scorePanelLastResult?.totalPages ?? 0;
      if (totalPages > 0 && this.scorePanelQuery.page >= totalPages) {
        return;
      }

      this.scorePanelQuery.page += 1;
      void this.loadScoresForSelectedLevel(false);
    });

    this.editorNameInput.addEventListener('input', () => {
      this.refreshEditorAutoId();
    });

    this.musicVolumeSlider.addEventListener('input', () => {
      this.controller.setMusicVolume(Number.parseFloat(this.musicVolumeSlider.value));
    });

    this.introMusicVolumeSlider.addEventListener('input', () => {
      this.controller.setMusicVolume(Number.parseFloat(this.introMusicVolumeSlider.value));
    });

    this.sfxVolumeSlider.addEventListener('input', () => {
      this.controller.setSfxVolume(Number.parseFloat(this.sfxVolumeSlider.value));
    });

    this.introSfxVolumeSlider.addEventListener('input', () => {
      this.controller.setSfxVolume(Number.parseFloat(this.introSfxVolumeSlider.value));
    });

    this.lightingToggle.addEventListener('change', () => {
      this.controller.setLightingEnabled(this.lightingToggle.checked);
    });

    this.introLightingToggle.addEventListener('change', () => {
      this.controller.setLightingEnabled(this.introLightingToggle.checked);
    });

    this.cameraSwayToggle.addEventListener('change', () => {
      this.controller.setCameraSwayEnabled(this.cameraSwayToggle.checked);
    });

    this.introCameraSwayToggle.addEventListener('change', () => {
      this.controller.setCameraSwayEnabled(this.introCameraSwayToggle.checked);
    });

    this.showFpsToggle.addEventListener('change', () => {
      this.controller.setShowFps(this.showFpsToggle.checked);
    });

    this.introShowFpsToggle.addEventListener('change', () => {
      this.controller.setShowFps(this.introShowFpsToggle.checked);
    });

    this.mobileOpenMenuButton.addEventListener('click', () => {
      const screen = this.controller.getSnapshot().screen;
      if (screen === 'playing') {
        this.controller.openPauseMenu();
      }
    });

    this.mobileOpenSettingsButton.addEventListener('click', () => {
      const screen = this.controller.getSnapshot().screen;
      if (screen === 'playing' || screen === 'paused') {
        this.controller.openSettings();
      }
    });

    this.editorGridRoot.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      if ((event.buttons & 1) !== 1 || !target.dataset.x || !target.dataset.y) {
        return;
      }

      this.isEditorPainting = true;
      this.editorGridRoot.setPointerCapture(event.pointerId);
      this.paintGridCell(target);
      event.preventDefault();
    });

    this.editorGridRoot.addEventListener('pointermove', (event) => {
      if (!shouldPaintOnHover(this.isEditorPainting, event.buttons)) {
        return;
      }

      const target = this.editorCellFromPointer(event);
      if (!target) {
        return;
      }

      this.paintGridCell(target);
    });

    this.editorGridRoot.addEventListener('pointerup', () => {
      this.isEditorPainting = false;
    });

    this.editorGridRoot.addEventListener('pointercancel', () => {
      this.isEditorPainting = false;
    });

    this.editorGridRoot.addEventListener('pointerleave', () => {
      this.isEditorPainting = false;
    });

    window.addEventListener('keydown', (event) => {
      const snapshot = this.controller.getSnapshot();
      if (snapshot.screen === 'intro') {
        if (event.key === 'Escape' && (!this.introSettingsPanel.hidden || !this.introAccountPanel.hidden)) {
          event.preventDefault();
          this.closeIntroPanels();
          return;
        }

        if (!isTextInputFocused(document.activeElement as Element | null) && isIntroStartKey(event)) {
          event.preventDefault();
          this.startFromIntro();
        }
        return;
      }

      if (event.key !== 'Escape') {
        return;
      }

      if (snapshot.screen === 'playing') {
        event.preventDefault();
        this.controller.openPauseMenu();
        return;
      }

      if (snapshot.screen === 'paused') {
        event.preventDefault();
        return;
      }

      if (snapshot.screen === 'settings') {
        event.preventDefault();
        this.controller.closeSettings();
        return;
      }

      if (snapshot.screen === 'level-select') {
        event.preventDefault();
        this.controller.closeLevelSelect();
        return;
      }

      if (snapshot.screen === 'editor') {
        event.preventDefault();
        this.controller.openMainMenu();
        return;
      }

      if (snapshot.screen === 'level-clear') {
        event.preventDefault();
      }
    });
  }

  private async initializeAccountState(): Promise<void> {
    try {
      const state = await initializeApiSession();
      this.applyAuthState(state);
      if (state.authenticated) {
        await this.loadSavedProgressForAccount();
        this.setAccountFeedback(`Signed in as @${state.user?.username}.`);
      }
    } catch (error) {
      this.setAccountFeedback(`Account service unavailable: ${formatError(error)}`, true);
    }
  }

  private applyAuthState(state: AuthState): void {
    this.authState = state;
    this.lastSavedProgressLevelId = null;
    this.pendingProgressLevelId = null;
    this.scoreCache.clear();
    this.inFlightScoreRequestMap.clear();

    if (state.authenticated && state.user) {
      this.controller.setPlayerName(state.user.playerName);
      this.accountUsernameInput.value = state.user.username;
      this.accountPlayerNameInput.value = state.user.playerName;
    }

    this.refreshAccountUi(this.lastSnapshot ?? this.controller.getSnapshot());
  }

  private refreshAccountUi(snapshot: ControllerSnapshot): void {
    const signedIn = Boolean(this.authState.authenticated && this.authState.user);
    const user = this.authState.user;
    this.accountStatus.textContent = signedIn
      ? `Signed in: @${user?.username}${user?.isAdmin ? ' (admin)' : ''}`
      : 'Not signed in.';

    const hasCredentials =
      this.accountUsernameInput.value.trim().length > 0 && this.accountPasswordInput.value.length > 0;
    this.accountUsernameInput.disabled = this.authBusy || signedIn;
    this.accountPasswordInput.disabled = this.authBusy || signedIn;
    this.accountPlayerNameInput.disabled = this.authBusy || signedIn;
    this.accountLoginButton.disabled = this.authBusy || signedIn || !hasCredentials;
    this.accountRegisterButton.disabled = this.authBusy || signedIn || !hasCredentials;
    this.accountLogoutButton.disabled = this.authBusy || !signedIn;

    const lockPlayerName = signedIn;
    this.playerNameInput.disabled = lockPlayerName;
    this.introPlayerNameInput.disabled = lockPlayerName;
    this.editorPlayerNameInput.disabled = lockPlayerName;
    this.playerNameInput.title = lockPlayerName ? 'Player name is managed by your account.' : '';
    this.introPlayerNameInput.title = lockPlayerName ? 'Player name is managed by your account.' : '';
    this.editorPlayerNameInput.title = lockPlayerName ? 'Player name is managed by your account.' : '';

    const canPublish = signedIn;
    this.editorSaveButton.disabled = !canPublish;
    this.editorDeleteButton.disabled = !canPublish;
    this.editorSaveButton.title = canPublish ? 'Publish this level' : 'Sign in to publish levels.';
    this.editorDeleteButton.title = canPublish ? 'Delete a published level you own (or any as admin)' : 'Sign in to delete published levels.';

    const personalOption = this.scoreScopeSelect.querySelector<HTMLOptionElement>('option[value="personal"]');
    if (personalOption) {
      personalOption.disabled = !signedIn;
    }
    if (!signedIn && this.scoreScopeSelect.value === 'personal') {
      this.scoreScopeSelect.value = 'all';
      this.scorePanelQuery.scope = 'all';
      this.scorePanelQuery.page = 1;
      this.scorePanelLastResult = null;
      if (snapshot.screen === 'level-select') {
        void this.loadScoresForSelectedLevel(true);
      }
    }

    if (!signedIn && snapshot.playerName.trim().length > 0 && this.accountPlayerNameInput.value.length === 0) {
      this.accountPlayerNameInput.value = snapshot.playerName;
    }

    this.refreshAdminEditorControls(snapshot);
  }

  private setAccountFeedback(message: string, isError = false): void {
    this.accountFeedback.textContent = message;
    this.accountFeedback.classList.toggle('account-feedback-error', isError);
  }

  private isAdminUser(): boolean {
    return Boolean(this.authState.authenticated && this.authState.user?.isAdmin);
  }

  private refreshAdminEditorControls(snapshot: ControllerSnapshot): void {
    const isAdmin = this.isAdminUser();
    this.editorAutoGenerateButton.hidden = !isAdmin;
    this.editorAutoGenerateButton.disabled = !isAdmin;
    this.editorAutoGenerateButton.title = isAdmin
      ? 'Auto-generate a solvable level by seed, players, and difficulty.'
      : 'Admin-only feature.';

    const runtimeTestLevelId = this.editorTestingPublishLevelId
      ? `${EDITOR_TEST_LEVEL_ID}-${this.editorTestingPublishLevelId}`
      : null;
    const canSolvePlaytest = isAdmin && runtimeTestLevelId === snapshot.gameState.levelId;
    this.pauseTestSolverButton.hidden = !canSolvePlaytest;
    this.pauseTestSolverButton.disabled = !canSolvePlaytest || this.adminSolverBusy;
    if (this.adminSolverBusy) {
      this.pauseTestSolverButton.textContent = 'Solving...';
    } else if (this.solverPlayback) {
      this.pauseTestSolverButton.textContent = 'Stop Solver (Admin)';
    } else {
      this.pauseTestSolverButton.textContent = 'Run Solver (Admin)';
    }
  }

  private async loadSavedProgressForAccount(): Promise<void> {
    if (!this.authState.authenticated || !this.authState.user) {
      return;
    }

    try {
      const progress = await fetchUserProgress();
      if (!progress) {
        return;
      }

      this.lastSavedProgressLevelId = progress.selectedLevelId;
      const snapshot = this.controller.getSnapshot();
      const levelIndex = snapshot.levels.findIndex((level) => level.id === progress.selectedLevelId);
      if (levelIndex >= 0 && levelIndex !== snapshot.selectedLevelIndex) {
        this.controller.setSelectedLevel(levelIndex);
        this.setAccountFeedback(`Loaded saved level ${progress.selectedLevelId}.`);
      }
    } catch (error) {
      this.setAccountFeedback(`Unable to load saved progress: ${formatError(error)}`, true);
    }
  }

  private syncSavedProgress(snapshot: ControllerSnapshot): void {
    if (!this.authState.authenticated || !this.authState.user) {
      return;
    }

    const selectedLevel = snapshot.levels[snapshot.selectedLevelIndex];
    if (!selectedLevel) {
      return;
    }

    const selectedLevelId = selectedLevel.id;
    if (selectedLevelId.startsWith(EDITOR_TEST_LEVEL_ID)) {
      return;
    }

    if (selectedLevelId === this.lastSavedProgressLevelId || selectedLevelId === this.pendingProgressLevelId) {
      return;
    }

    this.pendingProgressLevelId = selectedLevelId;
    void saveUserProgress(selectedLevelId)
      .then((saved) => {
        if (this.pendingProgressLevelId === selectedLevelId) {
          this.pendingProgressLevelId = null;
        }
        this.lastSavedProgressLevelId = saved.selectedLevelId;
      })
      .catch(() => {
        if (this.pendingProgressLevelId === selectedLevelId) {
          this.pendingProgressLevelId = null;
        }
      });
  }

  private async registerNewAccount(): Promise<void> {
    if (this.authBusy || this.authState.authenticated) {
      return;
    }

    const username = this.accountUsernameInput.value.trim().toLowerCase();
    const password = this.accountPasswordInput.value;
    const playerName = this.accountPlayerNameInput.value.trim();
    if (!username || !password) {
      this.setAccountFeedback('Enter username and password to register.', true);
      return;
    }

    this.authBusy = true;
    this.refreshAccountUi(this.lastSnapshot ?? this.controller.getSnapshot());

    try {
      const state = await registerAccount({
        username,
        password,
        ...(playerName.length > 0 ? { playerName } : {}),
      });
      this.accountPasswordInput.value = '';
      this.applyAuthState(state);
      await this.loadSavedProgressForAccount();
      this.setAccountFeedback(`Account created. Signed in as @${state.user?.username}.`);
    } catch (error) {
      this.setAccountFeedback(`Register failed: ${formatError(error)}`, true);
    } finally {
      this.authBusy = false;
      this.refreshAccountUi(this.lastSnapshot ?? this.controller.getSnapshot());
    }
  }

  private async signInAccount(): Promise<void> {
    if (this.authBusy || this.authState.authenticated) {
      return;
    }

    const username = this.accountUsernameInput.value.trim().toLowerCase();
    const password = this.accountPasswordInput.value;
    if (!username || !password) {
      this.setAccountFeedback('Enter username and password to sign in.', true);
      return;
    }

    this.authBusy = true;
    this.refreshAccountUi(this.lastSnapshot ?? this.controller.getSnapshot());

    try {
      const state = await loginAccount({ username, password });
      this.accountPasswordInput.value = '';
      this.applyAuthState(state);
      await this.loadSavedProgressForAccount();
      this.setAccountFeedback(`Signed in as @${state.user?.username}.`);
    } catch (error) {
      this.setAccountFeedback(`Sign-in failed: ${formatError(error)}`, true);
    } finally {
      this.authBusy = false;
      this.refreshAccountUi(this.lastSnapshot ?? this.controller.getSnapshot());
    }
  }

  private async signOutAccount(): Promise<void> {
    if (this.authBusy || !this.authState.authenticated) {
      return;
    }

    this.authBusy = true;
    this.refreshAccountUi(this.lastSnapshot ?? this.controller.getSnapshot());

    try {
      const state = await logoutAccount();
      this.accountPasswordInput.value = '';
      this.applyAuthState(state);
      this.setAccountFeedback('Signed out.');
    } catch (error) {
      this.setAccountFeedback(`Sign-out failed: ${formatError(error)}`, true);
    } finally {
      this.authBusy = false;
      this.refreshAccountUi(this.lastSnapshot ?? this.controller.getSnapshot());
    }
  }

  private startFromIntro(): void {
    const nextName = this.introPlayerNameInput.value.trim();
    this.controller.setPlayerName(nextName);
    if (!nextName) {
      this.introPlayerNameInput.focus();
      return;
    }

    this.closeIntroPanels();
    this.controller.startSelectedLevel();
  }

  private closeIntroAccountMenu(): void {
    this.introAccountPanel.hidden = true;
  }

  private closeIntroSettings(): void {
    this.introSettingsPanel.hidden = true;
  }

  private closeIntroPanels(): void {
    this.closeIntroSettings();
    this.closeIntroAccountMenu();
  }

  private openLevelSelectFromMenu(): void {
    const opened = this.controller.openLevelSelect();
    if (opened) {
      void this.loadScoresForSelectedLevel(true);
    }
  }

  private render(snapshot: ControllerSnapshot): void {
    const screenChanged = this.lastRenderedScreen !== snapshot.screen;
    this.lastSnapshot = snapshot;
    this.syncLevelOptions(snapshot);
    this.syncLevelUrl(snapshot);

    if (screenChanged && snapshot.screen === 'main' && this.editorTestingPublishLevelId) {
      this.returnFromEditorTest();
      return;
    }

    if (this.playerNameInput.value !== snapshot.playerName) {
      this.playerNameInput.value = snapshot.playerName;
    }
    if (this.introPlayerNameInput.value !== snapshot.playerName) {
      this.introPlayerNameInput.value = snapshot.playerName;
    }
    if (this.editorPlayerNameInput.value !== snapshot.playerName) {
      this.editorPlayerNameInput.value = snapshot.playerName;
    }

    this.musicVolumeSlider.value = snapshot.settings.musicVolume.toString();
    this.introMusicVolumeSlider.value = snapshot.settings.musicVolume.toString();
    this.sfxVolumeSlider.value = snapshot.settings.sfxVolume.toString();
    this.introSfxVolumeSlider.value = snapshot.settings.sfxVolume.toString();
    this.lightingToggle.checked = snapshot.settings.lightingEnabled;
    this.introLightingToggle.checked = snapshot.settings.lightingEnabled;
    this.cameraSwayToggle.checked = snapshot.settings.cameraSwayEnabled;
    this.introCameraSwayToggle.checked = snapshot.settings.cameraSwayEnabled;
    this.showFpsToggle.checked = snapshot.settings.showFps;
    this.introShowFpsToggle.checked = snapshot.settings.showFps;
    this.statusText.textContent = snapshot.statusMessage ?? '';
    const currentLevel = snapshot.levels[snapshot.selectedLevelIndex];
    if (currentLevel) {
      const label = getLevelLabel(currentLevel.id, snapshot.selectedLevelIndex, currentLevel.name);
      this.introCurrentLevelText.textContent = label;
      this.mainCurrentLevelText.textContent = label;
      this.levelSelectCurrentText.textContent = `${label} (${currentLevel.id})`;
    }
    const levelClearSummary = snapshot.levelClearSummary;
    if (levelClearSummary) {
      const clearLevel = snapshot.levels[levelClearSummary.levelIndex];
      const clearLabel = clearLevel
        ? getLevelLabel(clearLevel.id, levelClearSummary.levelIndex, clearLevel.name)
        : levelClearSummary.levelId;
      this.levelClearLevelText.textContent = clearLabel;
      this.levelClearMovesText.textContent = String(levelClearSummary.moves);
      this.levelClearTimeText.textContent = `${(levelClearSummary.durationMs / 1000).toFixed(1)}s`;
      this.levelClearContinueButton.textContent = levelClearSummary.isFinalLevel ? 'Finish' : 'Continue';
      const levelClearKey = `${levelClearSummary.levelId}:${levelClearSummary.moves}:${levelClearSummary.durationMs}`;
      if (this.lastRenderedLevelClearKey !== levelClearKey || screenChanged) {
        this.lastRenderedLevelClearKey = levelClearKey;
        void this.loadLevelClearScores(levelClearSummary.levelId, true);
        window.setTimeout(() => {
          const latest = this.lastSnapshot;
          if (!latest || latest.screen !== 'level-clear' || latest.levelClearSummary?.levelId !== levelClearSummary.levelId) {
            return;
          }
          void this.loadLevelClearScores(levelClearSummary.levelId, true);
        }, 500);
      }
    } else {
      this.levelClearLevelText.textContent = 'Level';
      this.levelClearMovesText.textContent = '0';
      this.levelClearTimeText.textContent = '0.0s';
      this.levelClearContinueButton.textContent = 'Continue';
      this.levelClearScoreStatus.textContent = 'Lower is better (moves, then time)';
      this.levelClearScoreList.innerHTML = '';
      this.lastRenderedLevelClearKey = null;
    }

    this.applyCompletedScoreSubmission(snapshot);

    if (this.solverPlayback) {
      if (snapshot.gameState.levelId !== this.solverPlayback.levelId) {
        this.stopSolverPlayback();
      } else if (snapshot.screen !== 'playing' && snapshot.screen !== 'paused') {
        this.stopSolverPlayback();
      }
    }

    const canPlay = snapshot.playerName.trim().length > 0;
    if (this.autoStartFromDeepLinkPending && snapshot.screen === 'intro' && canPlay) {
      this.autoStartFromDeepLinkPending = false;
      this.closeIntroPanels();
      this.controller.startSelectedLevel();
      return;
    }

    this.playButton.disabled = !canPlay;
    this.levelStartButton.disabled = !canPlay;
    this.introStartButton.disabled = !canPlay;
    this.introLevelSelectButton.disabled = !canPlay;
    this.pauseLevelSelectButton.disabled = !canPlay;
    this.editorSavePlayButton.disabled = false;
    this.pauseTestBackButton.hidden = !this.editorTestingPublishLevelId;
    const showSwipeHint = this.isMobileDevice && snapshot.screen === 'playing' && snapshot.gameState.moves === 0;
    this.mobileSwipeHint.hidden = !showSwipeHint;
    const showMobileCornerControls = this.isMobileDevice && snapshot.screen === 'playing';
    this.mobileOpenMenuButton.hidden = !showMobileCornerControls;
    this.mobileOpenSettingsButton.hidden = !showMobileCornerControls;

    this.panels.intro.hidden = snapshot.screen !== 'intro';
    this.panels.main.hidden = snapshot.screen !== 'main';
    this.panels.levelSelect.hidden = snapshot.screen !== 'level-select';
    this.panels.settings.hidden = snapshot.screen !== 'settings';
    this.panels.editor.hidden = snapshot.screen !== 'editor';
    this.panels.levelClear.hidden = snapshot.screen !== 'level-clear';
    this.panels.pause.hidden = snapshot.screen !== 'paused';
    this.hudScoreboard.hidden = !(snapshot.screen === 'playing' || snapshot.screen === 'paused');

    if (snapshot.screen === 'intro') {
      this.introCinematic.start();
    } else {
      this.introCinematic.stop();
      this.closeIntroPanels();
    }

    if (screenChanged && snapshot.screen === 'main') {
      this.playButton.focus();
    }

    if (screenChanged && snapshot.screen === 'intro') {
      if (!canPlay) {
        this.introPlayerNameInput.focus();
      } else {
        this.introStartButton.focus();
      }
    }

    if (screenChanged && snapshot.screen === 'paused') {
      asElement<HTMLButtonElement>(this.root, '#btn-resume').focus();
    }

    if (screenChanged && snapshot.screen === 'settings') {
      this.musicVolumeSlider.focus();
    }

    if (screenChanged && snapshot.screen === 'level-select') {
      const selectedCard = this.levelSelectCardButtons.get(snapshot.selectedLevelIndex);
      if (selectedCard) {
        selectedCard.focus();
      } else {
        this.levelStartButton.focus();
      }
    }

    if (screenChanged && snapshot.screen === 'editor') {
      if (!canPlay) {
        this.editorPlayerNameInput.focus();
      } else {
        this.editorNameInput.focus();
      }
    }

    if (screenChanged && snapshot.screen === 'level-clear') {
      this.levelClearContinueButton.focus();
    }

    if (snapshot.screen === 'level-select') {
      void this.loadScoresForSelectedLevel(false);
    }

    this.refreshAccountUi(snapshot);
    this.refreshEditorAutoId();
    this.syncSavedProgress(snapshot);

    if (snapshot.screen === 'playing' || snapshot.screen === 'paused') {
      const currentLevelId = snapshot.gameState.levelId;
      if (this.lastRenderedHudLevelId !== currentLevelId) {
        this.lastRenderedHudLevelId = currentLevelId;
        void this.loadHudScoresForLevel(currentLevelId, false);
      }
    } else {
      this.lastRenderedHudLevelId = null;
    }

    this.root.classList.toggle('overlay-hidden', snapshot.screen === 'playing');
    this.root.classList.toggle('editor-screen-active', snapshot.screen === 'editor');
    this.root.classList.toggle('level-select-screen-active', snapshot.screen === 'level-select');
    this.root.classList.toggle('level-clear-screen-active', snapshot.screen === 'level-clear');
    const gameShell = document.querySelector<HTMLElement>('#game-shell');
    if (gameShell) {
      gameShell.classList.toggle('editor-screen-active', snapshot.screen === 'editor');
      gameShell.classList.toggle('level-select-screen-active', snapshot.screen === 'level-select');
      gameShell.classList.toggle('level-clear-screen-active', snapshot.screen === 'level-clear');
      gameShell.classList.remove('mobile-rotate-clockwise');
    }
    this.lastRenderedScreen = snapshot.screen;
  }

  private getDisplayLevelName(level: ParsedLevel, index: number): string {
    return getLevelName(level.id, index, level.name);
  }

  private currentLevelFilterScope(): 'all' | 'builtin' | 'mine' {
    const scope = this.levelSelectScopeSelect.value;
    if (scope === 'builtin' || scope === 'mine') {
      return scope;
    }

    return 'all';
  }

  private isOwnedByCurrentUser(levelId: string, levelIndex: number): boolean {
    if (levelIndex < this.builtInLevelCount) {
      return false;
    }

    const user = this.authState.user;
    if (!this.authState.authenticated || !user) {
      return false;
    }

    const owner = this.customLevelOwners.get(levelId);
    if (!owner) {
      return false;
    }

    if (owner.ownerUserId !== null) {
      return owner.ownerUserId === user.id;
    }

    if (owner.ownerUsername) {
      return owner.ownerUsername === user.username;
    }

    return false;
  }

  private applyLevelSearchFilter(): void {
    const query = this.levelSelectSearchInput.value.trim().toLowerCase();
    const queryTokens = query.length > 0 ? query.split(/\s+/).filter((token) => token.length > 0) : [];
    const scope = this.currentLevelFilterScope();
    let visibleCount = 0;
    const visibleIndices: number[] = [];

    for (const [index, card] of this.levelSelectCardContainers) {
      const level = this.lastSnapshot?.levels[index];
      if (!level) {
        card.hidden = true;
        card.classList.add('level-card-filter-hidden');
        const option = this.levelSelect.options.item(index);
        if (option) {
          option.hidden = true;
        }
        continue;
      }

      const levelName = this.getDisplayLevelName(level, index).toLowerCase();
      const searchableText = `${levelName} ${level.id.toLowerCase()}`;
      const matchesQuery = queryTokens.length === 0 || queryTokens.every((token) => searchableText.includes(token));
      const matchesScope =
        scope === 'all' ||
        (scope === 'builtin' && index < this.builtInLevelCount) ||
        (scope === 'mine' && this.isOwnedByCurrentUser(level.id, index));
      const matches = matchesQuery && matchesScope;
      card.hidden = !matches;
      card.classList.toggle('level-card-filter-hidden', !matches);
      card.setAttribute('aria-hidden', matches ? 'false' : 'true');
      const option = this.levelSelect.options.item(index);
      if (option) {
        option.hidden = !matches;
      }
      if (matches) {
        visibleCount += 1;
        visibleIndices.push(index);
      }
    }

    const addCard = this.levelSelectGrid.querySelector<HTMLElement>('.level-card-add');
    if (addCard) {
      addCard.hidden = query.length > 0 || scope !== 'all';
    }

    if (scope === 'mine' && !this.authState.authenticated) {
      this.levelSelectSearchEmpty.textContent = 'Sign in to view levels you built.';
    } else {
      this.levelSelectSearchEmpty.textContent = 'No levels match this filter.';
    }
    this.levelSelectSearchEmpty.hidden = visibleCount > 0;

    const snapshot = this.lastSnapshot;
    if (!snapshot) {
      return;
    }

    const selectedCard = this.levelSelectCardContainers.get(snapshot.selectedLevelIndex);
    const selectedIsVisible = Boolean(selectedCard && !selectedCard.hidden);
    if (selectedIsVisible) {
      return;
    }

    const firstVisible = visibleIndices[0];
    if (firstVisible === undefined || firstVisible === snapshot.selectedLevelIndex) {
      return;
    }

    this.controller.setSelectedLevel(firstVisible);
    void this.loadScoresForSelectedLevel(true);
  }

  private syncLevelUrl(snapshot: ControllerSnapshot): void {
    const selectedLevel = snapshot.levels[snapshot.selectedLevelIndex];
    if (!selectedLevel || selectedLevel.id.startsWith(EDITOR_TEST_LEVEL_ID)) {
      return;
    }
    if (this.lastSyncedUrlLevelId === selectedLevel.id) {
      return;
    }

    const url = new URL(window.location.href);
    const desiredPath = `/l/${encodeURIComponent(selectedLevel.id)}`;
    if (url.pathname === desiredPath && !url.search) {
      this.lastSyncedUrlLevelId = selectedLevel.id;
      return;
    }

    url.pathname = desiredPath;
    url.search = '';
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    this.lastSyncedUrlLevelId = selectedLevel.id;
  }

  private syncLevelOptions(snapshot: ControllerSnapshot): void {
    const levelIdsSignature = snapshot.levels.map((level) => level.id).join('|');
    const levelNamesSignature = snapshot.levels.map((level) => level.name ?? '').join('|');
    const authSignature = this.authState.user
      ? `${this.authState.user.id}:${this.authState.user.isAdmin ? 'admin' : 'user'}`
      : 'anonymous';
    const ownershipSignature = snapshot.levels
      .map((level, index) => {
        if (index < this.builtInLevelCount) {
          return 'builtin';
        }

        const owner = this.customLevelOwners.get(level.id);
        return `${owner?.ownerUserId ?? 'none'}:${owner?.ownerUsername ?? ''}`;
      })
      .join('|');
    const signature = `${levelIdsSignature}::${levelNamesSignature}::${authSignature}::${ownershipSignature}`;
    if (this.levelSelect.dataset.signature !== signature) {
      this.levelSelect.innerHTML = '';
      this.levelSelectGrid.innerHTML = '';
      this.levelSelectCardButtons.clear();
      this.levelSelectCardContainers.clear();
      snapshot.levels.forEach((level, index) => {
        const menuOption = document.createElement('option');
        menuOption.value = String(index);
        menuOption.textContent = `${getLevelLabel(level.id, index, level.name)} (${level.id})`;
        this.levelSelect.append(menuOption);

        const { container, selectButton } = this.createLevelSelectCard(level, index);
        this.levelSelectGrid.append(container);
        this.levelSelectCardButtons.set(index, selectButton);
        this.levelSelectCardContainers.set(index, container);
      });
      this.levelSelectGrid.append(this.createAddLevelCard());
      this.levelSelect.dataset.signature = signature;
    }

    const nextValue = String(snapshot.selectedLevelIndex);
    if (this.levelSelect.value !== nextValue) {
      this.levelSelect.value = nextValue;
    }

    for (const [index, button] of this.levelSelectCardButtons) {
      const isSelected = index === snapshot.selectedLevelIndex;
      button.classList.toggle('level-card-selected', isSelected);
      const card = this.levelSelectCardContainers.get(index) ?? button.closest('.level-card');
      if (card) {
        card.classList.toggle('level-card-selected', isSelected);
        card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      }
    }

    this.applyLevelSearchFilter();
  }

  private createLevelSelectCard(
    level: ParsedLevel,
    index: number,
  ): { container: HTMLElement; selectButton: HTMLButtonElement } {
    const card = document.createElement('article');
    card.className = 'level-card';
    card.dataset.levelIndex = String(index);
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', 'false');

    const actions = document.createElement('div');
    actions.className = 'level-card-actions';
    card.append(actions);

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'level-card-copy';
    copyButton.textContent = 'Copy';
    copyButton.title = `Copy ${level.id} into editor`;
    copyButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openEditorForCopiedLevel(level);
    });
    actions.append(copyButton);

    const isBuiltInLevel = index < this.builtInLevelCount;
    const isAdmin = Boolean(this.authState.user?.isAdmin);
    const canDirectEdit = this.canDirectEditLevel(level.id, index);
    if (canDirectEdit) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'level-card-edit';
      editButton.textContent = 'Edit';
      editButton.title = `Edit ${level.id}`;
      editButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openEditorForExistingLevel(level);
      });
      actions.append(editButton);
    }

    if (!isBuiltInLevel && isAdmin) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'level-card-delete';
      deleteButton.textContent = 'Delete';
      deleteButton.title = `Delete ${level.id}`;
      deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.deleteLevelFromLevelSelect(level.id);
      });
      actions.append(deleteButton);
    }

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'level-card-select';
    selectButton.addEventListener('click', () => {
      this.controller.setSelectedLevel(index);
      void this.loadScoresForSelectedLevel(true);
    });
    selectButton.addEventListener('dblclick', () => {
      this.controller.startLevel(index);
    });
    card.append(selectButton);

    const cardHeader = document.createElement('div');
    cardHeader.className = 'level-card-header';

    const cardTitle = document.createElement('strong');
    cardTitle.textContent = getLevelLabel(level.id, index, level.name);
    cardHeader.append(cardTitle);

    const cardId = document.createElement('span');
    cardId.textContent = level.id;
    cardHeader.append(cardId);
    selectButton.append(cardHeader);

    const preview = document.createElement('div');
    preview.className = 'level-card-preview';
    preview.style.gridTemplateColumns = `repeat(${level.width}, 1fr)`;
    for (let y = 0; y < level.height; y += 1) {
      const row = level.grid[y];
      for (let x = 0; x < level.width; x += 1) {
        const tile = row?.[x] ?? '#';
        const cell = document.createElement('span');
        cell.className = `level-card-cell ${levelPreviewTileClass(tile)}`;
        preview.append(cell);
      }
    }
    selectButton.append(preview);

    return { container: card, selectButton };
  }

  private canDirectEditLevel(levelId: string, levelIndex: number): boolean {
    if (levelIndex < this.builtInLevelCount) {
      return false;
    }

    const user = this.authState.user;
    if (!this.authState.authenticated || !user) {
      return false;
    }

    if (user.isAdmin) {
      return true;
    }

    const owner = this.customLevelOwners.get(levelId);
    if (!owner) {
      return false;
    }

    if (owner.ownerUserId !== null) {
      return owner.ownerUserId === user.id;
    }

    if (owner.ownerUsername) {
      return owner.ownerUsername === user.username;
    }

    return false;
  }

  private openEditorForExistingLevel(level: ParsedLevel): void {
    this.stopSolverPlayback();
    const snapshot = this.controller.getSnapshot();
    const levelIndex = snapshot.levels.findIndex((entry) => entry.id === level.id);
    this.editorGrid = cloneGrid(level.grid);
    this.editorTestingPublishLevelId = null;
    this.editorLoadedLevelId = level.id;
    this.editorNameInput.value = this.getDisplayLevelName(level, levelIndex >= 0 ? levelIndex : 0);
    this.refreshEditorAutoId();
    this.renderEditorGrid();
    this.showEditorFeedback(`Editing ${level.id}. Test + Play, then publish when ready.`);
    this.controller.openEditor();
  }

  private async deleteLevelFromLevelSelect(levelId: string): Promise<void> {
    if (!this.authState.authenticated || !this.authState.user?.isAdmin) {
      this.statusText.textContent = 'Admin sign-in required to delete levels.';
      return;
    }

    const confirmed = window.confirm(`Delete published level "${levelId}" permanently?`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteCustomLevel({ levelId });
      this.invalidateScoreCacheForLevel(levelId);
      this.customLevelOwners.delete(levelId);
      const removed = this.controller.removeLevel(levelId);
      if (!removed) {
        this.statusText.textContent = `Level ${levelId} was not found in local state.`;
        return;
      }

      this.statusText.textContent = `Deleted ${levelId}.`;
      void this.loadScoresForSelectedLevel(true);
    } catch (error) {
      this.statusText.textContent = `Delete failed: ${formatError(error)}`;
    }
  }

  private createAddLevelCard(): HTMLButtonElement {
    const addCard = document.createElement('button');
    addCard.type = 'button';
    addCard.className = 'level-card level-card-add';
    addCard.setAttribute('aria-label', 'Create a new blank level');

    const plus = document.createElement('span');
    plus.className = 'level-card-add-plus';
    plus.textContent = '+';
    addCard.append(plus);

    const label = document.createElement('span');
    label.className = 'level-card-add-label';
    label.textContent = 'New Blank Level';
    addCard.append(label);

    addCard.addEventListener('click', () => {
      this.openEditorForBlankLevel();
    });

    return addCard;
  }

  private scoreCacheKey(levelId: string, query: ScoreQueryOptions): string {
    const userScopeKey =
      query.scope === 'personal' ? String(this.authState.user?.id ?? 0) : 'all-users';
    return `${levelId}::${query.scope}::${userScopeKey}::${query.searchText.toLowerCase()}::${query.page}::${query.pageSize}`;
  }

  private invalidateScoreCacheForLevel(levelId: string): void {
    const prefix = `${levelId}::`;
    for (const key of this.scoreCache.keys()) {
      if (key.startsWith(prefix)) {
        this.scoreCache.delete(key);
      }
    }
  }

  private defaultScoreQuery(): ScoreQueryOptions {
    return {
      scope: 'all',
      searchText: '',
      page: 1,
      pageSize: SCORE_PAGE_SIZE,
    };
  }

  private currentScorePanelQuery(): ScoreQueryOptions {
    const scope = this.scoreScopeSelect.value === 'personal' ? 'personal' : 'all';
    return {
      scope,
      searchText: this.scoreSearchInput.value.trim(),
      page: this.scorePanelQuery.page,
      pageSize: SCORE_PAGE_SIZE,
    };
  }

  private async fetchScorePage(levelId: string, query: ScoreQueryOptions, forceRefresh: boolean): Promise<ScorePageRecord> {
    const key = this.scoreCacheKey(levelId, query);
    if (!forceRefresh) {
      const cached = this.scoreCache.get(key);
      if (cached) {
        return cached;
      }
    }

    const inFlight = this.inFlightScoreRequestMap.get(key);
    if (inFlight) {
      return inFlight;
    }

    const request = fetchScoresPage(levelId, {
      scope: query.scope,
      search: query.searchText,
      page: query.page,
      pageSize: query.pageSize,
    })
      .then((payload) => {
        this.scoreCache.set(key, payload);
        return payload;
      })
      .finally(() => {
        this.inFlightScoreRequestMap.delete(key);
      });
    this.inFlightScoreRequestMap.set(key, request);
    return request;
  }

  private syncScorePanelPagination(result: ScorePageRecord | null): void {
    const totalPages = result?.totalPages ?? 0;
    const page = result?.page ?? this.scorePanelQuery.page;
    this.scorePagePrevButton.disabled = page <= 1;
    this.scorePageNextButton.disabled = totalPages === 0 || page >= totalPages;
    if (!result) {
      this.scorePageText.textContent = `Page ${this.scorePanelQuery.page}`;
      return;
    }

    const displayTotalPages = totalPages === 0 ? 1 : totalPages;
    this.scorePageText.textContent = `Page ${result.page} / ${displayTotalPages}`;
  }

  private async loadScoresForSelectedLevel(forceRefresh: boolean): Promise<void> {
    const snapshot = this.lastSnapshot;
    if (!snapshot) {
      return;
    }

    const level = snapshot.levels[snapshot.selectedLevelIndex];
    if (!level) {
      this.renderScores('none', null);
      return;
    }

    if (this.lastScorePanelLevelId !== level.id) {
      this.lastScorePanelLevelId = level.id;
      this.scorePanelQuery.page = 1;
    }

    await this.loadScoresForLevel(level.id, forceRefresh);
  }

  private async loadScoresForLevel(levelId: string, forceRefresh: boolean): Promise<void> {
    const query = this.currentScorePanelQuery();
    this.scorePanelQuery.scope = query.scope;
    this.scorePanelQuery.searchText = query.searchText;
    if (query.scope === 'personal' && (!this.authState.authenticated || !this.authState.user)) {
      this.scorePanelLastResult = null;
      this.scoreStatus.textContent = 'Sign in to view your personal high scores.';
      this.scoreList.innerHTML = '';
      this.syncScorePanelPagination(null);
      return;
    }

    const nonce = ++this.scorePanelRequestNonce;
    this.scoreStatus.textContent = `Loading scores for ${levelId} (page ${query.page})...`;
    this.syncScorePanelPagination(null);

    try {
      const result = await this.fetchScorePage(levelId, query, forceRefresh);
      if (nonce !== this.scorePanelRequestNonce) {
        return;
      }

      this.scorePanelLastResult = result;
      this.renderScores(levelId, result);
    } catch (error) {
      if (nonce !== this.scorePanelRequestNonce) {
        return;
      }

      this.scorePanelLastResult = null;
      this.scoreStatus.textContent = `Scores unavailable: ${String(error)}`;
      this.scoreList.innerHTML = '';
      this.syncScorePanelPagination(null);
    }
  }

  private async loadLevelClearScores(levelId: string, forceRefresh: boolean): Promise<void> {
    const query = this.defaultScoreQuery();
    this.levelClearScoreStatus.textContent = `Loading scores for ${levelId}...`;
    this.levelClearScoreList.innerHTML = '';
    try {
      const result = await this.fetchScorePage(levelId, query, forceRefresh);

      if (this.lastSnapshot?.levelClearSummary?.levelId !== levelId) {
        return;
      }

      this.renderLevelClearScores(levelId, result.scores, result.total);
    } catch (error) {
      if (this.lastSnapshot?.levelClearSummary?.levelId !== levelId) {
        return;
      }

      this.levelClearScoreStatus.textContent = `Scores unavailable: ${String(error)}`;
      this.levelClearScoreList.innerHTML = '';
    }
  }

  private async loadHudScoresForLevel(levelId: string, forceRefresh: boolean): Promise<void> {
    const query = this.defaultScoreQuery();
    this.hudScoreStatus.textContent = `Loading scores for ${levelId}...`;
    try {
      const result = await this.fetchScorePage(levelId, query, forceRefresh);
      const snapshot = this.lastSnapshot;
      if (!snapshot) {
        return;
      }

      if (snapshot.screen !== 'playing' && snapshot.screen !== 'paused') {
        return;
      }

      if (snapshot.gameState.levelId !== levelId) {
        return;
      }

      this.renderHudScores(levelId, result.scores, result.total);
    } catch (error) {
      this.hudScoreStatus.textContent = `Scores unavailable: ${String(error)}`;
      this.hudScoreList.innerHTML = '';
    }
  }

  private renderLevelClearScores(levelId: string, scores: LevelScoreRecord[], total: number): void {
    this.levelClearScoreList.innerHTML = '';
    if (scores.length === 0) {
      this.levelClearScoreStatus.textContent = `${levelId}: no scores yet.`;
      return;
    }

    this.levelClearScoreStatus.textContent = `${levelId}: showing ${scores.length} of ${total} (lower moves, then lower time)`;
    for (let i = 0; i < scores.length; i += 1) {
      const score = scores[i];
      const item = document.createElement('li');
      item.textContent = `${i + 1}. ${score.playerName} - ${score.moves} moves - ${(score.durationMs / 1000).toFixed(1)}s`;
      this.levelClearScoreList.append(item);
    }
  }

  private renderHudScores(levelId: string, scores: LevelScoreRecord[], total: number): void {
    this.hudScoreList.innerHTML = '';

    if (scores.length === 0) {
      this.hudScoreStatus.textContent = `${levelId}: no scores yet.`;
      return;
    }

    this.hudScoreStatus.textContent = `${levelId}: top ${Math.min(total, SCORE_PAGE_SIZE)} (lower moves, then lower time)`;
    for (let i = 0; i < scores.length; i += 1) {
      const score = scores[i];
      const item = document.createElement('li');
      item.textContent = `${i + 1}. ${score.playerName} - ${score.moves} moves - ${(score.durationMs / 1000).toFixed(1)}s`;
      this.hudScoreList.append(item);
    }
  }

  private renderScores(levelId: string, result: ScorePageRecord | null): void {
    this.scoreList.innerHTML = '';

    if (levelId === 'none' || !result) {
      this.scoreStatus.textContent = 'No level selected.';
      this.syncScorePanelPagination(result);
      return;
    }

    this.syncScorePanelPagination(result);
    if (result.scores.length === 0) {
      if (result.scope === 'personal') {
        this.scoreStatus.textContent = result.search.length > 0
          ? `${levelId}: no personal scores matching "${result.search}".`
          : `${levelId}: no personal scores yet.`;
      } else {
        this.scoreStatus.textContent = result.search.length > 0
          ? `${levelId}: no scores matching "${result.search}".`
          : `${levelId}: no scores yet.`;
      }
      return;
    }

    const startRank = (result.page - 1) * result.pageSize;
    this.scoreStatus.textContent = `${levelId}: showing ${result.scores.length} of ${result.total} (lower moves, then lower time)`;
    for (let i = 0; i < result.scores.length; i += 1) {
      const score = result.scores[i];
      const item = document.createElement('li');
      item.textContent = `${startRank + i + 1}. ${score.playerName} - ${score.moves} moves - ${(score.durationMs / 1000).toFixed(1)}s`;
      this.scoreList.append(item);
    }
  }

  private applyCompletedScoreSubmission(snapshot: ControllerSnapshot): void {
    const submitted = snapshot.latestSubmittedScore;
    if (!submitted) {
      return;
    }

    if (submitted.sequence <= this.lastHandledScoreSubmissionSequence) {
      return;
    }

    this.lastHandledScoreSubmissionSequence = submitted.sequence;
    this.invalidateScoreCacheForLevel(submitted.levelId);

    const selectedLevel = snapshot.levels[snapshot.selectedLevelIndex];
    if (selectedLevel?.id === submitted.levelId) {
      void this.loadScoresForSelectedLevel(true);
    }

    if (snapshot.levelClearSummary?.levelId === submitted.levelId) {
      void this.loadLevelClearScores(submitted.levelId, true);
    }

    if (snapshot.screen === 'playing' || snapshot.screen === 'paused') {
      if (snapshot.gameState.levelId === submitted.levelId) {
        void this.loadHudScoresForLevel(submitted.levelId, true);
      }
    }
  }

  private buildPalette(): void {
    this.editorPaletteRoot.innerHTML = '';
    this.editorPaletteButtons = new Map<string, HTMLButtonElement>();

    for (const tile of EDITOR_TILE_PALETTE) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tile = tile;
      button.className = `editor-palette-tile ${tileClass(tile)}`;
      button.textContent = tile === ' ' ? 'space' : tile;
      button.title = describeTile(tile);
      button.addEventListener('click', () => {
        this.editorTile = tile;
        this.syncSelectedTile();
      });
      this.editorPaletteRoot.append(button);
      this.editorPaletteButtons.set(tile, button);
    }

    this.syncSelectedTile();
  }

  private syncSelectedTile(): void {
    this.editorSelectedTile.textContent = describeTile(this.editorTile);
    for (const [tile, button] of this.editorPaletteButtons) {
      button.classList.toggle('editor-palette-selected', tile === this.editorTile);
    }
  }

  private createBlankGrid(width: number, height: number): string[][] {
    const safeWidth = sanitizeDimension(width, 25);
    const safeHeight = sanitizeDimension(height, 16);
    const grid = createGrid(safeWidth, safeHeight, '#');

    for (let y = 1; y < safeHeight - 1; y += 1) {
      for (let x = 1; x < safeWidth - 1; x += 1) {
        grid[y][x] = ' ';
      }
    }

    if (safeWidth >= 3 && safeHeight >= 3) {
      grid[1][1] = 'P';
      grid[safeHeight - 2][safeWidth - 2] = '!';
    }

    return grid;
  }

  private defaultEditorId(): string {
    const existingIds = this.lastSnapshot?.levels.map((level) => level.id) ?? [];
    return nextCustomLevelId(existingIds);
  }

  private normalizeEditorLevelName(raw: string): string {
    return raw.trim().replace(/\s+/g, ' ').slice(0, 64);
  }

  private refreshEditorAutoId(): void {
    const snapshot = this.lastSnapshot ?? this.controller.getSnapshot();
    const levelName = this.normalizeEditorLevelName(this.editorNameInput.value);

    if (this.editorLoadedLevelId) {
      this.editorIdInput.value = this.editorLoadedLevelId;
      return;
    }

    if (this.editorTestingPublishLevelId) {
      this.editorIdInput.value = this.editorTestingPublishLevelId;
      return;
    }

    if (!levelName) {
      this.editorIdInput.value = this.defaultEditorId();
      return;
    }

    const baseId = levelIdFromInput(levelName);
    this.editorIdInput.value = this.resolveSaveId(baseId, snapshot);
  }

  private renderEditorGrid(): void {
    const width = this.editorGrid[0]?.length ?? 0;
    this.editorGridRoot.innerHTML = '';
    this.editorGridRoot.style.gridTemplateColumns = `repeat(${width}, 1fr)`;

    for (let y = 0; y < this.editorGrid.length; y += 1) {
      for (let x = 0; x < this.editorGrid[y].length; x += 1) {
        const tile = this.editorGrid[y][x];
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `editor-grid-cell ${tileClass(tile)}`;
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        cell.textContent = tile === ' ' ? '' : tile;
        cell.title = `${describeTile(tile)} @ (${x + 1}, ${y + 1})`;
        this.editorGridRoot.append(cell);
      }
    }

    this.editorWidthInput.value = String(width);
    this.editorHeightInput.value = String(this.editorGrid.length);
  }

  private showEditorFeedback(message: string, isError = false): void {
    this.editorFeedback.textContent = message;
    this.editorFeedback.classList.toggle('editor-feedback-error', isError);
  }

  private editorCellFromPointer(event: PointerEvent): HTMLElement | null {
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (!hit) {
      return null;
    }

    const cell = hit.closest('.editor-grid-cell');
    return cell instanceof HTMLElement ? cell : null;
  }

  private paintGridCell(target: HTMLElement): void {
    const x = Number.parseInt(target.dataset.x ?? '-1', 10);
    const y = Number.parseInt(target.dataset.y ?? '-1', 10);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
      return;
    }

    if (!this.editorGrid[y] || this.editorGrid[y][x] === undefined) {
      return;
    }

    if (this.editorGrid[y][x] === this.editorTile) {
      return;
    }

    this.editorGrid[y][x] = this.editorTile;
    target.className = `editor-grid-cell ${tileClass(this.editorTile)}`;
    target.textContent = this.editorTile === ' ' ? '' : this.editorTile;
    target.title = `${describeTile(this.editorTile)} @ (${x + 1}, ${y + 1})`;
  }

  private openEditorForCopiedLevel(level: ParsedLevel): void {
    this.stopSolverPlayback();
    const snapshot = this.controller.getSnapshot();
    const levelIndex = snapshot.levels.findIndex((entry) => entry.id === level.id);
    const sourceName = this.getDisplayLevelName(level, levelIndex >= 0 ? levelIndex : 0);
    this.editorGrid = cloneGrid(level.grid);
    this.editorTestingPublishLevelId = null;
    this.editorLoadedLevelId = null;
    this.editorNameInput.value = `${sourceName} Copy`;
    this.refreshEditorAutoId();
    this.renderEditorGrid();
    this.controller.openEditor();
    this.showEditorFeedback(
      this.authState.authenticated
        ? `Copied ${level.id}. Set your level name and publish.`
        : `Copied ${level.id}. Sign in to publish your copy.`,
    );
  }

  private openEditorForBlankLevel(): void {
    this.stopSolverPlayback();
    this.editorGrid = this.createBlankGrid(25, 16);
    this.editorTestingPublishLevelId = null;
    this.editorLoadedLevelId = null;
    this.editorNameInput.value = '';
    this.refreshEditorAutoId();
    this.renderEditorGrid();
    this.controller.openEditor();
    this.showEditorFeedback(
      this.authState.authenticated ? 'Created blank level template.' : 'Created blank template. Sign in to publish.',
    );
  }

  private autoGenerateEditorLevel(): void {
    if (!this.isAdminUser()) {
      this.showEditorFeedback('Admin sign-in required to auto-generate levels.', true);
      return;
    }

    const width = this.editorGrid[0]?.length ?? 25;
    const height = this.editorGrid.length || 16;
    const defaultSeed = `seed-${Date.now().toString(36).slice(-8)}`;
    const seedRaw = window.prompt('Seed (< 32 chars):', defaultSeed);
    if (seedRaw === null) {
      return;
    }

    const playersRaw = window.prompt('Number of players (integer >= 1):', '1');
    if (playersRaw === null) {
      return;
    }

    const difficultyRaw = window.prompt('Difficulty (minimum solve moves, 1-100):', '20');
    if (difficultyRaw === null) {
      return;
    }

    const seed = seedRaw.trim();
    const players = Number.parseInt(playersRaw, 10);
    const difficulty = Number.parseInt(difficultyRaw, 10);
    if (!Number.isInteger(players) || !Number.isInteger(difficulty)) {
      this.showEditorFeedback('Players and difficulty must be integers.', true);
      return;
    }

    try {
      const generated = generateAdminLevel({
        seed,
        players,
        difficulty,
        width,
        height,
        maxAttempts: 96,
      });

      this.stopSolverPlayback();
      this.editorGrid = cloneGrid(generated.grid);
      this.editorTestingPublishLevelId = null;
      this.editorLoadedLevelId = null;
      if (this.editorNameInput.value.trim().length === 0 || this.editorNameInput.value.startsWith('Generated ')) {
        this.editorNameInput.value = `Generated ${seed}`.slice(0, 64);
      }
      this.refreshEditorAutoId();
      this.renderEditorGrid();
      this.showEditorFeedback(
        `Generated ${width}x${height} level (${players} player${players === 1 ? '' : 's'}) solved in ${generated.minMoves} moves.`,
      );
    } catch (error) {
      this.showEditorFeedback(`Auto-generate failed: ${formatError(error)}`, true);
    }
  }

  private async toggleAdminSolverForPlaytest(): Promise<void> {
    if (!this.isAdminUser()) {
      this.statusText.textContent = 'Admin sign-in required to run solver playback.';
      return;
    }

    if (this.solverPlayback) {
      this.stopSolverPlayback('Solver playback stopped.');
      return;
    }

    if (this.adminSolverBusy) {
      return;
    }

    const snapshot = this.controller.getSnapshot();
    const runtimeTestLevelId = this.editorTestingPublishLevelId
      ? `${EDITOR_TEST_LEVEL_ID}-${this.editorTestingPublishLevelId}`
      : null;
    if (!runtimeTestLevelId || snapshot.gameState.levelId !== runtimeTestLevelId) {
      this.statusText.textContent = 'Start Test + Play in the editor before running solver playback.';
      return;
    }

    const level = snapshot.levels.find((entry) => entry.id === runtimeTestLevelId);
    if (!level) {
      this.statusText.textContent = 'Solver unavailable: test level not found.';
      return;
    }

    this.adminSolverBusy = true;
    this.refreshAdminEditorControls(snapshot);
    this.statusText.textContent = `Solving ${runtimeTestLevelId}...`;
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });

    const solved = solveLevelForAdmin(level, {
      maxMoves: 420,
      maxVisited: 500000,
    });
    this.adminSolverBusy = false;

    if (!solved.path || solved.minMoves === null) {
      this.refreshAdminEditorControls(this.controller.getSnapshot());
      this.statusText.textContent = solved.truncated
        ? 'Solver search aborted: state space limit reached.'
        : 'Solver could not find a valid path for this level.';
      return;
    }

    this.controller.restartCurrentLevel();
    this.startSolverPlayback(runtimeTestLevelId, solved.path);
    this.statusText.textContent = `Solver running (${solved.minMoves} moves).`;
    this.refreshAdminEditorControls(this.controller.getSnapshot());
  }

  private startSolverPlayback(levelId: string, path: Direction[]): void {
    this.stopSolverPlayback();
    const baseMoves = this.controller.getSnapshot().gameState.moves;
    const timerId = window.setInterval(() => {
      const playback = this.solverPlayback;
      if (!playback) {
        return;
      }

      const snapshot = this.controller.getSnapshot();
      if (snapshot.gameState.levelId !== playback.levelId) {
        this.stopSolverPlayback();
        return;
      }

      if (snapshot.screen === 'paused') {
        return;
      }

      if (snapshot.screen !== 'playing') {
        this.stopSolverPlayback();
        return;
      }

      if (snapshot.gameState.lastEvent === 'level-reset') {
        this.stopSolverPlayback('Solver stopped: level reset triggered.', true);
        return;
      }

      const expectedMoves = playback.baseMoves + playback.nextIndex;
      if (snapshot.gameState.moves < expectedMoves) {
        return;
      }

      if (snapshot.gameState.moves > expectedMoves) {
        this.stopSolverPlayback('Solver stopped: manual input changed state.', true);
        return;
      }

      if (playback.nextIndex >= playback.path.length) {
        this.stopSolverPlayback('Solver playback complete.');
        return;
      }

      this.controller.queueDirection(playback.path[playback.nextIndex]);
      playback.nextIndex += 1;
    }, 40);

    this.solverPlayback = {
      levelId,
      path,
      nextIndex: 0,
      baseMoves,
      timerId,
    };
  }

  private stopSolverPlayback(message?: string, isError = false): void {
    if (!this.solverPlayback) {
      if (message) {
        this.statusText.textContent = message;
      }
      return;
    }

    window.clearInterval(this.solverPlayback.timerId);
    this.solverPlayback = null;
    if (message) {
      this.statusText.textContent = message;
    }
    if (isError && this.lastSnapshot?.screen === 'editor') {
      this.showEditorFeedback(this.statusText.textContent || 'Solver stopped.', true);
    }
    this.refreshAdminEditorControls(this.lastSnapshot ?? this.controller.getSnapshot());
  }

  private resizeEditorGrid(): void {
    const width = sanitizeDimension(Number.parseInt(this.editorWidthInput.value, 10), this.editorGrid[0]?.length ?? 25);
    const height = sanitizeDimension(Number.parseInt(this.editorHeightInput.value, 10), this.editorGrid.length || 16);

    this.editorGrid = resizeGrid(this.editorGrid, width, height, '#');
    this.renderEditorGrid();
    this.showEditorFeedback(`Resized to ${width}x${height}.`);
  }

  private resolveSaveId(baseId: string, snapshot: ControllerSnapshot): string {
    const allIds = new Set(snapshot.levels.map((level) => level.id));
    let candidate = baseId || this.defaultEditorId();

    if (
      !allIds.has(candidate) ||
      candidate === this.editorLoadedLevelId ||
      candidate === this.editorTestingPublishLevelId
    ) {
      return candidate;
    }

    const stem = candidate;
    let suffix = 2;
    while (allIds.has(candidate)) {
      candidate = `${stem}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private getPublishLevelTarget(snapshot: ControllerSnapshot): { id: string; name: string } | null {
    const levelName = this.normalizeEditorLevelName(this.editorNameInput.value);
    if (!levelName) {
      this.showEditorFeedback('Enter a level name before testing or publishing.', true);
      this.editorNameInput.focus();
      return null;
    }

    const baseId = this.editorLoadedLevelId ?? this.editorTestingPublishLevelId ?? levelIdFromInput(levelName);
    const publishId = this.resolveSaveId(baseId, snapshot);
    this.editorIdInput.value = publishId;
    return {
      id: publishId,
      name: levelName,
    };
  }

  private ensureEditorTestPlayerName(): void {
    const existingName = this.controller.getPlayerName();
    if (existingName) {
      return;
    }

    if (this.authState.authenticated && this.authState.user) {
      this.controller.setPlayerName(this.authState.user.playerName);
      return;
    }

    this.controller.setPlayerName('Guest');
  }

  private validateEditorGrid(): { errors: string[]; warnings: string[] } | null {
    const validation = validateGridForEditor(this.editorGrid);
    if (validation.errors.length > 0) {
      this.showEditorFeedback(validation.errors.join(' '), true);
      return null;
    }

    return validation;
  }

  private startEditorTestPlay(): void {
    const snapshot = this.lastSnapshot;
    if (!snapshot) {
      return;
    }

    this.stopSolverPlayback();
    this.ensureEditorTestPlayerName();

    if (!this.validateEditorGrid()) {
      return;
    }

    const publishTarget = this.getPublishLevelTarget(snapshot);
    if (!publishTarget) {
      return;
    }

    const runtimeLevelId = `${EDITOR_TEST_LEVEL_ID}-${publishTarget.id}`;
    const text = serializeGrid(this.editorGrid);

    try {
      ensureParseableLevel(runtimeLevelId, this.editorGrid);
    } catch (error) {
      this.showEditorFeedback(String(error), true);
      return;
    }

    const parsed = parseLevelText(runtimeLevelId, text, publishTarget.name);
    const levelIndex = this.controller.upsertLevel(parsed);
    this.editorTestingPublishLevelId = publishTarget.id;
    this.editorLoadedLevelId = publishTarget.id;
    this.controller.startLevel(levelIndex);
    this.showEditorFeedback(
      `Testing ${publishTarget.id}. Beat it while signed in, then publish from the editor.`,
    );
  }

  private returnFromEditorTest(): void {
    this.stopSolverPlayback();
    if (!this.editorTestingPublishLevelId) {
      this.controller.openEditor();
      return;
    }

    const publishLevelId = this.editorTestingPublishLevelId;
    const runtimeLevelId = `${EDITOR_TEST_LEVEL_ID}-${publishLevelId}`;
    this.editorTestingPublishLevelId = null;
    this.controller.removeLevel(runtimeLevelId);
    this.controller.openEditor();
    this.editorLoadedLevelId = publishLevelId;
    this.refreshEditorAutoId();
    this.renderEditorGrid();
    this.showEditorFeedback(`Back in editor for ${publishLevelId}. Publish when ready.`);
  }

  private async publishEditorLevel(): Promise<void> {
    const snapshot = this.lastSnapshot;
    if (!snapshot) {
      return;
    }

    if (!this.authState.authenticated || !this.authState.user) {
      this.showEditorFeedback('Sign in to publish levels.', true);
      return;
    }

    const validation = this.validateEditorGrid();
    if (!validation) {
      return;
    }

    const publishTarget = this.getPublishLevelTarget(snapshot);
    if (!publishTarget) {
      return;
    }

    try {
      ensureParseableLevel(publishTarget.id, this.editorGrid);
    } catch (error) {
      this.showEditorFeedback(String(error), true);
      return;
    }

    const text = serializeGrid(this.editorGrid);

    try {
      await this.controller.waitForPendingScoreSubmissions();
      const saved = await saveCustomLevel({
        id: publishTarget.id,
        name: publishTarget.name,
        text,
      });

      const parsed = parseLevelText(saved.id, saved.text, saved.name);
      this.controller.upsertLevel(parsed);
      this.editorLoadedLevelId = saved.id;
      this.editorNameInput.value = saved.name;
      this.refreshEditorAutoId();
      this.customLevelOwners.set(saved.id, {
        ownerUserId: saved.ownerUserId,
        ownerUsername: saved.ownerUsername,
      });
      this.invalidateScoreCacheForLevel(saved.id);

      if (validation.warnings.length > 0) {
        this.showEditorFeedback(`Published ${saved.id}. Warning: ${validation.warnings.join(' ')}`);
        return;
      }

      this.showEditorFeedback(`Published ${saved.id} to backend.`);
    } catch (error) {
      this.showEditorFeedback(`Publish failed: ${formatError(error)}`, true);
    }
  }

  private async deleteEditorLevel(): Promise<void> {
    if (!this.authState.authenticated || !this.authState.user) {
      this.showEditorFeedback('Sign in to delete published levels.', true);
      return;
    }

    const levelId = levelIdFromInput(this.editorIdInput.value);
    if (!levelId) {
      this.showEditorFeedback('Enter a level id to delete.', true);
      this.editorIdInput.focus();
      return;
    }

    const confirmed = window.confirm(`Delete published level "${levelId}" permanently?`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteCustomLevel({ levelId });
      this.invalidateScoreCacheForLevel(levelId);
      this.customLevelOwners.delete(levelId);
      this.controller.removeLevel(levelId);
      this.editorLoadedLevelId = null;
      this.editorNameInput.value = '';
      this.refreshEditorAutoId();
      this.showEditorFeedback(`Deleted ${levelId}.`);
    } catch (error) {
      this.showEditorFeedback(`Delete failed: ${formatError(error)}`, true);
    }
  }

  private exportEditorText(): void {
    const levelId = levelIdFromInput(this.editorIdInput.value) || 'custom-level';
    const blob = new Blob([serializeGrid(this.editorGrid)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${levelId}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    this.showEditorFeedback(`Downloaded ${levelId}.txt`);
  }
}
