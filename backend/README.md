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
