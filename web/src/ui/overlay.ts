import type { ControllerSnapshot, GameController } from '../app/gameController';
import { parseLevelText } from '../core/levelParser';
import type { ParsedLevel } from '../core/types';
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
  fetchTopScores,
  fetchUserProgress,
  initializeApiSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  saveCustomLevel,
  saveUserProgress,
  type AuthState,
  type LevelScoreRecord,
} from '../runtime/backendApi';
import { isTextInputFocused } from '../runtime/inputFocus';
import { getLevelLabel } from '../runtime/levelMeta';
import { LockstepIntroCinematic } from './introCinematic';

const EDITOR_TEST_LEVEL_ID = '__editor-test-level';

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

export class OverlayUI {
  private readonly root: HTMLElement;

  private readonly controller: GameController;

  private readonly levelSelect: HTMLSelectElement;

  private readonly levelSelectGrid: HTMLElement;

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

  private readonly mobileFlipToggle: HTMLInputElement;

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

  private readonly introSettingsPanel: HTMLElement;

  private readonly introSettingsButton: HTMLButtonElement;

  private readonly introSettingsCloseButton: HTMLButtonElement;

  private readonly introMusicVolumeSlider: HTMLInputElement;

  private readonly introSfxVolumeSlider: HTMLInputElement;

  private readonly introLightingToggle: HTMLInputElement;

  private readonly introCameraSwayToggle: HTMLInputElement;

  private readonly introShowFpsToggle: HTMLInputElement;

  private readonly introMobileFlipToggle: HTMLInputElement;

  private readonly introCinematic: LockstepIntroCinematic;

  private readonly scoreList: HTMLOListElement;

  private readonly scoreStatus: HTMLElement;

  private readonly hudScoreboard: HTMLElement;

  private readonly hudScoreList: HTMLOListElement;

  private readonly hudScoreStatus: HTMLElement;

  private readonly editorIdInput: HTMLInputElement;

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

  private readonly pauseTestBackButton: HTMLButtonElement;

  private readonly mobileSwipeHint: HTMLElement;

  private readonly mobileFlipFab: HTMLButtonElement;

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

  private lastSnapshot: ControllerSnapshot | null = null;

  private readonly scoreCache = new Map<string, LevelScoreRecord[]>();

  private scoreRequestNonce = 0;

  private inFlightScoreLevelId: string | null = null;

  private lastRenderedScreen: ControllerSnapshot['screen'] | null = null;

  private lastRenderedHudLevelId: string | null = null;

  private levelSelectCardButtons = new Map<number, HTMLButtonElement>();

