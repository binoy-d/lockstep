# LOCKSTEP

Lockstep is a browser-first puzzle game where all players move together every turn.

## Stack

- Web: TypeScript + Vite + Phaser 3
- UI: HTML/CSS overlay controlled by TypeScript
- Backend: Node.js + SQLite (custom levels + per-level top-10 scores)
- Tests: Vitest (web), Node test runner (backend)
- CI: GitHub Actions (`lint`, `test`, `build`)
- Deploy: GitHub Actions manual workflow (`deploy-production`)

## Quick Start (Docker, one command)

From repo root:

```bash
docker compose up --build
```

Then open `http://localhost:5173`.

Services:

- Web: `http://localhost:5173`
- Backend API: `http://localhost:8787`

Stop:

```bash
docker compose down
```

Reset DB volume:

```bash
docker compose down -v
```

## Local Development

### Backend

```bash
cd backend
npm run start
```

### Web

```bash
cd web
npm install
npm run dev
```

## Testing

### Web tests

```bash
cd web
npm run test
```

Coverage:

```bash
cd web
npm run coverage
```

### Backend tests

```bash
cd backend
npm run test
```

## Lint + Build

```bash
cd web
npm run lint
npm run build
```

## Project Layout

- `web/`: game client (core logic, runtime, UI, editor, assets)
- `backend/`: API for user-created levels and leaderboards
- `.github/workflows/web-ci.yml`: CI pipeline
- `.github/workflows/deploy-production.yml`: manual production deploy via SSH
- `docker-compose.yml`: one-command local stack

## Production Deploy (GitHub Actions)

This repo uses a self-hosted runner (`lockstep` label) on `binoyserver`, so deploy runs do not consume paid GitHub-hosted minutes.

Deploy steps:

1. In GitHub, run workflow: `Actions -> deploy-production -> Run workflow`.
2. The self-hosted runner executes on `/home/daniel/dev/lockstep`, pulls `main`, and runs:
   - `docker-compose up -d --build`

Safety guard:
- The workflow job only runs when `github.event.repository.private == false`, so it is blocked if the repo ever becomes private.

## Levels

- Built-in levels: `web/public/assets/levels/*.txt`
- Level manifest: `web/public/assets/levels/manifest.json`
- Custom levels are persisted in backend SQLite and exposed through API.

## Docs

- Architecture: `web/docs/ARCHITECTURE.md`
- Copilot instructions: `.github/copilot-instructions.md`
