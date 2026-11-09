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

## Accounts

There is no built-in demo login. `POST /api/auth/register` creates an account with `emailVerified: false` and emails a one-time link (48 hours). The response does not include a session token. `POST /api/auth/login` rejects that account until `GET /auth/verify?token=` or `POST /api/auth/verify` marks it verified. Rows that have no `emailVerified` field (accounts created before this check, including current users) can still log in.

`POST /api/auth/resend-verification` sends another link only when the address is registered and still unverified. The JSON message is the same when the address is unknown. `POST /api/auth/forgot` emails a 30-minute `#/reset?token=` link when the address is registered and `RESEND_API_KEY` or `SMTP_URL` is set. The JSON message is the same either way, and the token is not returned. A mail failure is logged and still answers with that message. The same per-email and per-IP limits as resend apply.

On boot, leftover robot accounts (`demo@aomai.got` and `*@seed.aomai.got`) are removed with the listings, offers, threads, messages, reviews, handoffs, wants, devices, and notices that belong to them. Other emails are left in place.

## Persistence

- DB: `server/data/aomai.json` (gitignored; path mirrors planned `aomai.db`). `DATA_DIR` overrides the directory; the file is `$DATA_DIR/aomai.json`.
- Uploads: `server/uploads/`, or `UPLOADS_DIR` when set.
- Render Free cannot keep files across deploys. `render.yaml` uses the paid Starter plan and a 1 GB disk mounted at `/var/data`. Only paths under `/var/data` survive redeploys (`DATA_DIR=/var/data/db`, `UPLOADS_DIR=/var/data/uploads`).
- Privacy: `GET /privacy`（contact `mogot.app@gmail.com`）
- Support: `GET /support`（same mailbox; App Store support URL）

## Env

| Var | Default |
|-----|---------|
| `PORT` | `8787` |
| `JWT_SECRET` | `aomai-got-dev-secret-change-me` |
| `DATA_DIR` | `server/data`. On Render: `/var/data/db` |
| `UPLOADS_DIR` | `server/uploads`. On Render: `/var/data/uploads` |
| `PUBLIC_BASE` | request host, or `RENDER_EXTERNAL_URL` when set. Loopback values are ignored so production does not emit `127.0.0.1`. Verification and password-reset links use this origin. |
| `SMTP_URL` | unset. SMTP URL such as `smtps://user:pass@smtp.example.com:465`. Do not commit the value. |
| `RESEND_API_KEY` | unset. If this and `SMTP_URL` are both set, Resend is used. |
| `MAIL_FROM` | `澳賣GOT <noreply@aomai-got.onrender.com>`. Set a sender the provider has already verified. |
| `NODE_ENV` | Render sets `production`. Register then returns 503 unless `SMTP_URL` or `RESEND_API_KEY` is set, so a new account is not created without a verification email. |

## Extra routes

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/privacy` | no | Public privacy policy. Contact `mogot.app@gmail.com` |
| GET | `/support` | no | Public support page. Same mailbox |
| GET | `/auth/verify?token=` | no | One-time email verification page |
| POST | `/api/auth/verify` | no | `{ token }` marks `emailVerified` |
| POST | `/api/auth/resend-verification` | no | `{ email }`. Same message whether or not the address exists. Limited per email and IP |
| POST | `/api/auth/forgot` | no | `{ email }`. Reset mail when the address exists. Same message either way. Limited per email and IP |
| POST | `/api/auth/reset` | no | `{ token, password }` from the `#/reset` link. Link expires in 30 minutes |
| GET | `/api/badges` | yes | `{ messages, offers, notices }` — unread threads, offers waiting on you, unread in-app notices |
| GET | `/api/listings?limit&offset` | optional | Public browse hides sold. `mine=1` (auth) is the signed-in seller's inventory, including sold. Omit `limit` for every matching row. With `limit`, also returns `total`, `hasMore`, `nextOffset` |
| DELETE | `/api/listings/:id` | yes | Seller only. Hides the listing from browse and 我的刊登. The row stays so old detail links still open as removed. Pending and countered offers on it are closed. Threads stay |
| PATCH | `/api/offers/:id` | yes | `{ action: "cancel" }` — buyer only, while the offer is `pending`. Status becomes `cancelled`. Accepted, rejected, and countered offers cannot be cancelled |
| DELETE | `/api/threads/:id` | yes | Participant only. Hides that thread from the caller's 訊息 list. The other person, the messages, and the offer stay. A later message from either person clears the hide and the same thread returns |
| DELETE | `/api/threads/:id/messages/:messageId` | yes | Sender only. Removes that message for both people and refreshes the thread preview |
| DELETE | `/api/offers/:id` | yes | Buyer or seller. Hides that offer from the caller's 我的議價 and from their own listing offer list. Does not cancel the bid or change the other person's list or the thread. A later bid, cancel, accept, reject, or counter clears the hide |
| PUT | `/api/offers/:id/handoff` | yes | Buyer or seller, accepted offer only. `{ placeId, customPlace?, when, note? }` |
| POST | `/api/offers/:id/handoff/confirm` | yes | Confirms the current proposal. Both sides must confirm |
| GET | `/api/notifications` | yes | In-app notices for messages, offers, handoff |
| POST | `/api/notifications/read` | yes | `{ ids?: string[] }` — omit ids to mark all read |
| POST | `/api/devices` | yes | Store a push token. Remote APNs/FCM is not sent |
| GET | `/api/push/status` | yes | `{ remotePush: false, ... }` |
| GET | `/api/price-hint?category&condition` | no | Peer range or a rough guide. Not an appraisal |
| GET | `/api/users/:id` | optional | Public profile, listings, short reviews. No email |
| PATCH | `/api/listings/:id/sold` | yes | Seller only. Marks sold and links the accepted buyer |
| POST | `/api/listings/:id/confirm-receipt` | yes | Accepted buyer marks sold to themselves. Idempotent if already that buyer |
| POST | `/api/listings/:id/reviews` | yes | `{ stars: 1-5, text? }` after a completed handover. Stars required, text optional up to 80 |
| GET | `/api/stats` | yes | Also returns `active`, `sold`, `saved`, `bought`, `trust` |

Opening a thread (`GET /api/threads/:id`) still clears that side’s unread flag. Marking a listing sold links the buyer from the accepted offer when there is one. Trust copy must stay peer-level: no platform authentication, appraisal, or escrow.
