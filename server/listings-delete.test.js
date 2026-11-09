import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-listings-delete-'));
const port = 27000 + Math.floor(Math.random() * 20000);
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

test('seller can remove their own listing without breaking detail or existing threads', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'listings-delete-test-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  const seller = await registerAndLogin(base, { name: '賣家', email: 'seller-remove@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家', email: 'buyer-remove@example.com' });
  const other = await registerAndLogin(base, { name: '另一位', email: 'other-remove@example.com' });
  const sellerAuth = authHeaders(seller.token);
  const buyerAuth = authHeaders(buyer.token);

  async function createListing(title, price) {
    const res = await fetch(`${base}/api/listings`, {
      method: 'POST',
      headers: sellerAuth,
      body: JSON.stringify({
        title,
        price,
        category: '家電',
        location: '氹仔',
        condition: '良好',
        description: '可以面交，用過半年。',
        handover: '面交',
        negotiable: true,
        photos: [PNG],
      }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    return (await res.json()).listing;
  }

  const listing = await createListing('二手風扇', 120);
  const kept = await createListing('保留的書', 40);

  const wanted = await fetch(`${base}/api/listings/${listing.id}/want`, { method: 'POST', headers: buyerAuth });
  assert.equal(wanted.status, 200);

  const pendingRes = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 90, meetup: '賣家地點', message: '可少少' }),
  });
  assert.equal(pendingRes.status, 201);
  const pending = await pendingRes.json();
  const threadId = pending.thread.id;

  const acceptedListing = await createListing('已談妥的燈', 80);
  const acceptedOfferRes = await fetch(`${base}/api/listings/${acceptedListing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 80, meetup: '賣家地點', message: '就這個價' }),
  });
  assert.equal(acceptedOfferRes.status, 201);
  const acceptedOffer = await acceptedOfferRes.json();
  const accept = await fetch(`${base}/api/offers/${acceptedOffer.offer.id}`, {
    method: 'PATCH',
    headers: sellerAuth,
    body: JSON.stringify({ action: 'accept' }),
  });
  assert.equal(accept.status, 200);

  const guest = await fetch(`${base}/api/listings/${listing.id}`, { method: 'DELETE' });
  assert.equal(guest.status, 401);
  const stranger = await fetch(`${base}/api/listings/${listing.id}`, {
    method: 'DELETE',
    headers: buyerAuth,
  });
  assert.equal(stranger.status, 403);

  const removedRes = await fetch(`${base}/api/listings/${listing.id}`, { method: 'DELETE', headers: sellerAuth });
  assert.equal(removedRes.status, 200);
  const removed = await removedRes.json();
  assert.equal(removed.listing.removed, true);
  assert.equal(removed.listing.title, '二手風扇');
  assert.equal(removed.offers.find((o) => o.id === pending.offer.id).status, 'rejected');
  assert.equal(
    removed.threads.some((thread) => thread.messages.some((m) => m.text === '刊登已移除，這筆出價已結束')),
    true
  );

  const home = await fetch(`${base}/api/listings`).then((r) => r.json());
  assert.equal(home.listings.some((l) => l.id === listing.id), false);
  assert.equal(home.listings.some((l) => l.id === kept.id), true);

  const mine = await fetch(`${base}/api/listings?mine=1`, { headers: sellerAuth }).then((r) => r.json());
  assert.equal(mine.listings.some((l) => l.id === listing.id), false);
  assert.equal(mine.listings.some((l) => l.id === kept.id), true);

  const detail = await fetch(`${base}/api/listings/${listing.id}`);
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.listing.removed, true);
  assert.equal(body.listing.title, '二手風扇');

  const buyerThread = await fetch(`${base}/api/threads/${threadId}`, { headers: buyerAuth }).then((r) => r.json());
  assert.equal(buyerThread.thread.listing.id, listing.id);
  assert.equal(buyerThread.thread.listing.removed, true);
  assert.equal(buyerThread.thread.listing.title, '二手風扇');
  assert.equal(buyerThread.thread.offer.status, 'rejected');

  const wants = await fetch(`${base}/api/wants`, { headers: buyerAuth }).then((r) => r.json());
  assert.equal(wants.wants.includes(listing.id), false);

  const again = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 70, meetup: '賣家地點' }),
  });
  assert.equal(again.status, 400);
  assert.equal((await again.json()).error, 'LISTING_REMOVED');

  const reopened = await fetch(`${base}/api/listings/${listing.id}/thread`, { method: 'POST', headers: buyerAuth });
  assert.equal(reopened.status, 200);
  assert.equal((await reopened.json()).thread.id, threadId);

  const fresh = await fetch(`${base}/api/listings/${listing.id}/thread`, {
    method: 'POST',
    headers: authHeaders(other.token),
  });
  assert.equal(fresh.status, 400);
  assert.equal((await fresh.json()).error, 'LISTING_REMOVED');

  const twice = await fetch(`${base}/api/listings/${listing.id}`, { method: 'DELETE', headers: sellerAuth });
  assert.equal(twice.status, 200);
  const after = await fetch(`${base}/api/threads/${threadId}`, { headers: buyerAuth }).then((r) => r.json());
  assert.equal(after.thread.messages.filter((m) => m.text === '刊登已移除，這筆出價已結束').length, 1);

  const soldOff = await fetch(`${base}/api/listings/${acceptedListing.id}`, { method: 'DELETE', headers: sellerAuth });
  assert.equal(soldOff.status, 200);
  const keptDeal = (await soldOff.json()).offers.find((o) => o.id === acceptedOffer.offer.id);
  assert.equal(keptDeal.status, 'accepted');
  const soldDetail = await fetch(`${base}/api/listings/${acceptedListing.id}`).then((r) => r.json());
  assert.equal(soldDetail.listing.removed, true);
  assert.equal(soldDetail.listing.title, '已談妥的燈');

  const profile = await fetch(`${base}/api/users/${seller.user.id}`).then((r) => r.json());
  assert.equal(profile.listings.some((l) => l.id === listing.id || l.id === acceptedListing.id), false);
  assert.equal(profile.listings.some((l) => l.id === kept.id), true);
});
