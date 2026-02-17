import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILT_IN_LEVEL_NAMES = {
  map0: 'Relay Threshold',
  map1: 'Mirror Lift',
  map2: 'Furnace Bend',
  map3: 'Twin Ramps',
  map4: 'Split Current',
  map5: 'Lattice Vault',
  map6: 'Signal Choke',
  map7: 'Crosswind Loop',
  map8: 'Pulse Gallery',
  map9: 'Ash Corridor',
  map10: 'Echo Grid',
  map11: 'Fracture Gate',
  map12: 'Core Finale',
};

function normalizeLevelText(raw) {
  return raw.replace(/\r/g, '').replace(/\n+$/g, '');
}

function loadBuiltInLevels() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const levelsDir = resolve(currentDir, '..', 'levels');

  try {
    const manifestText = readFileSync(resolve(levelsDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText);
    if (!Array.isArray(manifest)) {
      return new Map();
    }

    const levels = new Map();
    for (const entry of manifest) {
      if (typeof entry !== 'string' || !entry.endsWith('.txt')) {
        continue;
      }

      const id = entry.slice(0, -4);
      const text = normalizeLevelText(readFileSync(resolve(levelsDir, entry), 'utf8'));
      levels.set(id, {
        id,
        name: BUILT_IN_LEVEL_NAMES[id] ?? id,
        text,
        updatedAt: 0,
        isBuiltIn: true,
      });
    }

    return levels;
  } catch {
    return new Map();
  }
}

const BUILT_IN_LEVELS = loadBuiltInLevels();

export function getBuiltInLevel(levelId) {
  return BUILT_IN_LEVELS.get(levelId) ?? null;
}
