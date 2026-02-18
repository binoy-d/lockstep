import { deflateSync } from 'node:zlib';

const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;

const TILE_COLORS = {
  '#': [187, 197, 209],
  ' ': [33, 41, 54],
  P: [246, 252, 255],
  '!': [31, 182, 110],
  x: [199, 89, 34],
  path: [120, 32, 53],
};

const FONT_5X7 = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00100', '00100'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

const FONT_WIDTH = 5;
const FONT_HEIGHT = 7;
const FONT_SPACING = 1;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcSource = Buffer.concat([typeBuffer, data]);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(crcSource), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgba) {
  const rowSize = width * 4;
  const scanlines = Buffer.alloc((rowSize + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * rowSize;
    const targetOffset = row * (rowSize + 1);
    scanlines[targetOffset] = 0;
    rgba.copy(scanlines, targetOffset + 1, sourceOffset, sourceOffset + rowSize);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = deflateSync(scanlines, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', idat),
    buildChunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(buffer, width, height, x, y, red, green, blue, alpha = 255) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }

  const offset = (y * width + x) * 4;
  buffer[offset] = red;
  buffer[offset + 1] = green;
  buffer[offset + 2] = blue;
  buffer[offset + 3] = alpha;
}

function blendPixel(buffer, width, height, x, y, red, green, blue, alpha = 255) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }

  const offset = (y * width + x) * 4;
  const srcAlpha = Math.max(0, Math.min(255, alpha)) / 255;
  if (srcAlpha <= 0) {
    return;
  }

  const dstAlpha = buffer[offset + 3] / 255;
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
  if (outAlpha <= 0) {
    return;
  }

  const dstFactor = (dstAlpha * (1 - srcAlpha)) / outAlpha;
  const srcFactor = srcAlpha / outAlpha;

  buffer[offset] = Math.round(red * srcFactor + buffer[offset] * dstFactor);
  buffer[offset + 1] = Math.round(green * srcFactor + buffer[offset + 1] * dstFactor);
  buffer[offset + 2] = Math.round(blue * srcFactor + buffer[offset + 2] * dstFactor);
  buffer[offset + 3] = Math.round(outAlpha * 255);
}

function fillRect(buffer, width, height, x, y, rectWidth, rectHeight, color) {
  const [red, green, blue, alpha = 255] = color;
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(width, Math.ceil(x + rectWidth));
  const endY = Math.min(height, Math.ceil(y + rectHeight));
  for (let row = startY; row < endY; row += 1) {
    for (let col = startX; col < endX; col += 1) {
      setPixel(buffer, width, height, col, row, red, green, blue, alpha);
    }
  }
}

function fillRectBlend(buffer, width, height, x, y, rectWidth, rectHeight, color) {
  const [red, green, blue, alpha = 255] = color;
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(width, Math.ceil(x + rectWidth));
  const endY = Math.min(height, Math.ceil(y + rectHeight));
  for (let row = startY; row < endY; row += 1) {
    for (let col = startX; col < endX; col += 1) {
      blendPixel(buffer, width, height, col, row, red, green, blue, alpha);
    }
  }
}

function fillVerticalGradient(buffer, width, height, topColor, bottomColor) {
  for (let row = 0; row < height; row += 1) {
    const t = row / Math.max(1, height - 1);
    const red = Math.round(topColor[0] + (bottomColor[0] - topColor[0]) * t);
    const green = Math.round(topColor[1] + (bottomColor[1] - topColor[1]) * t);
    const blue = Math.round(topColor[2] + (bottomColor[2] - topColor[2]) * t);
    for (let col = 0; col < width; col += 1) {
      setPixel(buffer, width, height, col, row, red, green, blue, 255);
    }
  }
}

function drawRadialGlow(buffer, centerX, centerY, radius, color, maxAlpha = 1) {
  const [red, green, blue] = color;
  const startX = Math.max(0, Math.floor(centerX - radius));
  const endX = Math.min(PREVIEW_WIDTH - 1, Math.ceil(centerX + radius));
  const startY = Math.max(0, Math.floor(centerY - radius));
  const endY = Math.min(PREVIEW_HEIGHT - 1, Math.ceil(centerY + radius));
  const radiusSquared = radius * radius;

  for (let row = startY; row <= endY; row += 1) {
    const dy = row - centerY;
    for (let col = startX; col <= endX; col += 1) {
      const dx = col - centerX;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > radiusSquared) {
        continue;
      }

      const falloff = 1 - Math.sqrt(distanceSquared) / radius;
      const alpha = Math.round(Math.max(0, Math.min(1, falloff * falloff * maxAlpha)) * 255);
      if (alpha <= 0) {
        continue;
      }

      blendPixel(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, col, row, red, green, blue, alpha);
    }
  }
}

