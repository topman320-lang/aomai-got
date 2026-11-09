import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function startServer(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-inbox-hide-'));
  const port = 28000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'inbox-hide-test-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return base;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  child.kill();
  throw new Error('API did not start');
}

async function inbox(base, token) {
  const res = await fetch(`${base}/api/threads`, { headers: authHeaders(token) });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()).threads;
}

test('either person can hide a thread from their own inbox', async (t) => {
  const base = await startServer(t);
  const seller = await registerAndLogin(base, { name: '賣家', email: 'seller-hide-thread@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家', email: 'buyer-hide-thread@example.com' });
  const stranger = await registerAndLogin(base, { name: '路人', email: 'stranger-hide-thread@example.com' });
  const sellerAuth = authHeaders(seller.token);
  const buyerAuth = authHeaders(buyer.token);

  const created = await fetch(`${base}/api/listings`, {
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
      negotiable: true,
      photos: [PNG],
    }),
  });
  assert.equal(created.status, 201);
  const listing = (await created.json()).listing;

  const opened = await fetch(`${base}/api/listings/${listing.id}/thread`, { method: 'POST', headers: buyerAuth });
  assert.equal(opened.status, 200);
  const threadId = (await opened.json()).thread.id;
  assert.equal((await inbox(base, buyer.token)).some((row) => row.id === threadId), true);
  assert.equal((await inbox(base, seller.token)).some((row) => row.id === threadId), true);

  const guest = await fetch(`${base}/api/threads/${threadId}`, { method: 'DELETE' });
  assert.equal(guest.status, 401);
  const strangerRes = await fetch(`${base}/api/threads/${threadId}`, { method: 'DELETE', headers: authHeaders(stranger.token) });
  assert.equal(strangerRes.status, 403);
  const missing = await fetch(`${base}/api/threads/missing-thread`, { method: 'DELETE', headers: buyerAuth });
  assert.equal(missing.status, 404);

  const hidden = await fetch(`${base}/api/threads/${threadId}`, { method: 'DELETE', headers: buyerAuth });
  assert.equal(hidden.status, 200);
  assert.equal((await inbox(base, buyer.token)).some((row) => row.id === threadId), false);
  assert.equal((await inbox(base, seller.token)).some((row) => row.id === threadId), true);

  const stillThere = await fetch(`${base}/api/threads/${threadId}`, { headers: buyerAuth });
  assert.equal(stillThere.status, 200);
  assert.equal((await stillThere.json()).thread.messages.length, 0);

  const reopened = await fetch(`${base}/api/listings/${listing.id}/thread`, { method: 'POST', headers: buyerAuth });
  assert.equal(reopened.status, 200);
  assert.equal((await reopened.json()).thread.id, threadId);
  assert.equal((await inbox(base, buyer.token)).some((row) => row.id === threadId), false);

  const sent = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ text: '還在嗎？' }),
  });
  assert.equal(sent.status, 201);
  const messageId = (await sent.json()).message.id;
  const buyerBack = await inbox(base, buyer.token);
  const sellerBack = await inbox(base, seller.token);
  assert.equal(buyerBack.find((row) => row.id === threadId)?.preview, '還在嗎？');
  assert.equal(sellerBack.find((row) => row.id === threadId)?.preview, '還在嗎？');

  const hideAgain = await fetch(`${base}/api/threads/${threadId}`, { method: 'DELETE', headers: buyerAuth });
  assert.equal(hideAgain.status, 200);
  const removedMsg = await fetch(`${base}/api/threads/${threadId}/messages/${messageId}`, {
    method: 'DELETE',
    headers: buyerAuth,
  });
  assert.equal(removedMsg.status, 200);
  assert.equal((await inbox(base, buyer.token)).some((row) => row.id === threadId), false);
  const sellerAfterDelete = (await inbox(base, seller.token)).find((row) => row.id === threadId);
  assert.equal(sellerAfterDelete.messages.some((m) => m.id === messageId), false);

  const sellerBadgesBefore = await fetch(`${base}/api/badges`, { headers: sellerAuth }).then((r) => r.json());
  assert.equal(sellerBadgesBefore.messages, 1);

  const reply = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({ text: '在' }),
  });
  assert.equal(reply.status, 201);
  assert.equal((await inbox(base, buyer.token)).find((row) => row.id === threadId)?.preview, '在');
  const buyerBadges = await fetch(`${base}/api/badges`, { headers: buyerAuth }).then((r) => r.json());
  assert.equal(buyerBadges.messages, 1);

  const sellerHides = await fetch(`${base}/api/threads/${threadId}`, { method: 'DELETE', headers: sellerAuth });
  assert.equal(sellerHides.status, 200);
  assert.equal((await inbox(base, seller.token)).some((row) => row.id === threadId), false);
  assert.equal((await inbox(base, buyer.token)).some((row) => row.id === threadId), true);
});

