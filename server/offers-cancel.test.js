import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-offers-cancel-'));
const port = 25000 + Math.floor(Math.random() * 20000);
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

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test('buyer can cancel a pending offer, and only while the seller has not replied', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'offers-cancel-test-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  const seller = await registerAndLogin(base, { name: '賣家', email: 'seller-cancel@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家', email: 'buyer-cancel@example.com' });
  const stranger = await registerAndLogin(base, { name: '路人', email: 'stranger-cancel@example.com' });
  const sellerAuth = authHeaders(seller.token);
  const buyerAuth = authHeaders(buyer.token);

  async function createListing(title) {
    const res = await fetch(`${base}/api/listings`, {
      method: 'POST',
      headers: sellerAuth,
      body: JSON.stringify({
        title,
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
    assert.equal(res.status, 201);
    return (await res.json()).listing;
  }

  async function offerOn(listingId, amount) {
    const res = await fetch(`${base}/api/listings/${listingId}/offers`, {
      method: 'POST',
      headers: buyerAuth,
      body: JSON.stringify({ amount, meetup: '賣家地點', message: '可少少' }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    return res.json();
  }

  async function patchOffer(token, offerId, body) {
    return fetch(`${base}/api/offers/${offerId}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    });
  }

  const listing = await createListing('二手風扇');
  const offered = await offerOn(listing.id, 90);
  const offerId = offered.offer.id;
  assert.equal(offered.offer.status, 'pending');

  const waiting = await fetch(`${base}/api/badges`, { headers: sellerAuth });
  assert.equal((await waiting.json()).offers, 1);

  const guest = await fetch(`${base}/api/offers/${offerId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel' }),
  });
  assert.equal(guest.status, 401);

  const strangerRes = await patchOffer(stranger.token, offerId, { action: 'cancel' });
  assert.equal(strangerRes.status, 403);

  const sellerCancel = await patchOffer(seller.token, offerId, { action: 'cancel' });
  assert.equal(sellerCancel.status, 403);
  assert.equal((await sellerCancel.json()).message, '只有買家可以取消出價');

  const cancelledRes = await patchOffer(buyer.token, offerId, { action: 'cancel' });
  assert.equal(cancelledRes.status, 200);
  const cancelled = await cancelledRes.json();
  assert.equal(cancelled.offer.status, 'cancelled');
  assert.equal(cancelled.offer.agreedAmount, null);
  assert.equal(cancelled.offer.amount, 90);
  const lines = cancelled.thread.messages.map((m) => m.text);
  assert.equal(lines.some((text) => text.includes('已取消出價 MOP 90')), true);

  const sellerOffers = await fetch(`${base}/api/offers/incoming`, { headers: sellerAuth }).then((r) => r.json());
  const seen = sellerOffers.offers.find((o) => o.id === offerId);
  assert.equal(seen.status, 'cancelled');

  const sellerThread = await fetch(`${base}/api/threads/${cancelled.thread.id}`, { headers: sellerAuth }).then((r) =>
    r.json()
  );
  assert.equal(sellerThread.thread.offer.status, 'cancelled');
  assert.equal(
    sellerThread.thread.messages.some((m) => m.text.includes('已取消出價 MOP 90')),
    true
  );

  const quiet = await fetch(`${base}/api/badges`, { headers: sellerAuth }).then((r) => r.json());
  assert.equal(quiet.offers, 0);

  const acceptCancelled = await patchOffer(seller.token, offerId, { action: 'accept' });
  assert.equal(acceptCancelled.status, 400);
  assert.equal((await acceptCancelled.json()).error, 'OFFER_CLOSED');

  const again = await patchOffer(buyer.token, offerId, { action: 'cancel' });
  assert.equal(again.status, 400);
  assert.equal((await again.json()).message, '只有待賣家回覆時可以取消');

  const renewed = await offerOn(listing.id, 95);
  assert.equal(renewed.offer.id, offerId);
  assert.equal(renewed.offer.status, 'pending');
  assert.equal(renewed.updated, true);

  const countered = await patchOffer(seller.token, offerId, { action: 'counter', counterAmount: 100 });
  assert.equal(countered.status, 200);
  const cancelCounter = await patchOffer(buyer.token, offerId, { action: 'cancel' });
  assert.equal(cancelCounter.status, 400);
  assert.equal((await cancelCounter.json()).message, '只有待賣家回覆時可以取消');

  const acceptedRes = await patchOffer(seller.token, offerId, { action: 'accept' });
  assert.equal(acceptedRes.status, 200);
  assert.equal((await acceptedRes.json()).offer.status, 'accepted');
  const cancelAccepted = await patchOffer(buyer.token, offerId, { action: 'cancel' });
  assert.equal(cancelAccepted.status, 400);
  assert.equal((await cancelAccepted.json()).error, 'OFFER_CLOSED');

  const other = await createListing('舊書一疊');
  const rejectedOffer = await offerOn(other.id, 20);
  const rejected = await patchOffer(seller.token, rejectedOffer.offer.id, { action: 'reject' });
  assert.equal(rejected.status, 200);
  const cancelRejected = await patchOffer(buyer.token, rejectedOffer.offer.id, { action: 'cancel' });
  assert.equal(cancelRejected.status, 400);
  assert.equal((await cancelRejected.json()).message, '只有待賣家回覆時可以取消');
});
