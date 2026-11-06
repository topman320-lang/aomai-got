# 澳賣 GOT API

Minimal Express backend (JSON file store — `better-sqlite3` failed to build here without `make`).

## Start

```bash
cd server
npm install
npm start
```

Listens on **http://127.0.0.1:8787**.

From repo root: `npm run server` (after `npm run server:install` once).

## Demo account

| Field | Value |
|-------|-------|
| Email | `demo@aomai.got` |
| Password | `demo1234` |

## Persistence

- DB: `server/data/aomai.json` (gitignored; path mirrors planned `aomai.db`)
- Uploads: `server/uploads/`
- Privacy: `GET /privacy`

## Env

| Var | Default |
|-----|---------|
| `PORT` | `8787` |
| `JWT_SECRET` | `aomai-got-dev-secret-change-me` |
| `PUBLIC_BASE` | `http://127.0.0.1:8787` |