  public constructor(root: HTMLElement, controller: GameController) {
    this.root = root;
    this.controller = controller;

    this.root.innerHTML = this.buildMarkup();

    this.panels = {
      intro: asElement<HTMLElement>(this.root, '[data-panel="intro"]'),
      main: asElement<HTMLElement>(this.root, '[data-panel="main"]'),
      levelSelect: asElement<HTMLElement>(this.root, '[data-panel="level-select"]'),
      settings: asElement<HTMLElement>(this.root, '[data-panel="settings"]'),
      editor: asElement<HTMLElement>(this.root, '[data-panel="editor"]'),
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
    this.introSettingsPanel = asElement<HTMLElement>(this.root, '#intro-settings-panel');
    this.introSettingsButton = asElement<HTMLButtonElement>(this.root, '#btn-intro-settings-toggle');
    this.introSettingsCloseButton = asElement<HTMLButtonElement>(this.root, '#btn-intro-settings-close');
    this.introMusicVolumeSlider = asElement<HTMLInputElement>(this.root, '#intro-settings-music-volume');
    this.introSfxVolumeSlider = asElement<HTMLInputElement>(this.root, '#intro-settings-sfx-volume');
    this.introLightingToggle = asElement<HTMLInputElement>(this.root, '#intro-settings-lighting');
    this.introCameraSwayToggle = asElement<HTMLInputElement>(this.root, '#intro-settings-camera-sway');
    this.introShowFpsToggle = asElement<HTMLInputElement>(this.root, '#intro-settings-show-fps');
    this.introMobileFlipToggle = asElement<HTMLInputElement>(this.root, '#intro-settings-mobile-flip');
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
    this.mobileFlipToggle = asElement<HTMLInputElement>(this.root, '#settings-mobile-flip');
    this.scoreList = asElement<HTMLOListElement>(this.root, '#score-list');
    this.scoreStatus = asElement<HTMLElement>(this.root, '#score-status');
    this.hudScoreboard = asElement<HTMLElement>(this.root, '#hud-scoreboard');
    this.hudScoreList = asElement<HTMLOListElement>(this.root, '#hud-score-list');
    this.hudScoreStatus = asElement<HTMLElement>(this.root, '#hud-score-status');

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
    this.pauseTestBackButton = asElement<HTMLButtonElement>(this.root, '#btn-test-back-editor');
    this.mobileSwipeHint = asElement<HTMLElement>(this.root, '#mobile-swipe-hint');
    this.mobileFlipFab = asElement<HTMLButtonElement>(this.root, '#btn-mobile-flip-fab');
    this.mobileOnlySettings = Array.from(this.root.querySelectorAll<HTMLElement>('[data-mobile-only]'));
    this.isMobileDevice = isLikelyMobileDevice();
    if (!this.isMobileDevice) {
      for (const setting of this.mobileOnlySettings) {
        setting.hidden = true;
      }
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
          <button type="button" id="btn-intro-settings-toggle" aria-label="Open intro settings">Tune</button>
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
            <label class="checkbox-row" data-mobile-only>
              <input id="intro-settings-mobile-flip" type="checkbox" />
              Rotate board 90 deg clockwise
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
            <section class="account-panel">
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
            </section>
            <div class="intro-level-readout">
              Current Level
              <strong id="intro-current-level">Level 1</strong>
            </div>
            <p class="intro-level-hint">Press <kbd>ESC</kbd> in-game to open Level Select.</p>
            <p class="intro-level-hint" data-mobile-only>Mobile: swipe anywhere to move. Use Rotate in settings.</p>
          </div>
          <div class="button-row intro-button-row">
            <button type="button" id="btn-intro-start">Start</button>
            <button type="button" id="btn-intro-level-select">Levels</button>
          </div>
        </aside>
      </section>

      <div class="menu-status" id="menu-status" aria-live="polite"></div>
      <div class="mobile-swipe-hint" id="mobile-swipe-hint" data-mobile-only hidden>
        Swipe anywhere to move. Use Rotate if you want landscape play.
      </div>
      <button type="button" class="mobile-flip-fab" id="btn-mobile-flip-fab" data-mobile-only hidden>
        Rotate: Off
      </button>
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
          <div>
            <h2>Level Select</h2>
            <p>Pick a map to play, copy any map into the editor, or create a blank one with +.</p>
          </div>
          <div class="level-select-header-actions">
            <button type="button" id="btn-level-start">Play Selected</button>
            <button type="button" id="btn-level-back">Back</button>
          </div>
        </header>

        <div class="level-select-layout">
          <section class="level-select-grid-panel">
            <select id="level-select-input" class="level-select-hidden-input" aria-hidden="true" tabindex="-1"></select>
            <div id="level-select-grid" class="level-select-grid" role="listbox" aria-label="Level grid"></div>
          </section>

          <aside class="level-select-score-panel">
            <h3 id="level-select-current">Level 1</h3>
            <div id="score-status" class="score-status">Top 10 scores (lower is better)</div>
            <ol id="score-list" class="score-list level-select-score-list"></ol>
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
        <label class="checkbox-row" data-mobile-only>
          <input id="settings-mobile-flip" type="checkbox" />
          Rotate board 90 deg clockwise
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
              <label for="editor-level-id">Level ID</label>
              <input id="editor-level-id" type="text" placeholder="custom-level-1" />
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

      <section class="menu-panel" data-panel="pause" hidden>
        <h2>Paused</h2>
        <p>Resume play or jump to another level.</p>
        <div class="button-row">
          <button type="button" id="btn-resume">Resume</button>
          <button type="button" id="btn-restart">Restart</button>
          <button type="button" id="btn-pause-level-select">Level Select</button>
          <button type="button" id="btn-test-back-editor" hidden>Back to Editor (Test)</button>
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
      this.closeIntroSettings();
      this.openLevelSelectFromMenu();
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
      this.introSettingsPanel.hidden = !this.introSettingsPanel.hidden;
      if (!this.introSettingsPanel.hidden) {
        this.introMusicVolumeSlider.focus();
      }
    });

    this.introSettingsCloseButton.addEventListener('click', () => {
      this.closeIntroSettings();
      this.introSettingsButton.focus();
    });

    this.introPanel.addEventListener('pointerdown', (event) => {
      if (this.introSettingsPanel.hidden) {
        return;
      }

      const target = event.target as Node;
      const clickedToggle = target === this.introSettingsButton || this.introSettingsButton.contains(target);
      if (clickedToggle) {
        return;
      }

      const clickedPanel = this.introSettingsPanel.contains(target);
      if (!clickedPanel) {
        this.closeIntroSettings();
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

    asElement<HTMLButtonElement>(this.root, '#btn-editor-export').addEventListener('click', () => {
      this.exportEditorText();
    });

    asElement<HTMLButtonElement>(this.root, '#btn-editor-back').addEventListener('click', () => {
      this.controller.openMainMenu();
    });

    this.pauseTestBackButton.addEventListener('click', () => {
      this.returnFromEditorTest();
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

    this.mobileFlipToggle.addEventListener('change', () => {
      this.controller.setMobileRotateClockwise(this.mobileFlipToggle.checked);
    });

    this.introMobileFlipToggle.addEventListener('change', () => {
      this.controller.setMobileRotateClockwise(this.introMobileFlipToggle.checked);
    });

    this.mobileFlipFab.addEventListener('click', () => {
      const current = this.controller.getSnapshot().settings.mobileRotateClockwise;
      this.controller.setMobileRotateClockwise(!current);
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
        if (event.key === 'Escape' && !this.introSettingsPanel.hidden) {
          event.preventDefault();
          this.closeIntroSettings();
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

    if (!signedIn && snapshot.playerName.trim().length > 0 && this.accountPlayerNameInput.value.length === 0) {
      this.accountPlayerNameInput.value = snapshot.playerName;
    }
  }

  private setAccountFeedback(message: string, isError = false): void {
    this.accountFeedback.textContent = message;
    this.accountFeedback.classList.toggle('account-feedback-error', isError);
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

    this.closeIntroSettings();
    this.controller.startSelectedLevel();
  }

  private closeIntroSettings(): void {
    this.introSettingsPanel.hidden = true;
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
    this.mobileFlipToggle.checked = snapshot.settings.mobileRotateClockwise;
    this.introMobileFlipToggle.checked = snapshot.settings.mobileRotateClockwise;
    this.statusText.textContent = snapshot.statusMessage ?? '';
    const currentLevel = snapshot.levels[snapshot.selectedLevelIndex];
    if (currentLevel) {
      const label = getLevelLabel(currentLevel.id, snapshot.selectedLevelIndex);
      this.introCurrentLevelText.textContent = label;
      this.mainCurrentLevelText.textContent = label;
      this.levelSelectCurrentText.textContent = `${label} (${currentLevel.id})`;
    }

    const canPlay = snapshot.playerName.trim().length > 0;
    this.playButton.disabled = !canPlay;
    this.levelStartButton.disabled = !canPlay;
    this.introStartButton.disabled = !canPlay;
    this.introLevelSelectButton.disabled = !canPlay;
    this.pauseLevelSelectButton.disabled = !canPlay;
    this.editorSavePlayButton.disabled = false;
    this.pauseTestBackButton.hidden = !this.editorTestingPublishLevelId;
    const showMobileGameUi =
      this.isMobileDevice &&
      canPlay &&
      (snapshot.screen === 'playing' || snapshot.screen === 'paused' || snapshot.screen === 'level-select');
    this.mobileFlipFab.hidden = !showMobileGameUi;
    this.mobileFlipFab.textContent = snapshot.settings.mobileRotateClockwise ? 'Rotate: On' : 'Rotate: Off';
    const showSwipeHint = this.isMobileDevice && snapshot.screen === 'playing' && snapshot.gameState.moves === 0;
    this.mobileSwipeHint.hidden = !showSwipeHint;

    this.panels.intro.hidden = snapshot.screen !== 'intro';
    this.panels.main.hidden = snapshot.screen !== 'main';
    this.panels.levelSelect.hidden = snapshot.screen !== 'level-select';
    this.panels.settings.hidden = snapshot.screen !== 'settings';
    this.panels.editor.hidden = snapshot.screen !== 'editor';
    this.panels.pause.hidden = snapshot.screen !== 'paused';
    this.hudScoreboard.hidden = !(snapshot.screen === 'playing' || snapshot.screen === 'paused');

    if (snapshot.screen === 'intro') {
      this.introCinematic.start();
    } else {
      this.introCinematic.stop();
      this.closeIntroSettings();
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
        this.editorIdInput.focus();
      }
    }

    if (snapshot.screen === 'level-select') {
      void this.loadScoresForSelectedLevel(false);
    }

    this.refreshAccountUi(snapshot);
    this.syncSavedProgress(snapshot);

    if (snapshot.screen === 'playing' || snapshot.screen === 'paused') {
      const currentLevelId = snapshot.gameState.levelId;
      if (this.lastRenderedHudLevelId !== currentLevelId) {
        this.lastRenderedHudLevelId = currentLevelId;
        void this.loadScoresForLevel(currentLevelId, false);
      }
    } else {
      this.lastRenderedHudLevelId = null;
    }

    this.root.classList.toggle('overlay-hidden', snapshot.screen === 'playing');
    this.root.classList.toggle('editor-screen-active', snapshot.screen === 'editor');
    this.root.classList.toggle('level-select-screen-active', snapshot.screen === 'level-select');
    const gameShell = document.querySelector<HTMLElement>('#game-shell');
    if (gameShell) {
      gameShell.classList.toggle('editor-screen-active', snapshot.screen === 'editor');
      gameShell.classList.toggle('level-select-screen-active', snapshot.screen === 'level-select');
      gameShell.classList.toggle(
        'mobile-rotate-clockwise',
        this.isMobileDevice && snapshot.settings.mobileRotateClockwise,
      );
    }
    this.lastRenderedScreen = snapshot.screen;
  }

  private syncLevelOptions(snapshot: ControllerSnapshot): void {
    const signature = snapshot.levels.map((level) => level.id).join('|');
    if (this.levelSelect.dataset.signature !== signature) {
      this.levelSelect.innerHTML = '';
      this.levelSelectGrid.innerHTML = '';
      this.levelSelectCardButtons.clear();
      snapshot.levels.forEach((level, index) => {
        const menuOption = document.createElement('option');
        menuOption.value = String(index);
        menuOption.textContent = `${getLevelLabel(level.id, index)} (${level.id})`;
        this.levelSelect.append(menuOption);

        const { container, selectButton } = this.createLevelSelectCard(level, index);
        this.levelSelectGrid.append(container);
        this.levelSelectCardButtons.set(index, selectButton);
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
      const card = button.closest('.level-card');
      if (card) {
        card.classList.toggle('level-card-selected', isSelected);
        card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      }
    }
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
    card.append(copyButton);

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
    cardTitle.textContent = getLevelLabel(level.id, index);
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

  private async loadScoresForSelectedLevel(forceRefresh: boolean): Promise<void> {
    const snapshot = this.lastSnapshot;
    if (!snapshot) {
      return;
    }

    const level = snapshot.levels[snapshot.selectedLevelIndex];
    if (!level) {
      this.renderScores('none', []);
      return;
    }

    await this.loadScoresForLevel(level.id, forceRefresh);
  }

  private async loadScoresForLevel(levelId: string, forceRefresh: boolean): Promise<void> {
    if (!forceRefresh && this.scoreCache.has(levelId)) {
      this.renderScores(levelId, this.scoreCache.get(levelId) ?? []);
      return;
    }

    if (!forceRefresh && this.inFlightScoreLevelId === levelId) {
      return;
    }

    const nonce = ++this.scoreRequestNonce;
    this.inFlightScoreLevelId = levelId;
    this.scoreStatus.textContent = `Loading scores for ${levelId}...`;
    this.hudScoreStatus.textContent = `Loading scores for ${levelId}...`;

    try {
      const scores = await fetchTopScores(levelId);
      if (nonce !== this.scoreRequestNonce) {
        return;
      }

      this.inFlightScoreLevelId = null;
      this.scoreCache.set(levelId, scores);
      this.renderScores(levelId, scores);
    } catch (error) {
      if (nonce !== this.scoreRequestNonce) {
        return;
      }

      this.inFlightScoreLevelId = null;
      this.scoreStatus.textContent = `Scores unavailable: ${String(error)}`;
      this.hudScoreStatus.textContent = `Scores unavailable: ${String(error)}`;
      this.scoreList.innerHTML = '';
      this.hudScoreList.innerHTML = '';
    }
  }

  private renderScores(levelId: string, scores: LevelScoreRecord[]): void {
    this.scoreList.innerHTML = '';
    this.hudScoreList.innerHTML = '';

    const applyScore = (list: HTMLOListElement, score: LevelScoreRecord, index: number): void => {
      const item = document.createElement('li');
      item.textContent = `${index + 1}. ${score.playerName} - ${score.moves} moves - ${(score.durationMs / 1000).toFixed(1)}s`;
      list.append(item);
    };

    if (levelId === 'none') {
      this.scoreStatus.textContent = 'No level selected.';
      this.hudScoreStatus.textContent = 'No level selected.';
      return;
    }

    const header = `${levelId}: top ${Math.min(scores.length, 10)} (lower moves, then lower time)`;

    if (scores.length === 0) {
      this.scoreStatus.textContent = `${levelId}: no scores yet.`;
      this.hudScoreStatus.textContent = `${levelId}: no scores yet.`;
      return;
    }

    this.scoreStatus.textContent = header;
    this.hudScoreStatus.textContent = header;
    for (let i = 0; i < scores.length; i += 1) {
      const score = scores[i];
      applyScore(this.scoreList, score, i);
      applyScore(this.hudScoreList, score, i);
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
    this.editorGrid = cloneGrid(level.grid);
    this.editorTestingPublishLevelId = null;
    this.editorLoadedLevelId = null;
    this.editorIdInput.value = this.defaultEditorId();
    this.renderEditorGrid();
    this.controller.openEditor();
    this.showEditorFeedback(
      this.authState.authenticated
        ? `Copied ${level.id}. Publish with a new level id.`
        : `Copied ${level.id}. Sign in to publish your copy.`,
    );
  }

  private openEditorForBlankLevel(): void {
    this.editorGrid = this.createBlankGrid(25, 16);
    this.editorTestingPublishLevelId = null;
    this.editorLoadedLevelId = null;
    this.editorIdInput.value = this.defaultEditorId();
    this.renderEditorGrid();
    this.controller.openEditor();
    this.showEditorFeedback(
      this.authState.authenticated ? 'Created blank level template.' : 'Created blank template. Sign in to publish.',
    );
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

  private getPublishLevelId(snapshot: ControllerSnapshot): string {
    const requestedId = levelIdFromInput(this.editorIdInput.value);
    const publishId = this.resolveSaveId(requestedId, snapshot);
    this.editorIdInput.value = publishId;
    return publishId;
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

    this.ensureEditorTestPlayerName();

    if (!this.validateEditorGrid()) {
      return;
    }

    const publishLevelId = this.getPublishLevelId(snapshot);
    const runtimeLevelId = `${EDITOR_TEST_LEVEL_ID}-${publishLevelId}`;
    const text = serializeGrid(this.editorGrid);

    try {
      ensureParseableLevel(runtimeLevelId, this.editorGrid);
    } catch (error) {
      this.showEditorFeedback(String(error), true);
      return;
    }

    const parsed = parseLevelText(runtimeLevelId, text);
    const levelIndex = this.controller.upsertLevel(parsed);
    this.editorTestingPublishLevelId = publishLevelId;
    this.editorLoadedLevelId = publishLevelId;
    this.controller.startLevel(levelIndex);
    this.showEditorFeedback(
      `Testing ${publishLevelId}. Pause and use "Back to Editor (Test)" to keep iterating before publish.`,
    );
  }

  private returnFromEditorTest(): void {
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
    this.editorIdInput.value = publishLevelId;
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

    const levelId = this.getPublishLevelId(snapshot);

    try {
      ensureParseableLevel(levelId, this.editorGrid);
    } catch (error) {
      this.showEditorFeedback(String(error), true);
      return;
    }

    const text = serializeGrid(this.editorGrid);

    try {
      const saved = await saveCustomLevel({
        id: levelId,
        name: levelId,
        text,
      });

      const parsed = parseLevelText(saved.id, saved.text);
      this.controller.upsertLevel(parsed);
      this.editorLoadedLevelId = saved.id;
      this.editorIdInput.value = saved.id;
      this.scoreCache.delete(saved.id);

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
      this.scoreCache.delete(levelId);
      this.controller.removeLevel(levelId);
      this.editorLoadedLevelId = null;
      this.editorIdInput.value = this.defaultEditorId();
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
