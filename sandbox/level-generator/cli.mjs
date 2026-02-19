#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateLevel } from './generator.mjs';

function printHelp() {
  console.log(`Usage:
  node sandbox/level-generator/cli.mjs --seed <text> --players <n> --difficulty <1-100> [options]

Options:
  --width <n>        Level width (default: 25)
  --height <n>       Level height (default: 16)
  --attempts <n>     Generation attempts (default: 64)
  --out <path>       Write level text to this path
  --json             Print full JSON payload
  --help             Show this help`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help') {
      options.help = true;
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '--seed') {
      options.seed = next;
    } else if (arg === '--players') {
      options.players = Number.parseInt(next, 10);
    } else if (arg === '--difficulty') {
      options.difficulty = Number.parseInt(next, 10);
    } else if (arg === '--width') {
      options.width = Number.parseInt(next, 10);
    } else if (arg === '--height') {
      options.height = Number.parseInt(next, 10);
    } else if (arg === '--attempts') {
      options.maxAttempts = Number.parseInt(next, 10);
    } else if (arg === '--out') {
      options.out = next;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    index += 1;
  }

  return options;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (typeof args.seed !== 'string' || !Number.isInteger(args.players) || !Number.isInteger(args.difficulty)) {
    printHelp();
    throw new Error('Required: --seed, --players, --difficulty');
  }

  const result = generateLevel({
    seed: args.seed,
    players: args.players,
    difficulty: args.difficulty,
    width: args.width,
    height: args.height,
    maxAttempts: args.maxAttempts,
  });

  if (args.out) {
    const destination = resolve(args.out);
    writeFileSync(destination, `${result.levelText}\n`, 'utf8');
    console.error(`Wrote level text to ${destination}`);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Seed: ${result.seed}`);
  console.log(`Players: ${result.players}`);
  console.log(`Difficulty: ${result.difficulty}`);
  console.log(`Solved Min Moves: ${result.minMoves}`);
  console.log(`Rows Per Lane: ${result.rowsPerLane}`);
  console.log(`Visited States: ${result.visitedStates}`);
  console.log('--- Level ---');
  console.log(result.levelText);
  console.log('--- Solver Solution ---');
  console.log(result.solverSolution.join(','));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
