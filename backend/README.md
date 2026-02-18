# 2P1P Puzzle Backend

Simple Node backend for:

- storing user-created levels
- storing per-level top 10 scores

## Run

```bash
cd backend
npm run start
```

Default URL: `http://localhost:8787`

## Dev mode

```bash
npm run dev
```

## Test

```bash
npm run test
```

## Coverage

```bash
npm run coverage
```

## API

- `GET /api/health`
- `GET /api/levels`
- `POST /api/levels`
- `GET /api/scores/:levelId`
- `POST /api/scores`

All requests/responses are JSON.

## Share + Preview Routes

- `GET /l/:levelId` (or `GET /share/:levelId`)
  - Returns social-meta HTML for link previews and immediately forwards browsers to `/?level=:levelId`.
- `GET /og/:levelId.png`
  - Returns a dynamically generated level preview image (minimap-based PNG).

## Storage

SQLite file at `backend/data/puzzle.sqlite` (configurable via `DB_PATH`).

## Environment Variables

- `PORT` (default: `8787`)
- `DB_PATH` (default: `backend/data/puzzle.sqlite`)
- `PUBLIC_ORIGIN` (default: `https://lockstep.binoy.co`)
- `API_SESSION_SECRET`
  - Required in production (`NODE_ENV=production`).
  - If omitted outside production, a random runtime secret is generated.
- `ADMIN_USERNAME` (optional, default: `admin`)
- `ADMIN_PLAYER_NAME` (optional, default: `ADMIN_USERNAME`)
- `ADMIN_PASSWORD` (optional)
  - If set, backend ensures the admin account exists/updates credentials on startup.
  - If empty, admin bootstrap is disabled.
