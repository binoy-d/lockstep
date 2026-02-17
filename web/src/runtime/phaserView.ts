import Phaser from 'phaser';
import type {
  ControllerSnapshot,
  EnemyDeathAnimationSnapshot,
  GameController,
  LavaDeathAnimationSnapshot,
  WinTransitionSnapshot,
} from '../app/gameController';
import {
  collectEnemyPathTargets,
  computePathDotOpacity,
  computePathDotScale,
  pathDistanceFromNextHit,
} from './enemyPathVisuals';
import { isTextInputFocused } from './inputFocus';
import { resolveCameraSwayImpulse } from './cameraRumble';
import { LEVEL_TRANSITION_PROFILE, shouldTriggerLevelTransition } from './levelTransition';
import { getLevelLabel } from './levelMeta';
import type { Direction, GameState } from '../core/types';

const FIXED_STEP_MS = 1000 / 60;
const MIN_TILE_SIZE = 22;
const MAX_TILE_SIZE = 80;
const BOARD_WIDTH_RATIO = 0.96;
const BOARD_HEIGHT_RATIO = 0.9;

function isNumericTile(value: string): boolean {
  const numeric = Number.parseInt(value, 10);
  return Number.isInteger(numeric);
}

function clampByte(value: number): number {
  return Phaser.Math.Clamp(Math.round(value), 0, 255);
}

