import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-offer-reminders-'));
const port = 36000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('API did not start');
}

test('seeing 議價 clears that reminder only, and a new revision brings it back', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'offer-reminders-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  const seller = await registerAndLogin(base, { name: '賣家', email: 'remind-seller@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家', email: 'remind-buyer@example.com' });
  const sellerAuth = authHeaders(seller.token);
  const buyerAuth = authHeaders(buyer.token);

  async function badges(headers) {
    const res = await fetch(`${base}/api/badges`, { headers });
    assert.equal(res.status, 200, await res.clone().text());
    return res.json();
  }

  const listed = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '風扇',
      price: 120,
      category: '家電',
      location: '氹仔',
      condition: '良好',
      description: '可以議價，週末面交。',
      handover: '面交',
      negotiable: true,
      photos: [PNG],
    }),
  });
  assert.equal(listed.status, 201, await listed.clone().text());
  const listingId = (await listed.json()).listing.id;

  const offered = await fetch(`${base}/api/listings/${listingId}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 90, meetup: '賣家地點', message: '可少少' }),
  });
  assert.equal(offered.status, 201, await offered.clone().text());
  const offer = (await offered.json()).offer;

  const waiting = await badges(sellerAuth);
  assert.equal(waiting.offers, 1);
  assert.equal(waiting.messages, 1);
  assert.ok(waiting.notices >= 1);
  const buyerBefore = await badges(buyerAuth);
  assert.equal(buyerBefore.offers, 0);

  const stale = await fetch(`${base}/api/offers/seen`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({ items: [{ id: offer.id, updatedAt: offer.updatedAt - 1 }] }),
  });
  assert.equal(stale.status, 200, await stale.clone().text());
  assert.equal((await badges(sellerAuth)).offers, 1);

  const seen = await fetch(`${base}/api/offers/seen`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({ items: [{ id: offer.id, updatedAt: offer.updatedAt }] }),
  });
  assert.equal(seen.status, 200, await seen.clone().text());
  const quiet = await badges(sellerAuth);
  assert.equal(quiet.offers, 0);
  assert.equal(quiet.messages, waiting.messages);
  assert.equal(quiet.notices, waiting.notices);
  const sellerNotes = await fetch(`${base}/api/notifications`, { headers: sellerAuth });
  const unreadNotes = ((await sellerNotes.json()).notices || []).filter((row) => !row.read);
  assert.equal(unreadNotes.length, waiting.notices);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const updated = await fetch(`${base}/api/listings/${listingId}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 100, meetup: '賣家地點', message: '再講' }),
  });
  assert.equal(updated.status, 201, await updated.clone().text());
  const nextOffer = (await updated.json()).offer;
  assert.notEqual(nextOffer.updatedAt, offer.updatedAt);
  assert.equal((await badges(sellerAuth)).offers, 1);

  const countered = await fetch(`${base}/api/offers/${offer.id}`, {
    method: 'PATCH',
    headers: sellerAuth,
    body: JSON.stringify({ action: 'counter', counterAmount: 110 }),
  });
  assert.equal(countered.status, 200, await countered.clone().text());
  const afterCounter = await badges(sellerAuth);
  assert.equal(afterCounter.offers, 0);
  const buyerWaiting = await badges(buyerAuth);
  assert.equal(buyerWaiting.offers, 1);
  assert.equal(buyerWaiting.messages, 1);

  const buyerSeen = await fetch(`${base}/api/offers/seen`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ items: [{ id: offer.id, updatedAt: (await countered.json()).offer.updatedAt }] }),
  });
  assert.equal(buyerSeen.status, 200, await buyerSeen.clone().text());
  const buyerQuiet = await badges(buyerAuth);
  assert.equal(buyerQuiet.offers, 0);
  assert.equal(buyerQuiet.messages, 1);

  const freshNotes = await fetch(`${base}/api/notifications`, { headers: sellerAuth });
  const freshUnread = ((await freshNotes.json()).notices || []).filter((row) => !row.read);
  const readNotes = await fetch(`${base}/api/notifications/read`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({ ids: freshUnread.map((row) => row.id) }),
  });
  assert.equal(readNotes.status, 200, await readNotes.clone().text());
  const sellerAfterRead = await badges(sellerAuth);
  assert.equal(sellerAfterRead.notices, 0);
  assert.equal(sellerAfterRead.offers, 0);
  assert.equal((await badges(buyerAuth)).offers, 0);
});
