const BUILT_IN_LEVEL_NAMES: Record<string, string> = {
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

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeLevelName(raw: string | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

export function getLevelName(levelId: string, levelIndex: number, customName?: string): string {
  const normalizedCustomName = normalizeLevelName(customName);
  if (normalizedCustomName) {
    return normalizedCustomName;
  }

  return BUILT_IN_LEVEL_NAMES[levelId] ?? `Custom Circuit ${levelIndex + 1}`;
}

export function getLevelLabel(levelId: string, levelIndex: number, customName?: string): string {
  return `Level ${levelIndex + 1}: ${getLevelName(levelId, levelIndex, customName)}`;
}

export function getLevelMusicSeed(levelId: string, levelIndex: number): number {
  const hash = stableHash(`${levelId}::${levelIndex}::lockstep-seed`);
  return hash === 0 ? 1 : hash;
}
