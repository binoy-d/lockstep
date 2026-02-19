# Sandbox Level Generator

This folder is intentionally isolated from runtime game code. It provides a standalone seeded level generator that targets an exact minimum solve length.

## What It Does

- Accepts:
  - `seed` (`string`, length `< 32`)
  - `players` (`integer >= 1`)
  - `difficulty` (`integer 1..100`)
  - optional `width`/`height` (defaults: `25x16`)
- Builds deterministic corridor-based layouts where every player has an isolated lane.
- Uses a built-in BFS solver to verify the generated level is solvable with **exactly** the requested minimum move count.

## Why This Is Isolated

- No files under `web/src` or `backend/src` are imported/modified.
- No existing build/test/deploy scripts are changed.
- You run it manually with Node.

## Run

```bash
node sandbox/level-generator/cli.mjs --seed "alpha" --players 2 --difficulty 24
```

Write level text to a file:

```bash
node sandbox/level-generator/cli.mjs \
  --seed "alpha" \
  --players 2 \
  --difficulty 24 \
  --out ./sandbox/level-generator/generated-level.txt
```

JSON output:

```bash
node sandbox/level-generator/cli.mjs --seed "alpha" --players 2 --difficulty 24 --json
```

## Test

```bash
node --test sandbox/level-generator/generator.test.mjs
```

## Feasibility Notes

Because each player gets an isolated lane in the fixed map size, some `(players, difficulty, width, height)` combinations are mathematically impossible. The generator will throw a clear error when that happens.
