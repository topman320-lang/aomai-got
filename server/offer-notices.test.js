import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-offer-notices-'));
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

test('cancelled offer history leaves 訊息, and a real chat thread stays', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'offer-notices-test-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  const seller = await registerAndLogin(base, { name: '賣家', email: 'seller-notice@example.com' });
  const buyer = await registerAndLogin(base, { name: 'AppReview Demo', email: 'buyer-notice@example.com' });
  const other = await registerAndLogin(base, { name: '阿明', email: 'other-notice@example.com' });
  const sellerAuth = authHeaders(seller.token);
  const buyerAuth = authHeaders(buyer.token);

  const listingRes = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '二手風扇',
      price: 2200,
      category: '家電',
      location: '氹仔',
      condition: '良好',
      description: '可以議價。',
      handover: '面交',
      negotiable: true,
      photos: [PNG],
    }),
  });
  assert.equal(listingRes.status, 201, await listingRes.clone().text());
  const listing = (await listingRes.json()).listing;

  async function notices() {
    const res = await fetch(`${base}/api/notifications`, { headers: sellerAuth });
    assert.equal(res.status, 200);
    return res.json();
  }
  async function inbox(token) {
    const res = await fetch(`${base}/api/threads`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    return (await res.json()).threads;
  }

  const otherOffer = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: authHeaders(other.token),
    body: JSON.stringify({ amount: 80, meetup: '賣家地點', message: '' }),
  });
  assert.equal(otherOffer.status, 201, await otherOffer.clone().text());

  const offered = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 2000, meetup: '賣家地點', message: '' }),
  });
  assert.equal(offered.status, 201, await offered.clone().text());
  const first = await offered.json();
  const offerId = first.offer.id;
  const threadId = first.thread.id;
  assert.equal((await notices()).notices.some((n) => n.body === 'AppReview Demo 出價 MOP 2000'), true);

  const cancelled = await fetch(`${base}/api/offers/${offerId}`, {
    method: 'PATCH',
    headers: buyerAuth,
    body: JSON.stringify({ action: 'cancel' }),
  });
  assert.equal(cancelled.status, 200);
  let note = await notices();
  assert.equal(note.notices.some((n) => n.body.includes('取消了出價')), false);
  assert.equal(note.notices.some((n) => n.body.includes('AppReview Demo')), false);
  assert.equal(note.notices.some((n) => n.body === '阿明 出價 MOP 80'), true);
  assert.equal((await inbox(seller.token)).some((row) => row.id === threadId), true);
  assert.equal((await inbox(buyer.token)).some((row) => row.id === threadId), true);
  const thread = await fetch(`${base}/api/threads/${threadId}`, { headers: sellerAuth }).then((r) => r.json());
  assert.equal(thread.thread.messages.some((m) => m.text.includes('已取消出價 MOP 2000')), true);

  const chat = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ text: '星期六得唔得閒' }),
  });
  assert.equal(chat.status, 201, await chat.clone().text());

  const again = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 2125, meetup: '賣家地點', message: '' }),
  });
  assert.equal(again.status, 201, await again.clone().text());
  note = await notices();
  assert.equal(note.notices.some((n) => n.body === 'AppReview Demo 再出價 MOP 2125'), true);
  assert.equal(note.notices.some((n) => n.body.includes('取消了出價')), false);
  assert.equal(note.notices.some((n) => n.body === '星期六得唔得閒'), true);

  const cancelledAgain = await fetch(`${base}/api/offers/${offerId}`, {
    method: 'PATCH',
    headers: buyerAuth,
    body: JSON.stringify({ action: 'cancel' }),
  });
  assert.equal(cancelledAgain.status, 200);
  note = await notices();
  const bodies = note.notices.map((n) => n.body);
  assert.equal(bodies.some((body) => body.includes('取消了出價')), false);
  assert.equal(bodies.some((body) => body.includes('再出價')), false);
  assert.equal(bodies.some((body) => body.includes('AppReview Demo')), false);
  assert.equal(bodies.includes('星期六得唔得閒'), true);
  assert.equal(bodies.includes('阿明 出價 MOP 80'), true);
  assert.equal(note.unread, bodies.length);
  assert.equal((await inbox(seller.token)).some((row) => row.id === threadId), true);
  const after = (await inbox(seller.token)).find((row) => row.id === threadId);
  assert.equal(after.offer.status, 'cancelled');
});
