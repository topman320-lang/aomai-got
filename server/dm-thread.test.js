import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-dm-thread-'));
const port = 24000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

test('private message opens one thread with the seller and reuses an offer thread', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: path.join(tmp, 'data'),
      UPLOADS_DIR: path.join(tmp, 'uploads'),
      JWT_SECRET: 'dm-thread-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  async function register(name, email) {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: 'secret1' }),
    });
    assert.equal(res.status, 201);
    return res.json();
  }

  const seller = await register('賣家', 'seller-dm@example.com');
  const buyer = await register('買家', 'buyer-dm@example.com');
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };
  const buyerAuth = { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' };

  const createdRes = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '二手風扇',
      price: 120,
      category: '家電',
      location: '氹仔',
      condition: '良好',
      description: '可以私訊問細節。',
      handover: '面交',
      negotiable: false,
      photos: [PNG],
    }),
  });
  assert.equal(createdRes.status, 201);
  const listing = (await createdRes.json()).listing;
  assert.equal(listing.negotiable, false);

  const guest = await fetch(`${base}/api/listings/${listing.id}/thread`, { method: 'POST' });
  assert.equal(guest.status, 401);

  const own = await fetch(`${base}/api/listings/${listing.id}/thread`, { method: 'POST', headers: sellerAuth });
  assert.equal(own.status, 400);
  assert.equal((await own.json()).error, 'OWN_LISTING');

  const missing = await fetch(`${base}/api/listings/missing-id/thread`, { method: 'POST', headers: buyerAuth });
  assert.equal(missing.status, 404);

  const opened = await fetch(`${base}/api/listings/${listing.id}/thread`, { method: 'POST', headers: buyerAuth });
  assert.equal(opened.status, 200);
  const first = (await opened.json()).thread;
  assert.equal(first.listingId, listing.id);
  assert.equal(first.buyerId, buyer.user.id);
  assert.equal(first.sellerId, seller.user.id);
  assert.equal(first.messages.length, 0);

  const again = await fetch(`${base}/api/listings/${listing.id}/thread`, { method: 'POST', headers: buyerAuth });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).thread.id, first.id);

  const sent = await fetch(`${base}/api/threads/${first.id}/messages`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ text: '還在嗎？' }),
  });
  assert.equal(sent.status, 201);

  const sellerThreads = await fetch(`${base}/api/threads`, { headers: { Authorization: `Bearer ${seller.token}` } });
  assert.equal(sellerThreads.status, 200);
  const inbox = (await sellerThreads.json()).threads;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].id, first.id);
  assert.equal(inbox[0].preview, '還在嗎？');

  const offerRes = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 100, meetup: '賣家地點', message: '可少少' }),
  });
  assert.equal(offerRes.status, 201);
  const offered = await offerRes.json();
  assert.equal(offered.thread.id, first.id);

  const afterOffer = await fetch(`${base}/api/listings/${listing.id}/thread`, { method: 'POST', headers: buyerAuth });
  assert.equal((await afterOffer.json()).thread.id, first.id);
});