function rgb(r: number, g: number, b: number): number {
  return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function isLikelyMobileDevice(): boolean {
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const userAgent = navigator.userAgent.toLowerCase();
  const hasMobileUserAgent = /android|iphone|ipad|ipod|mobile/.test(userAgent);
  const hasTouch = navigator.maxTouchPoints > 0;
  return hasCoarsePointer || hasMobileUserAgent || hasTouch;
}

function readCssPxVariable(name: string): number {
  const rawValue = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}

function isMouseLikeEvent(event: Event): event is MouseEvent {
  const candidate = event as MouseEvent;
  return typeof candidate.clientX === 'number' && typeof candidate.clientY === 'number';
}

function isTouchLikeEvent(event: Event): event is TouchEvent {
  const candidate = event as TouchEvent;
  return typeof candidate.changedTouches !== 'undefined';
}

function getPointerClientPosition(pointer: Phaser.Input.Pointer): { x: number; y: number } {
  const sourceEvent = pointer.event as Event | undefined;
  if (sourceEvent) {
    if (isMouseLikeEvent(sourceEvent)) {
      return {
        x: sourceEvent.clientX,
        y: sourceEvent.clientY,
      };
    }

    if (isTouchLikeEvent(sourceEvent) && sourceEvent.changedTouches.length > 0) {
      return {
        x: sourceEvent.changedTouches[0].clientX,
        y: sourceEvent.changedTouches[0].clientY,
      };
    }
  }

  return {
    x: pointer.x,
    y: pointer.y,
  };
}

class PuzzleScene extends Phaser.Scene {
  private readonly controller: GameController;

  private terrainLayer!: Phaser.GameObjects.Graphics;

  private entityLayer!: Phaser.GameObjects.Graphics;

  private fxLayer!: Phaser.GameObjects.Graphics;

  private transitionLayer!: Phaser.GameObjects.Graphics;

  private hudText!: Phaser.GameObjects.Text;

  private deathText!: Phaser.GameObjects.Text;

  private transitionText!: Phaser.GameObjects.Text;

  private fpsText!: Phaser.GameObjects.Text;

  private accumulator = 0;

  private lastStateRef: ControllerSnapshot['gameState'] | null = null;

  private lastScreenRef: ControllerSnapshot['screen'] | null = null;

  private lastLevelIdRef: string | null = null;

  private transitionZoomTween: Phaser.Tweens.Tween | null = null;

  private winTransitionVisualActive = false;

  private cameraSwayVelocityX = 0;

  private cameraSwayVelocityY = 0;

  private cameraSwayOffsetX = 0;

  private cameraSwayOffsetY = 0;

  private lastFpsSampleAtMs = 0;

  private readonly isMobileDevice = isLikelyMobileDevice();

  private swipeStart: { x: number; y: number; pointerId: number; startedAtMs: number } | null = null;

  private safeInsetTop = 0;

  private safeInsetRight = 0;

  private safeInsetBottom = 0;

  private safeInsetLeft = 0;

  private cachedEnemyTargetsStateRef: GameState | null = null;

  private cachedEnemyTargetValues: number[] = [];

  public constructor(controller: GameController) {
    super('PuzzleScene');
    this.controller = controller;
  }

  public create(): void {
    this.cameras.main.setBackgroundColor(0x08090d);

    this.terrainLayer = this.add.graphics().setDepth(0);
    this.entityLayer = this.add.graphics().setDepth(1);
    this.fxLayer = this.add.graphics().setDepth(2);
    this.transitionLayer = this.add.graphics().setDepth(6).setScrollFactor(0);
    this.hudText = this.add
      .text(16, 16, '', {
        fontFamily: 'system-ui, sans-serif',
        color: '#f2f6ff',
        fontSize: '16px',
      })
      .setDepth(4)
      .setScrollFactor(0)
      .setShadow(0, 1, '#000000', 2, false, true);
    this.deathText = this.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, sans-serif',
        color: '#ffd6dc',
        fontSize: '16px',
      })
      .setDepth(5)
      .setOrigin(0.5, 1)
      .setVisible(false)
      .setShadow(0, 1, '#000000', 3, false, true);
    this.transitionText = this.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, sans-serif',
        color: '#d8ffe9',
        fontSize: '42px',
        fontStyle: '700',
      })
      .setDepth(7)
      .setScrollFactor(0)
      .setOrigin(0.5, 0.5)
      .setAlign('center')
      .setLineSpacing(6)
      .setVisible(false)
      .setShadow(0, 2, '#00130d', 12, false, true);
    this.fpsText = this.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, sans-serif',
        color: '#d6e5f7',
        fontSize: '11px',
      })
      .setDepth(8)
      .setScrollFactor(0)
      .setOrigin(1, 0)
      .setAlpha(0.72)
      .setVisible(false);

    this.refreshSafeInsets();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.refreshSafeInsets();
    });

    this.registerInput();
  }

  public update(time: number, delta: number): void {
    this.accumulator += Math.min(delta, 100);

    let guard = 0;
    while (this.accumulator >= FIXED_STEP_MS && guard < 6) {
      this.controller.fixedUpdate(FIXED_STEP_MS);
      this.accumulator -= FIXED_STEP_MS;
      guard += 1;
    }

    this.renderSnapshot(this.controller.getSnapshot(), this.scale.width, this.scale.height, time);
  }

  private registerInput(): void {
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (isTextInputFocused(document.activeElement as Element | null)) {
        return;
      }

      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          event.preventDefault();
          this.queueDirectionWithSettings('up');
          break;
        case 'ArrowDown':
        case 'KeyS':
          event.preventDefault();
          this.queueDirectionWithSettings('down');
          break;
        case 'ArrowLeft':
        case 'KeyA':
          event.preventDefault();
          this.queueDirectionWithSettings('left');
          break;
        case 'ArrowRight':
        case 'KeyD':
          event.preventDefault();
          this.queueDirectionWithSettings('right');
          break;
        default:
          break;
      }
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.isMobileDevice || this.controller.getSnapshot().screen !== 'playing') {
        return;
      }

      const { x, y } = getPointerClientPosition(pointer);
      this.swipeStart = {
        x,
        y,
        pointerId: pointer.id,
        startedAtMs: performance.now(),
      };
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.isMobileDevice || !this.swipeStart || this.swipeStart.pointerId !== pointer.id) {
        return;
      }

      const elapsedMs = performance.now() - this.swipeStart.startedAtMs;
      const { x, y } = getPointerClientPosition(pointer);
      const dx = x - this.swipeStart.x;
      const dy = y - this.swipeStart.y;
      this.swipeStart = null;

      if (elapsedMs > 700) {
        return;
      }

      const minDistancePx = 24;
      if (Math.abs(dx) < minDistancePx && Math.abs(dy) < minDistancePx) {
        return;
      }

      const horizontal = Math.abs(dx) > Math.abs(dy);
      const direction: Direction = horizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      this.queueDirectionWithSettings(direction);
    });
  }

  private mapDirectionForSettings(direction: Direction): Direction {
    const settings = this.controller.getSnapshot().settings;
    if (!settings.mobileRotateClockwise) {
      return direction;
    }

    switch (direction) {
      case 'up':
        return 'left';
      case 'down':
        return 'right';
      case 'left':
        return 'up';
      case 'right':
        return 'down';
      default:
        return direction;
    }
  }

  private queueDirectionWithSettings(direction: Direction): void {
    this.controller.queueDirection(this.mapDirectionForSettings(direction));
  }

  private refreshSafeInsets(): void {
    this.safeInsetTop = readCssPxVariable('--safe-top');
    this.safeInsetRight = readCssPxVariable('--safe-right');
    this.safeInsetBottom = readCssPxVariable('--safe-bottom');
    this.safeInsetLeft = readCssPxVariable('--safe-left');
  }

  private getPlayableViewport(viewportWidth: number, viewportHeight: number): {
    left: number;
    top: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  } {
    const extraTop = this.isMobileDevice ? 44 : 26;
    const extraBottom = this.isMobileDevice ? 12 : 6;
    const left = this.safeInsetLeft;
    const right = this.safeInsetRight;
    const top = this.safeInsetTop + extraTop;
    const bottom = this.safeInsetBottom + extraBottom;
    const width = Math.max(1, viewportWidth - left - right);
    const height = Math.max(1, viewportHeight - top - bottom);
    return {
      left,
      top,
      width,
      height,
      centerX: left + width * 0.5,
      centerY: top + height * 0.5,
    };
  }

  private getEnemyTargetValues(state: GameState): number[] {
    if (this.cachedEnemyTargetsStateRef === state) {
      return this.cachedEnemyTargetValues;
    }

    const enemyPathTargets = collectEnemyPathTargets(state.enemies, state.grid);
    this.cachedEnemyTargetsStateRef = state;
    this.cachedEnemyTargetValues = enemyPathTargets.map((target) => target.value);
    return this.cachedEnemyTargetValues;
  }

  private computeLegacyGlow(
    tileX: number,
    tileY: number,
    players: ControllerSnapshot['gameState']['players'],
  ): number {
    if (players.length === 0) {
      return 0;
    }

    let sumDistances = 0;
    for (const player of players) {
      const dx = tileX - player.x;
      const dy = tileY - player.y;
      sumDistances += Math.sqrt(dx * dx + dy * dy);
    }

    const brightness = sumDistances / ((players.length + 1) / 2);
    let swop = 255 - Math.trunc(brightness * 6);
    swop = Math.trunc(swop / 10);

    // Keep Java ordering/quirk for visual parity.
    if (swop <= 30) {
      swop -= 5;
    } else if (swop <= 15) {
      swop -= 10;
    }

    swop *= 2;
    return clampByte(swop);
  }

  private computeTileSize(availableWidth: number, availableHeight: number, levelWidth: number, levelHeight: number): number {
    if (levelWidth <= 0 || levelHeight <= 0) {
      return 40;
    }

    const widthRatio = this.isMobileDevice ? 0.93 : BOARD_WIDTH_RATIO;
    const heightRatio = this.isMobileDevice ? 0.84 : BOARD_HEIGHT_RATIO;
    const widthBased = (availableWidth * widthRatio) / levelWidth;
    const heightBased = (availableHeight * heightRatio) / levelHeight;
    const size = Math.floor(Math.min(widthBased, heightBased));
    return Phaser.Math.Clamp(size, MIN_TILE_SIZE, MAX_TILE_SIZE);
  }

  private renderSnapshot(
    snapshot: ControllerSnapshot,
    viewportWidth: number,
    viewportHeight: number,
    time: number,
  ): void {
    this.applyLevelTransition(snapshot);

    const state = snapshot.gameState;
    const levelHeight = state.grid.length;
    const levelWidth = state.grid[0]?.length ?? 0;
    const viewport = this.getPlayableViewport(viewportWidth, viewportHeight);
    const tileSize = this.computeTileSize(viewport.width, viewport.height, levelWidth, levelHeight);

    const boardWidth = levelWidth * tileSize;
    const boardHeight = levelHeight * tileSize;
    const offsetX = Math.floor(viewport.left + (viewport.width - boardWidth) / 2);
    const offsetY = Math.floor(viewport.top + (viewport.height - boardHeight) / 2);
    this.applyCameraSway(snapshot, viewport.centerX, viewport.centerY, tileSize, time);
    const enemyTargetValues = this.getEnemyTargetValues(state);

    this.terrainLayer.clear();
    this.entityLayer.clear();
    this.fxLayer.clear();
    this.transitionLayer.clear();

    for (let y = 0; y < levelHeight; y += 1) {
      for (let x = 0; x < levelWidth; x += 1) {
        const tile = state.grid[y][x];
        const glowValue = snapshot.settings.lightingEnabled
          ? this.computeLegacyGlow(x, y, state.players)
          : 140;
        const wallShade = clampByte(glowValue * 2);
        const floorShade = clampByte(glowValue / 4);
        let red = floorShade;
        let green = floorShade;
        let blue = floorShade;

        if (tile === '#') {
          red = wallShade;
          green = wallShade;
          blue = wallShade;
        } else if (tile === 'x') {
          const lavaPulse = 0.5 + 0.5 * Math.sin((time + (x * 13 + y * 19) * 22) / 140);
          red = 190 + lavaPulse * 55;
          green = 32 + lavaPulse * 36;
          blue = 0;
        } else if (tile === '!') {
          const goalPulse = 0.5 + 0.5 * Math.sin((time + (x * 17 + y * 11) * 20) / 170);
          red = 0;
          green = 170 + goalPulse * 22;
          blue = 0;
        }

        const color = rgb(red, green, blue);
        this.terrainLayer.fillStyle(color, 1);
        this.terrainLayer.fillRect(offsetX + x * tileSize, offsetY + y * tileSize, tileSize, tileSize);

        if (tile === 'x') {
          const subSize = tileSize / 4;
          const flickerStep = Math.floor(time / 95);
          for (let iy = 0; iy < 4; iy += 1) {
            for (let ix = 0; ix < 4; ix += 1) {
              const seed = (x + 1) * 73856093 + (y + 1) * 19349663 + (ix + 1) * 83492791 + (iy + 1) * 297121507 + flickerStep * 104729;
              const noise = fract(Math.sin(seed) * 43758.5453);
              const subRed = 210 + noise * 40;
              const subGreen = 22 + noise * 35;

              this.terrainLayer.fillStyle(rgb(subRed, subGreen, 0), 1);
              this.terrainLayer.fillRect(
                offsetX + x * tileSize + ix * subSize,
                offsetY + y * tileSize + iy * subSize,
                subSize,
                subSize,
              );
            }
          }
        }

        if (tile === '!') {
          this.terrainLayer.fillStyle(rgb(0, 245, 0), 1);
          this.terrainLayer.fillRect(
            offsetX + x * tileSize + tileSize * 0.25,
            offsetY + y * tileSize + tileSize * 0.25,
            tileSize * 0.5,
            tileSize * 0.5,
          );
        }

        if (isNumericTile(tile)) {
          const tileValue = Number.parseInt(tile, 10);
          const distanceFromNext = pathDistanceFromNextHit(tileValue, enemyTargetValues);
          const opacity = computePathDotOpacity(distanceFromNext);
          const centerScale = computePathDotScale(distanceFromNext, time, x * 0.37 + y * 0.53);
          const centerSize = tileSize * centerScale;
          const outerSize = centerSize * 1.55;
          const outerInset = (tileSize - outerSize) / 2;
          const centerInset = (tileSize - centerSize) / 2;
          const pathPulse = 0.5 + 0.5 * Math.sin((time + x * 37 + y * 53) / 180);

          this.terrainLayer.fillStyle(rgb(120 + pathPulse * 45, 0, 0), opacity * 0.55);
          this.terrainLayer.fillRect(
            offsetX + x * tileSize + outerInset,
            offsetY + y * tileSize + outerInset,
            outerSize,
            outerSize,
          );

          this.terrainLayer.fillStyle(
            rgb(232 + pathPulse * 22, 25 + pathPulse * 25, 25 + pathPulse * 20),
            opacity,
          );
          this.terrainLayer.fillRect(
            offsetX + x * tileSize + centerInset,
            offsetY + y * tileSize + centerInset,
            centerSize,
            centerSize,
          );
        }
      }
    }

    const pulseScale = 0.72 + 0.16 * (Math.sin(time / 160) + 1) / 2;
    for (const player of state.players) {
      const px = offsetX + player.x * tileSize;
      const py = offsetY + player.y * tileSize;

      this.entityLayer.fillStyle(0xffffff, 1);
      this.entityLayer.fillRect(
        px + (tileSize * (1 - pulseScale)) / 2,
        py + (tileSize * (1 - pulseScale)) / 2,
        tileSize * pulseScale,
        tileSize * pulseScale,
      );
    }

    for (const enemy of state.enemies) {
      const ex = offsetX + enemy.x * tileSize;
      const ey = offsetY + enemy.y * tileSize;

      this.entityLayer.fillStyle(0xae1b2f, 1);
      this.entityLayer.fillRect(ex, ey, tileSize, tileSize);

      this.entityLayer.fillStyle(0xff6578, 1);
      this.entityLayer.fillRect(
        ex + tileSize * 0.28,
        ey + tileSize * 0.28,
        tileSize * 0.44,
        tileSize * 0.44,
      );
    }

    this.renderDeathAnimation(snapshot, offsetX, offsetY, tileSize);
    const winTransitionActive = this.renderWinTransition(snapshot, viewportWidth, viewportHeight, time);
    this.hudText.setAlpha(winTransitionActive ? 0 : 1);
    if (winTransitionActive) {
      this.deathText.setVisible(false);
    }

    const isPaused = snapshot.screen === 'paused';
    const hudX = 12 + this.safeInsetLeft;
    const hudY = 10 + this.safeInsetTop;
    this.hudText.setPosition(hudX, hudY);
    this.hudText.setWordWrapWidth(Math.max(140, viewportWidth - this.safeInsetLeft - this.safeInsetRight - 24));
    if (this.isMobileDevice) {
      const levelName = state.levelId.length > 24 ? `${state.levelId.slice(0, 23)}…` : state.levelId;
      this.hudText.setFontSize('12px');
      this.hudText.setText(
        `L${state.levelIndex + 1}/${state.levelIds.length}  Moves ${state.moves}  P${state.players.length}/${state.totalPlayers}${isPaused ? '  [PAUSED]' : ''}\n${levelName}`,
      );
    } else {
      this.hudText.setFontSize('16px');
      this.hudText.setText(
        `${getLevelLabel(state.levelId, state.levelIndex)} (${state.levelIndex + 1}/${state.levelIds.length})  Moves ${state.moves}  Players ${state.players.length}/${state.totalPlayers}${isPaused ? '  [PAUSED]' : ''}`,
      );
    }
    this.updateFpsLabel(snapshot, viewportWidth, time);
  }

  private computeBoardPlacement(
    viewportWidth: number,
    viewportHeight: number,
    levelWidth: number,
    levelHeight: number,
  ): { tileSize: number; offsetX: number; offsetY: number } {
    const viewport = this.getPlayableViewport(viewportWidth, viewportHeight);
    const tileSize = this.computeTileSize(viewport.width, viewport.height, levelWidth, levelHeight);
    const boardWidth = levelWidth * tileSize;
    const boardHeight = levelHeight * tileSize;
    return {
      tileSize,
      offsetX: Math.floor(viewport.left + (viewport.width - boardWidth) / 2),
      offsetY: Math.floor(viewport.top + (viewport.height - boardHeight) / 2),
    };
  }

  private isWinTransitionActive(transition: WinTransitionSnapshot | null): boolean {
    if (!transition) {
      return false;
    }

    const elapsedMs = Date.now() - transition.startedAtMs;
    return elapsedMs >= 0 && elapsedMs < transition.durationMs;
  }

  private renderWinTransition(
    snapshot: ControllerSnapshot,
    viewportWidth: number,
    viewportHeight: number,
    time: number,
  ): boolean {
    const transition = snapshot.winTransition;
    const camera = this.cameras.main;
    if (!transition || !this.isWinTransitionActive(transition)) {
      if (this.winTransitionVisualActive) {
        this.winTransitionVisualActive = false;
        this.transitionText.setVisible(false);
        camera.setZoom(1);
        camera.setRotation(0);
        camera.centerOn(viewportWidth * 0.5, viewportHeight * 0.5);
      }
      return false;
    }

    this.winTransitionVisualActive = true;
    const elapsedMs = Math.max(0, Date.now() - transition.startedAtMs);
    const progress = Phaser.Math.Clamp(elapsedMs / transition.durationMs, 0, 1);

    const placement = this.computeBoardPlacement(
      viewportWidth,
      viewportHeight,
      transition.sourceLevelWidth,
      transition.sourceLevelHeight,
    );
    const viewport = this.getPlayableViewport(viewportWidth, viewportHeight);
    const portalX = placement.offsetX + (transition.portal.x + 0.5) * placement.tileSize;
    const portalY = placement.offsetY + (transition.portal.y + 0.5) * placement.tileSize;
    const centerX = viewport.centerX;
    const centerY = viewport.centerY;

    const dive = Phaser.Math.Easing.Cubic.Out(Phaser.Math.Clamp(progress / 0.55, 0, 1));
    const fill = Phaser.Math.Easing.Cubic.InOut(Phaser.Math.Clamp((progress - 0.1) / 0.66, 0, 1));
    const reveal = Phaser.Math.Easing.Cubic.Out(Phaser.Math.Clamp((progress - 0.64) / 0.36, 0, 1));

    const focusX = Phaser.Math.Linear(portalX, centerX, reveal * 0.92);
    const focusY = Phaser.Math.Linear(portalY, centerY, reveal * 0.92);
    camera.centerOn(focusX, focusY);
    const zoomIn = Phaser.Math.Linear(1, 6.2, dive);
    camera.setZoom(Phaser.Math.Linear(zoomIn, 1, reveal));
    camera.setRotation(0);

    const layerCenterX = Phaser.Math.Linear(portalX, centerX, reveal * 0.7);
    const layerCenterY = Phaser.Math.Linear(portalY, centerY, reveal * 0.7);
    const maxDim = Math.hypot(viewportWidth, viewportHeight) * 1.24;

    const portalPulse = 0.5 + 0.5 * Math.sin(time / 90);
    const portalSize = placement.tileSize * (0.95 + portalPulse * 0.22 + dive * 1.65);
    this.transitionLayer.fillStyle(rgb(68, 255, 176), 0.24 + (1 - progress) * 0.3);
    this.transitionLayer.fillRect(
      layerCenterX - portalSize * 0.5,
      layerCenterY - portalSize * 0.5,
      portalSize,
      portalSize,
    );

    const layerCount = 8;
    for (let i = 0; i < layerCount; i += 1) {
      const depth = (i + 1) / layerCount;
      const layerFill = Phaser.Math.Clamp(fill - depth * 0.08, 0, 1);
      if (layerFill <= 0) {
        continue;
      }

      const startSize = portalSize * (1 + depth * 0.7);
      const endSize = maxDim * (0.5 + depth * 0.76);
      const size = Phaser.Math.Linear(startSize, endSize, Math.pow(layerFill, 0.7));
      const red = 18 + depth * 30;
      const green = 88 + depth * 145;
      const blue = 52 + depth * 110;
      const alpha = (0.04 + (1 - depth) * 0.17) * (1 - reveal * 0.82);

      this.transitionLayer.fillStyle(rgb(red, green, blue), alpha);
      this.transitionLayer.fillRect(
        layerCenterX - size * 0.5,
        layerCenterY - size * 0.5,
        size,
        size,
      );
    }

    const ringCount = 6;
    for (let i = 0; i < ringCount; i += 1) {
      const depth = i / Math.max(1, ringCount - 1);
      const ringFill = Phaser.Math.Clamp(fill - depth * 0.11, 0, 1);
      if (ringFill <= 0) {
        continue;
      }

      const ringSize = Phaser.Math.Linear(portalSize * (1.05 + depth * 0.25), maxDim * (0.42 + depth * 0.48), ringFill * ringFill);
      const alpha = (0.08 + (1 - depth) * 0.2) * (1 - reveal * 0.8);
      this.transitionLayer.lineStyle(
        Math.max(1.2, placement.tileSize * (0.05 - depth * 0.016)),
        rgb(62, 255 - depth * 36, 170 - depth * 48),
        alpha,
      );
      this.transitionLayer.strokeRect(
        layerCenterX - ringSize * 0.5,
        layerCenterY - ringSize * 0.5,
        ringSize,
        ringSize,
      );
    }

    const washAlpha = (0.08 + fill * 0.54) * (1 - reveal * 0.96);
    this.transitionLayer.fillStyle(rgb(8, 70, 38), washAlpha);
    this.transitionLayer.fillRect(0, 0, viewportWidth, viewportHeight);

    const apertureSize = Phaser.Math.Linear(portalSize * 0.8, maxDim * 0.95, fill);
    this.transitionLayer.fillStyle(rgb(110, 255, 198), (0.06 + (1 - reveal) * 0.18) * (1 - reveal * 0.82));
    this.transitionLayer.fillRect(
      layerCenterX - apertureSize * 0.5,
      layerCenterY - apertureSize * 0.5,
      apertureSize,
      apertureSize,
    );

    const textReveal = Phaser.Math.Easing.Cubic.Out(Phaser.Math.Clamp((progress - 0.1) / 0.45, 0, 1));
    const textFade = Phaser.Math.Clamp((progress - 0.9) / 0.1, 0, 1);
    const textAlpha = Phaser.Math.Clamp((0.2 + textReveal * 0.92) * (1 - textFade), 0, 1);
    const scoreText = `${transition.completedMoves} moves • ${(transition.completedDurationMs / 1000).toFixed(1)}s`;
    const textY = viewport.top + Math.max(42, Math.min(124, viewport.height * 0.2));
    this.transitionText
      .setVisible(true)
      .setPosition(centerX, textY)
      .setFontSize(this.isMobileDevice ? '24px' : '34px')
      .setText(`LEVEL CLEAR\n${scoreText}`)
      .setAlpha(textAlpha)
      .setScale(Phaser.Math.Linear(1.08, 1, textReveal));

    return true;
  }

  private renderDeathAnimation(
    snapshot: ControllerSnapshot,
    offsetX: number,
    offsetY: number,
    tileSize: number,
  ): void {
    const death = snapshot.deathAnimation;
    if (!death) {
      this.deathText.setVisible(false);
      return;
    }

    if (death.kind === 'enemy') {
      this.renderEnemyDeathAnimation(death, offsetX, offsetY, tileSize);
      return;
    }

    this.renderLavaDeathAnimation(death, offsetX, offsetY, tileSize);
  }

  private renderEnemyDeathAnimation(
    death: EnemyDeathAnimationSnapshot,
    offsetX: number,
    offsetY: number,
    tileSize: number,
  ): void {
    const nowMs = Date.now();
    const elapsedMs = Math.max(0, nowMs - death.startedAtMs);
    const progress = Phaser.Math.Clamp(elapsedMs / death.durationMs, 0, 1);
    const easeOut = 1 - (1 - progress) * (1 - progress) * (1 - progress);
    const fade = 1 - progress;
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 52);

    const impactCenterX = offsetX + (death.intersection.x + 0.5) * tileSize;
    const impactCenterY = offsetY + (death.intersection.y + 0.5) * tileSize;
    const playerFromX = offsetX + (death.playerFrom.x + 0.5) * tileSize;
    const playerFromY = offsetY + (death.playerFrom.y + 0.5) * tileSize;
    const enemyFromX = offsetX + (death.enemyFrom.x + 0.5) * tileSize;
    const enemyFromY = offsetY + (death.enemyFrom.y + 0.5) * tileSize;

    const lineWidth = Math.max(2, tileSize * 0.09);
    this.fxLayer.lineStyle(lineWidth, rgb(245, 240, 255), 0.12 + fade * 0.55);
    this.fxLayer.beginPath();
    this.fxLayer.moveTo(playerFromX, playerFromY);
    this.fxLayer.lineTo(impactCenterX, impactCenterY);
    this.fxLayer.strokePath();

    this.fxLayer.lineStyle(lineWidth * 0.75, rgb(255, 82, 112), 0.14 + fade * 0.68);
    this.fxLayer.beginPath();
    this.fxLayer.moveTo(enemyFromX, enemyFromY);
    this.fxLayer.lineTo(impactCenterX, impactCenterY);
    this.fxLayer.strokePath();

    const shockSize = tileSize * (0.5 + easeOut * 1.9);
    const innerSize = tileSize * (0.32 + pulse * 0.24);
    const sparkLength = tileSize * (0.4 + easeOut * 1.1);
    const ringSize = tileSize * (0.85 + easeOut * 2.6);

    this.fxLayer.fillStyle(rgb(255, 36 + pulse * 75, 64 + pulse * 74), 0.1 + fade * 0.32);
    this.fxLayer.fillRect(
      impactCenterX - shockSize / 2,
      impactCenterY - shockSize / 2,
      shockSize,
      shockSize,
    );

    this.fxLayer.fillStyle(rgb(255, 238, 244), 0.65 + fade * 0.35);
    this.fxLayer.fillRect(
      impactCenterX - innerSize / 2,
      impactCenterY - innerSize / 2,
      innerSize,
      innerSize,
    );

    this.fxLayer.lineStyle(Math.max(2, tileSize * 0.07), rgb(255, 118, 146), 0.42 + fade * 0.45);
    this.fxLayer.strokeRect(
      impactCenterX - ringSize / 2,
      impactCenterY - ringSize / 2,
      ringSize,
      ringSize,
    );

    this.fxLayer.lineStyle(Math.max(1.5, tileSize * 0.06), rgb(255, 232, 238), 0.35 + fade * 0.55);
    this.fxLayer.beginPath();
    this.fxLayer.moveTo(impactCenterX - sparkLength, impactCenterY);
    this.fxLayer.lineTo(impactCenterX + sparkLength, impactCenterY);
    this.fxLayer.moveTo(impactCenterX, impactCenterY - sparkLength);
    this.fxLayer.lineTo(impactCenterX, impactCenterY + sparkLength);
    this.fxLayer.strokePath();

    const highlightSize = tileSize * 1.03;
    this.fxLayer.lineStyle(Math.max(1.5, tileSize * 0.07), rgb(141, 220, 255), 0.2 + fade * 0.65);
    this.fxLayer.strokeRect(
      playerFromX - highlightSize / 2,
      playerFromY - highlightSize / 2,
      highlightSize,
      highlightSize,
    );
    this.fxLayer.lineStyle(Math.max(1.5, tileSize * 0.07), rgb(255, 112, 136), 0.2 + fade * 0.68);
    this.fxLayer.strokeRect(
      enemyFromX - highlightSize / 2,
      enemyFromY - highlightSize / 2,
      highlightSize,
      highlightSize,
    );

    this.deathText.setVisible(true);
    this.deathText.setColor('#ffd6dc');
    this.deathText.setPosition(impactCenterX, impactCenterY - tileSize * 0.9);
    this.deathText.setText(`P${death.playerId + 1} x E${death.enemyId + 1}`);
    this.deathText.setAlpha(0.3 + fade * 0.7);
  }

  private renderLavaDeathAnimation(
    death: LavaDeathAnimationSnapshot,
    offsetX: number,
    offsetY: number,
    tileSize: number,
  ): void {
    const nowMs = Date.now();
    const elapsedMs = Math.max(0, nowMs - death.startedAtMs);
    const progress = Phaser.Math.Clamp(elapsedMs / death.durationMs, 0, 1);
    const easeOut = 1 - (1 - progress) * (1 - progress);
    const fade = 1 - progress;
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 44);

    const impactCenterX = offsetX + (death.intersection.x + 0.5) * tileSize;
    const impactCenterY = offsetY + (death.intersection.y + 0.5) * tileSize;
    const playerFromX = offsetX + (death.playerFrom.x + 0.5) * tileSize;
    const playerFromY = offsetY + (death.playerFrom.y + 0.5) * tileSize;

    this.fxLayer.lineStyle(Math.max(2, tileSize * 0.09), rgb(255, 236, 198), 0.22 + fade * 0.62);
    this.fxLayer.beginPath();
    this.fxLayer.moveTo(playerFromX, playerFromY);
    this.fxLayer.lineTo(impactCenterX, impactCenterY);
    this.fxLayer.strokePath();

    const coreSize = tileSize * (0.45 + easeOut * 1.6);
    this.fxLayer.fillStyle(rgb(255, 112 + pulse * 85, 0), 0.22 + fade * 0.45);
    this.fxLayer.fillRect(
      impactCenterX - coreSize / 2,
      impactCenterY - coreSize / 2,
      coreSize,
      coreSize,
    );

    const ringSize = tileSize * (0.9 + easeOut * 2.2);
    this.fxLayer.lineStyle(Math.max(2, tileSize * 0.08), rgb(255, 170 + pulse * 40, 42), 0.26 + fade * 0.55);
    this.fxLayer.strokeRect(
      impactCenterX - ringSize / 2,
      impactCenterY - ringSize / 2,
      ringSize,
      ringSize,
    );

    const emberCount = 12;
    for (let i = 0; i < emberCount; i += 1) {
      const angle = i * 0.54 + progress * 4.6;
      const spread = tileSize * (0.18 + easeOut * (0.45 + (i % 3) * 0.16));
      const emberSize = tileSize * (0.08 + (i % 3) * 0.03);
      const emberX = impactCenterX + Math.cos(angle) * spread;
      const emberY = impactCenterY + Math.sin(angle) * spread;
      this.fxLayer.fillStyle(rgb(255, 120 + (i % 3) * 50, 0), 0.2 + fade * 0.56);
      this.fxLayer.fillRect(
        emberX - emberSize / 2,
        emberY - emberSize / 2,
        emberSize,
        emberSize,
      );
    }

    const highlightSize = tileSize * 1.02;
    this.fxLayer.lineStyle(Math.max(1.5, tileSize * 0.07), rgb(255, 231, 207), 0.18 + fade * 0.62);
    this.fxLayer.strokeRect(
      playerFromX - highlightSize / 2,
      playerFromY - highlightSize / 2,
      highlightSize,
      highlightSize,
    );

    this.deathText.setVisible(true);
    this.deathText.setColor('#ffd79c');
    this.deathText.setPosition(impactCenterX, impactCenterY - tileSize * 0.9);
    this.deathText.setText(`P${death.playerId + 1} x LAVA`);
    this.deathText.setAlpha(0.3 + fade * 0.7);
  }

  private applyLevelTransition(snapshot: ControllerSnapshot): void {
    const previousScreen = this.lastScreenRef;
    const previousLevelId = this.lastLevelIdRef;
    this.lastScreenRef = snapshot.screen;
    this.lastLevelIdRef = snapshot.gameState.levelId;

    if (this.isWinTransitionActive(snapshot.winTransition)) {
      return;
    }

    const shouldTransition = shouldTriggerLevelTransition({
      previousScreen,
      nextScreen: snapshot.screen,
      previousLevelId,
      nextLevelId: snapshot.gameState.levelId,
    });

    if (!shouldTransition) {
      return;
    }

    const camera = this.cameras.main;
    this.transitionZoomTween?.stop();
    camera.resetFX();
    camera.fadeOut(LEVEL_TRANSITION_PROFILE.fadeOutMs, 0, 0, 0);
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      camera.setZoom(LEVEL_TRANSITION_PROFILE.zoomFrom);
      this.time.delayedCall(LEVEL_TRANSITION_PROFILE.blackHoldMs, () => {
        camera.fadeIn(LEVEL_TRANSITION_PROFILE.fadeInMs, 0, 0, 0);
      });

      this.transitionZoomTween = this.tweens.add({
        targets: camera,
        zoom: LEVEL_TRANSITION_PROFILE.zoomTo,
        duration: LEVEL_TRANSITION_PROFILE.zoomMs,
        ease: LEVEL_TRANSITION_PROFILE.zoomEase,
      });
    });
  }

  private applyCameraSway(
    snapshot: ControllerSnapshot,
    centerX: number,
    centerY: number,
    tileSize: number,
    time: number,
  ): void {
    if (this.isWinTransitionActive(snapshot.winTransition)) {
      this.lastStateRef = snapshot.gameState;
      return;
    }

    const camera = this.cameras.main;
    const swayEnabled = snapshot.settings.cameraSwayEnabled && snapshot.screen === 'playing';
    const impulse = swayEnabled ? resolveCameraSwayImpulse(snapshot.screen, this.lastStateRef, snapshot.gameState) : null;
    if (impulse) {
      const impulseScale = Math.max(2.5, tileSize * 0.12);
      this.cameraSwayVelocityX += impulse.x * impulseScale;
      this.cameraSwayVelocityY += impulse.y * impulseScale;
    }

    this.cameraSwayOffsetX += this.cameraSwayVelocityX;
    this.cameraSwayOffsetY += this.cameraSwayVelocityY;

    const damping = swayEnabled ? 0.78 : 0.55;
    const settle = swayEnabled ? 0.87 : 0.72;
    this.cameraSwayVelocityX *= damping;
    this.cameraSwayVelocityY *= damping;
    this.cameraSwayOffsetX *= settle;
    this.cameraSwayOffsetY *= settle;

    const maxOffset = Math.max(5, tileSize * 0.2);
    const offsetX = Phaser.Math.Clamp(this.cameraSwayOffsetX, -maxOffset, maxOffset);
    const offsetY = Phaser.Math.Clamp(this.cameraSwayOffsetY, -maxOffset, maxOffset);

    const driftAmplitude = swayEnabled ? Math.max(0.8, tileSize * 0.02) : 0;
    const driftX = Math.sin(time / 900) * driftAmplitude;
    const driftY = Math.cos(time / 1200) * driftAmplitude * 0.75;

    camera.centerOn(centerX + offsetX + driftX, centerY + offsetY + driftY);
    this.lastStateRef = snapshot.gameState;
  }

  private updateFpsLabel(snapshot: ControllerSnapshot, viewportWidth: number, time: number): void {
    this.fpsText.setPosition(viewportWidth - 12 - this.safeInsetRight, 10 + this.safeInsetTop);
    if (!snapshot.settings.showFps) {
      this.fpsText.setVisible(false);
      return;
    }

    if (time - this.lastFpsSampleAtMs >= 220) {
      const fps = Math.round(this.game.loop.actualFps);
      this.fpsText.setText(`FPS ${fps}`);
      this.lastFpsSampleAtMs = time;
    }

    this.fpsText.setVisible(true);
  }
}

export class PhaserGameView {
  private readonly game: Phaser.Game;

  public constructor(containerId: string, controller: GameController) {
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerId,
      width: 1280,
      height: 720,
      backgroundColor: '#08090d',
      scene: [new PuzzleScene(controller)],
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        pixelArt: true,
        antialias: false,
      },
    });
  }

  public destroy(): void {
    this.game.destroy(true);
  }
}
