function xmur3(input) {
  let hash = 1779033703 ^ input.length;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return function nextSeed() {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6d2b79f5;
    let candidate = Math.imul(value ^ (value >>> 15), 1 | value);
    candidate ^= candidate + Math.imul(candidate ^ (candidate >>> 7), 61 | candidate);
    return ((candidate ^ (candidate >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeededRandom(seed) {
  const seedFactory = xmur3(String(seed ?? ''));
  const random = mulberry32(seedFactory());

  return {
    nextFloat() {
      return random();
    },

    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new Error(`Invalid int range: [${String(min)}, ${String(max)}]`);
      }

      const span = max - min + 1;
      return min + Math.floor(random() * span);
    },

    bool() {
      return random() < 0.5;
    },
  };
}
