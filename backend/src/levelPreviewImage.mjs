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

function drawLevelMiniMap(buffer, grid) {
  const rows = grid.length;
  const cols = grid[0].length;

  const cardX = 92;
  const cardY = 84;
  const cardWidth = 500;
  const cardHeight = 500;
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, cardX, cardY, cardWidth, cardHeight, [4, 18, 36, 235]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, cardX, cardY, cardWidth, 2, [91, 200, 255, 255]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, cardX, cardY + cardHeight - 2, cardWidth, 2, [91, 200, 255, 255]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, cardX, cardY, 2, cardHeight, [91, 200, 255, 255]);
  fillRect(
    buffer,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
    cardX + cardWidth - 2,
    cardY,
    2,
    cardHeight,
    [91, 200, 255, 255],
  );

  const innerPadding = 26;
  const tileAreaX = cardX + innerPadding;
  const tileAreaY = cardY + innerPadding;
  const tileAreaWidth = cardWidth - innerPadding * 2;
  const tileAreaHeight = cardHeight - innerPadding * 2;
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, tileAreaX, tileAreaY, tileAreaWidth, tileAreaHeight, [6, 11, 17, 255]);

  const gap = 1;
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
}

function drawAccentPanel(buffer, levelName) {
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 626, 108, 486, 74, [10, 28, 48, 185]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 626, 204, 486, 150, [8, 20, 34, 170]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 626, 372, 486, 212, [6, 16, 28, 165]);

  // Accent bars on the right side to keep share art recognizable without text rendering.
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 648, 130, 350, 14, [94, 223, 255, 240]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 648, 156, 410, 10, [140, 215, 255, 220]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 648, 228, 450, 10, [102, 174, 214, 205]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 648, 248, 385, 10, [102, 174, 214, 190]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 648, 392, 458, 12, [98, 238, 194, 220]);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 648, 416, 320, 8, [161, 220, 255, 200]);

  const normalizedName = String(levelName || '').trim();
  const hashSeed = normalizedName
    .split('')
    .reduce((seed, char) => ((seed << 5) - seed + char.charCodeAt(0)) | 0, 0);
  const accentWidth = 220 + Math.abs(hashSeed % 190);
  fillRect(buffer, PREVIEW_WIDTH, PREVIEW_HEIGHT, 648, 444, accentWidth, 8, [161, 220, 255, 186]);
}

export function renderLevelPreviewPng(level) {
  const pixels = Buffer.alloc(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4);
  fillVerticalGradient(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT, [6, 22, 44], [8, 10, 24]);

  for (let x = 0; x < PREVIEW_WIDTH; x += 88) {
    fillRect(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT, x, 0, 1, PREVIEW_HEIGHT, [60, 117, 165, 50]);
  }
  for (let y = 0; y < PREVIEW_HEIGHT; y += 84) {
    fillRect(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT, 0, y, PREVIEW_WIDTH, 1, [60, 117, 165, 40]);
  }

  const grid = parseGrid(level?.text);
  if (grid) {
    drawLevelMiniMap(pixels, grid);
  } else {
    fillRect(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT, 92, 84, 500, 500, [16, 24, 36, 230]);
    fillRect(pixels, PREVIEW_WIDTH, PREVIEW_HEIGHT, 118, 110, 448, 448, [23, 31, 45, 255]);
  }

  drawAccentPanel(pixels, level?.name ?? level?.id ?? 'LOCKSTEP');
  return encodePng(PREVIEW_WIDTH, PREVIEW_HEIGHT, pixels);
}
