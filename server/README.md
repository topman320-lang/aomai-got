# 澳賣GOT API

English short name: **MoGOT**.

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
| `PUBLIC_BASE` | request host, or `RENDER_EXTERNAL_URL` when set. Loopback values are ignored so production does not emit `127.0.0.1`. |

## Extra routes

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/api/badges` | yes | `{ messages, offers, notices }` — unread threads, offers waiting on you, unread in-app notices |
| GET | `/api/listings?limit&offset` | optional | Omit `limit` for the full list (我的). With `limit`, also returns `total`, `hasMore`, `nextOffset` |
| PUT | `/api/offers/:id/handoff` | yes | Buyer or seller, accepted offer only. `{ placeId, customPlace?, when, note? }` |
| POST | `/api/offers/:id/handoff/confirm` | yes | Confirms the current proposal. Both sides must confirm |
| GET | `/api/notifications` | yes | In-app notices for messages, offers, handoff |
| POST | `/api/notifications/read` | yes | `{ ids?: string[] }` — omit ids to mark all read |
| POST | `/api/devices` | yes | Store a push token. Remote APNs/FCM is not sent |
| GET | `/api/push/status` | yes | `{ remotePush: false, ... }` |
| GET | `/api/price-hint?category&condition` | no | Peer range or a rough guide. Not an appraisal |
| GET | `/api/users/:id` | optional | Public profile, listings, short reviews. No email |
| POST | `/api/listings/:id/reviews` | yes | `{ stars: 1-5, text? }` after a completed handover |
| GET | `/api/stats` | yes | Also returns `active`, `sold`, `saved`, `bought`, `trust` |

Opening a thread (`GET /api/threads/:id`) still clears that side’s unread flag. Marking a listing sold links the buyer from the accepted offer when there is one. Trust copy must stay peer-level: no platform authentication, appraisal, or escrow.