test('either person can hide an offer from their own list without cancelling it', async (t) => {
  const base = await startServer(t);
  const seller = await registerAndLogin(base, { name: '賣家', email: 'seller-hide-offer@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家', email: 'buyer-hide-offer@example.com' });
  const stranger = await registerAndLogin(base, { name: '路人', email: 'stranger-hide-offer@example.com' });
  const sellerAuth = authHeaders(seller.token);
  const buyerAuth = authHeaders(buyer.token);

  const created = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '1969年美國KFC炸雞筒中古正品',
      price: 2500,
      category: '玩具',
      location: '澳門',
      condition: '良好',
      description: '中古正品。',
      handover: '面交',
      negotiable: true,
      photos: [PNG],
    }),
  });
  assert.equal(created.status, 201);
  const listing = (await created.json()).listing;

  const offered = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 2125, meetup: '賣家地點', message: '' }),
  });
  assert.equal(offered.status, 201, await offered.clone().text());
  const offeredBody = await offered.json();
  const offer = offeredBody.offer;
  const threadId = offeredBody.thread?.id || offer.threadId;

  async function mine(token) {
    const res = await fetch(`${base}/api/offers/mine`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    return (await res.json()).offers;
  }
  async function incoming(token) {
    const res = await fetch(`${base}/api/offers/incoming`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    return (await res.json()).offers;
  }
  async function listingOffers(token) {
    const res = await fetch(`${base}/api/listings/${listing.id}/offers`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    return (await res.json()).offers;
  }

  assert.equal((await mine(buyer.token)).some((o) => o.id === offer.id), true);
  assert.equal((await incoming(seller.token)).some((o) => o.id === offer.id), true);
  assert.ok(threadId);
  assert.equal((await inbox(base, buyer.token)).some((row) => row.id === threadId), true);

  const guest = await fetch(`${base}/api/offers/${offer.id}`, { method: 'DELETE' });
  assert.equal(guest.status, 401);
  const strangerRes = await fetch(`${base}/api/offers/${offer.id}`, {
    method: 'DELETE',
    headers: authHeaders(stranger.token),
  });
  assert.equal(strangerRes.status, 403);
  const missing = await fetch(`${base}/api/offers/missing-offer`, { method: 'DELETE', headers: buyerAuth });
  assert.equal(missing.status, 404);

  const hidden = await fetch(`${base}/api/offers/${offer.id}`, { method: 'DELETE', headers: buyerAuth });
  assert.equal(hidden.status, 200);
  assert.equal((await mine(buyer.token)).some((o) => o.id === offer.id), false);
  assert.equal((await listingOffers(buyer.token)).some((o) => o.id === offer.id), false);
  const sellerStill = (await incoming(seller.token)).find((o) => o.id === offer.id);
  assert.equal(sellerStill.status, 'pending');
  assert.equal(sellerStill.amount, 2125);
  assert.equal((await inbox(base, seller.token)).some((row) => row.id === threadId), true);
  assert.equal((await inbox(base, buyer.token)).some((row) => row.id === threadId), true);

  const sellerHides = await fetch(`${base}/api/offers/${offer.id}`, { method: 'DELETE', headers: sellerAuth });
  assert.equal(sellerHides.status, 200);
  assert.equal((await incoming(seller.token)).length, 0);
  assert.equal((await listingOffers(seller.token)).some((o) => o.id === offer.id), false);
  assert.equal((await mine(buyer.token)).some((o) => o.id === offer.id), false);

  const again = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 2200, meetup: '賣家地點', message: '再問' }),
  });
  assert.equal(again.status, 201);
  const revived = (await again.json()).offer;
  assert.equal(revived.id, offer.id);
  assert.equal(revived.status, 'pending');
  assert.equal((await mine(buyer.token)).find((o) => o.id === offer.id)?.amount, 2200);
  assert.equal((await incoming(seller.token)).find((o) => o.id === offer.id)?.amount, 2200);

  const cancelled = await fetch(`${base}/api/offers/${offer.id}`, {
    method: 'PATCH',
    headers: buyerAuth,
    body: JSON.stringify({ action: 'cancel' }),
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).offer.status, 'cancelled');
  assert.equal((await mine(buyer.token)).find((o) => o.id === offer.id)?.status, 'cancelled');
  assert.equal((await incoming(seller.token)).find((o) => o.id === offer.id)?.status, 'cancelled');

  const hideCancelled = await fetch(`${base}/api/offers/${offer.id}`, { method: 'DELETE', headers: buyerAuth });
  assert.equal(hideCancelled.status, 200);
  assert.equal((await mine(buyer.token)).some((o) => o.id === offer.id), false);
  assert.equal((await incoming(seller.token)).find((o) => o.id === offer.id)?.status, 'cancelled');
  assert.equal((await inbox(base, seller.token)).some((row) => row.id === threadId), true);
});