function drawRectVignette(buffer, x, y, width, height, maxAlpha = 128, innerRadius = 0.5) {
  const centerX = x + width * 0.5;
  const centerY = y + height * 0.5;
  const radiusX = Math.max(1, width * 0.5);
  const radiusY = Math.max(1, height * 0.5);
  const startX = Math.max(0, Math.floor(x));
  const endX = Math.min(PREVIEW_WIDTH - 1, Math.ceil(x + width));
  const startY = Math.max(0, Math.floor(y));
  const endY = Math.min(PREVIEW_HEIGHT - 1, Math.ceil(y + height));

  for (let row = startY; row <= endY; row += 1) {
    const normalizedY = (row - centerY) / radiusY;
    for (let col = startX; col <= endX; col += 1) {
      const normalizedX = (col - centerX) / radiusX;
      const distance = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
      const clampedDistance = Math.min(1, distance);
      const edgeWeight = Math.max(0, (clampedDistance - innerRadius) / Math.max(0.0001, 1 - innerRadius));
      if (edgeWeight <= 0) {
        continue;
      }

      const alpha = Math.round(Math.min(1, edgeWeight) * maxAlpha);
      if (alpha <= 0) {
        continue;
      }

      blendPixel(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, col, row, 0, 0, 0, alpha);
    }
  }
}

function parseGrid(levelText) {
  if (typeof levelText !== 'string') {
    return null;
  }

  const lines = levelText.replace(/\r/g, '').split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  const width = lines[0].length;
  if (width <= 0) {
    return null;
  }

  for (const line of lines) {
    if (line.length !== width) {
      return null;
    }
  }

  return lines.map((line) => line.split(''));
}

function tileColor(tile) {
  if (tile in TILE_COLORS) {
    return TILE_COLORS[tile];
  }

  const numeric = Number.parseInt(tile, 10);
  if (Number.isInteger(numeric)) {
    return TILE_COLORS.path;
  }

  return TILE_COLORS[' '];
}

function normalizePreviewText(value, fallback = '') {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : fallback;
}

function textWidth(text, scale = 1) {
  if (!text || text.length === 0) {
    return 0;
  }

  const pixelWidth = text.length * FONT_WIDTH + Math.max(0, text.length - 1) * FONT_SPACING;
  return pixelWidth * scale;
}

function drawGlyph(buffer, glyph, x, y, scale, color) {
  for (let row = 0; row < FONT_HEIGHT; row += 1) {
    const bitmapRow = glyph[row] ?? '00000';
    for (let col = 0; col < FONT_WIDTH; col += 1) {
      if (bitmapRow[col] !== '1') {
        continue;
      }

      fillRect(
        buffer,
        PREVIEW_WIDTH,
        PREVIEW_HEIGHT,
        x + col * scale,
        y + row * scale,
        scale,
        scale,
        color,
      );
    }
  }
}

function drawTextLine(buffer, text, x, y, scale, color, shadowColor = null, shadowOffset = 0) {
  const normalizedText = String(text ?? '').toUpperCase();
  const advance = (FONT_WIDTH + FONT_SPACING) * scale;

  if (shadowColor && shadowOffset > 0) {
    let shadowCursor = x + shadowOffset;
    for (const char of normalizedText) {
      const glyph = FONT_5X7[char] ?? FONT_5X7['?'];
      drawGlyph(buffer, glyph, shadowCursor, y + shadowOffset, scale, shadowColor);
      shadowCursor += advance;
    }
  }

  let cursorX = x;
  for (const char of normalizedText) {
    const glyph = FONT_5X7[char] ?? FONT_5X7['?'];
    drawGlyph(buffer, glyph, cursorX, y, scale, color);
    cursorX += advance;
  }
}

function wrapText(text, maxCharsPerLine, maxLines = 3) {
  const normalized = normalizePreviewText(text);
  if (!normalized) {
    return [];
  }

  const words = normalized.split(' ');
  const lines = [];
  let current = '';

  for (const rawWord of words) {
    let word = rawWord;
    while (word.length > maxCharsPerLine) {
      const head = word.slice(0, maxCharsPerLine);
      const tail = word.slice(maxCharsPerLine);
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      lines.push(head);
      word = tail;
      if (lines.length >= maxLines) {
        break;
      }
    }
    if (lines.length >= maxLines) {
      break;
    }

    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      lines.push(current);
    }
    current = word;

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && current.length > 0) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  if (lines.length === maxLines) {
    const lastLine = lines[maxLines - 1];
    if (lastLine.length > maxCharsPerLine) {
      lines[maxLines - 1] = `${lastLine.slice(0, Math.max(0, maxCharsPerLine - 3))}...`;
    }
  }

  return lines;
}

