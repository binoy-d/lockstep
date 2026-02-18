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
cp .env.example .env
# then set API_SESSION_SECRET to a random value:
# openssl rand -hex 32
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

### Relevant-File Coverage (Automated Script)

Run both backend and web relevant-file coverage from repo root:

```bash
./scripts/run-coverage.sh
```

Run coverage for one side only:

```bash
./scripts/run-coverage.sh backend
./scripts/run-coverage.sh web
```

Notes:

- Backend coverage command is `npm run coverage` in `backend/`.
- Web relevant coverage command is `npm run coverage:relevant` in `web/`.
- Web HTML coverage output is generated at `web/coverage/index.html`.

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

Deploy pipeline behavior:

1. Every `main` push touching app/deploy files (or manual run) triggers `deploy-production`.
2. The workflow runs `verify-web` (install, lint, test, build) and `verify-backend` (install, syntax check, test) on GitHub-hosted runners.
3. Only after both pass, the self-hosted `deploy` job runs on `/home/daniel/dev/lockstep`.
4. Deploy injects GitHub secrets/variables as process env, pulls `main`, and runs `docker compose up -d --build`.

Required GitHub environment configuration (Environment: `production`):

- `API_SESSION_SECRET` (secret, required; long random value, e.g. 64 hex chars)
- `ADMIN_PASSWORD` (secret, optional; if empty, admin bootstrap is disabled)
- `PUBLIC_ORIGIN` (variable, required; e.g. `https://lockstep.binoy.co`)
- `ADMIN_USERNAME` (variable, optional, defaults to `admin`)
- `ADMIN_PLAYER_NAME` (variable, optional, defaults to `admin`)

Security notes:

- No credentials should be committed in `docker-compose.yml` or source files.
- `.env` files are git-ignored; keep secrets in GitHub secrets or secure local env files.
- Backend enforces `API_SESSION_SECRET` in production mode.

## Levels

- Built-in levels: `web/public/assets/levels/*.txt`
- Level manifest: `web/public/assets/levels/manifest.json`
- Custom levels are persisted in backend SQLite and exposed through API.

## Docs

- Architecture: `web/docs/ARCHITECTURE.md`
- Copilot instructions: `.github/copilot-instructions.md`
