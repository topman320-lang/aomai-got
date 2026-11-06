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

## Extra routes

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/api/badges` | yes | `{ messages, offers }` — unread threads, and offers waiting on you |
| GET | `/api/price-hint?category&condition` | no | Peer range or a rough guide. Not an appraisal |
| GET | `/api/users/:id` | optional | Public profile, listings, short reviews. No email |
| POST | `/api/listings/:id/reviews` | yes | `{ stars: 1-5, text? }` after a completed handover |
| GET | `/api/stats` | yes | Also returns `active`, `sold`, `saved`, `bought`, `trust` |

Opening a thread (`GET /api/threads/:id`) still clears that side’s unread flag. Marking a listing sold links the buyer from the accepted offer when there is one. Trust copy must stay peer-level: no platform authentication, appraisal, or escrow.