function drawLevelMiniMap(buffer, grid) {
  const rows = grid.length;
  const cols = grid[0].length;

  const frameX = 92;
  const frameY = 84;
  const frameWidth = 500;
  const frameHeight = 500;
  const padding = 8;
  const tileAreaX = frameX + padding;
  const tileAreaY = frameY + padding;
  const tileAreaWidth = frameWidth - padding * 2;
  const tileAreaHeight = frameHeight - padding * 2;

  const gap = 0;
  const tileSize = Math.max(
    2,
    Math.floor(
      Math.min(
        (tileAreaWidth - Math.max(0, (cols - 1) * gap)) / cols,
        (tileAreaHeight - Math.max(0, (rows - 1) * gap)) / rows,
      ),
    ),
  );
  const mapWidth = cols * tileSize + Math.max(0, (cols - 1) * gap);
  const mapHeight = rows * tileSize + Math.max(0, (rows - 1) * gap);
  const mapOffsetX = tileAreaX + Math.floor((tileAreaWidth - mapWidth) * 0.5);
  const mapOffsetY = tileAreaY + Math.floor((tileAreaHeight - mapHeight) * 0.5);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const color = tileColor(grid[row][col]);
      fillRect(
        buffer,
        PREVIEW_WIDTH,
        PREVIEW_HEIGHT,
        mapOffsetX + col * (tileSize + gap),
        mapOffsetY + row * (tileSize + gap),
        tileSize,
        tileSize,
        color,
      );
    }
  }

  drawRectVignette(buffer, mapOffsetX, mapOffsetY, mapWidth, mapHeight, 128, 0.5);
}

function drawAccentPanel(buffer, levelName, levelId) {
  const panelX = 622;
  const panelY = 76;

  drawTextLine(
    buffer,
    'LOCKSTEP',
    panelX + 20,
    panelY + 64,
    8,
    [234, 246, 255, 255],
    [22, 62, 94, 210],
    3,
  );
  drawTextLine(
    buffer,
    'MOVE TO THE GOAL',
    panelX + 22,
    panelY + 168,
    3,
    [101, 234, 255, 255],
    [12, 58, 84, 210],
    2,
  );
  drawTextLine(
    buffer,
    'AVOID LAVA. DODGE ENEMIES.',
    panelX + 22,
    panelY + 202,
    2,
    [165, 203, 235, 240],
    [10, 38, 62, 160],
    1,
  );

  drawTextLine(
    buffer,
    'LEVEL',
    panelX + 24,
    panelY + 302,
    2,
    [121, 247, 199, 255],
    [16, 56, 47, 220],
    1,
  );

  const displayLevelName = normalizePreviewText(levelName, normalizePreviewText(levelId, 'UNKNOWN LEVEL')).toUpperCase();
  const levelNameLines = wrapText(displayLevelName, 28, 2);
  let levelNameY = panelY + 334;
  for (const line of levelNameLines) {
    drawTextLine(buffer, line, panelX + 24, levelNameY, 3, [238, 246, 255, 250], [24, 40, 62, 180], 1);
    levelNameY += (FONT_HEIGHT + 1) * 3;
  }

  const normalizedLevelId = normalizePreviewText(levelId, 'unknown-level').toUpperCase();
  drawTextLine(
    buffer,
    `ID: ${normalizedLevelId}`,
    panelX + 24,
    panelY + 454,
    2,
    [148, 196, 231, 240],
    [10, 38, 62, 150],
    1,
  );
}

export function renderLevelPreviewPng(level) {
  const pixels = Buffer.alloc(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4);
  fillVerticalGradient(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT, [3, 8, 20], [1, 2, 10]);
  const minimapCenterX = 342;
  const minimapCenterY = 334;
  drawRadialGlow(pixels, minimapCenterX, minimapCenterY, 1020, [36, 104, 176], 0.46);
  drawRadialGlow(pixels, minimapCenterX, minimapCenterY, 760, [52, 150, 168], 0.3);
  drawRadialGlow(pixels, minimapCenterX, minimapCenterY, 420, [64, 176, 198], 0.18);

  for (let x = 0; x < PREVIEW_WIDTH; x += 88) {
    fillRectBlend(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT, x, 0, 1, PREVIEW_HEIGHT, [72, 150, 210, 88]);
  }
  for (let y = 0; y < PREVIEW_HEIGHT; y += 84) {
    fillRectBlend(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT, 0, y, PREVIEW_WIDTH, 1, [72, 150, 210, 82]);
  }

  const grid = parseGrid(level?.text);
  if (grid) {
    drawLevelMiniMap(pixels, grid);
  } else {
    fillRectBlend(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT, 92, 84, 500, 500, [15, 40, 64, 46]);
    drawTextLine(pixels, 'LEVEL DATA UNAVAILABLE', 138, 320, 2, [172, 204, 232, 220], [10, 38, 62, 150], 1);
  }

  drawAccentPanel(pixels, level?.name ?? level?.id ?? 'LOCKSTEP', level?.id ?? 'unknown-level');
  return encodePng(PREVIEW_WIDTH, PREVIEW_HEIGHT, pixels);
}
