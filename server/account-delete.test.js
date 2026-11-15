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

function uploadName(url) {
  const marker = '/uploads/';
  const at = String(url).lastIndexOf(marker);
  assert.ok(at >= 0, String(url));
  return String(url).slice(at + marker.length).split('?')[0];
}

test('confirmed deletion removes the account and its content without touching the other person', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-delete-'));
  const uploads = path.join(tmp, 'uploads');
  const port = 29000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: uploads,
        JWT_SECRET: 'account-delete-test-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const seller = await registerAndLogin(base, { name: '賣家甲', email: 'delete-seller@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家乙', email: 'delete-buyer@example.com' });
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };
  const buyerAuth = { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' };

  async function createListing(auth, title) {
    const res = await fetch(`${base}/api/listings`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title,
        price: 40,
        category: '家電',
        location: '氹仔',
        condition: '良好',
        description: `${title}的說明`,
        handover: '面交',
        negotiable: true,
        photos: [PNG],
      }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    return (await res.json()).listing;
  }

  const sellerListing = await createListing(sellerAuth, '賣家風扇');
  const buyerListing = await createListing(buyerAuth, '買家書本');
  const sellerPhoto = uploadName(sellerListing.photos[0]);
  const buyerPhoto = uploadName(buyerListing.photos[0]);
  assert.equal(fs.existsSync(path.join(uploads, sellerPhoto)), true);
  assert.equal(fs.existsSync(path.join(uploads, buyerPhoto)), true);

  const offer = await fetch(`${base}/api/listings/${sellerListing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 20, meetup: '賣家地點', message: '買家想議價' }),
  });
  assert.equal(offer.status, 201, await offer.clone().text());
  const threadId = (await offer.json()).thread.id;
  const reply = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({ text: '賣家回覆保留' }),
  });
  assert.equal(reply.status, 201, await reply.clone().text());
  const buyerNote = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ text: '買家訊息應刪除' }),
  });
  assert.equal(buyerNote.status, 201);

  const guest = await fetch(`${base}/api/me/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'secret1', confirm: true }),
  });
  assert.equal(guest.status, 401);

  const unconfirmed = await fetch(`${base}/api/me/delete`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ password: 'secret1', confirm: false }),
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal((await unconfirmed.json()).error, 'CONFIRM_REQUIRED');

  const wrong = await fetch(`${base}/api/me/delete`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ password: 'not-the-password', confirm: true }),
  });
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, 'BAD_PASSWORD');

  const stillThere = await fetch(`${base}/api/me`, { headers: buyerAuth });
  assert.equal(stillThere.status, 200);

  const deleted = await fetch(`${base}/api/me/delete`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ password: 'secret1', confirm: true }),
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());

  const oldSession = await fetch(`${base}/api/me`, { headers: buyerAuth });
  assert.equal(oldSession.status, 401);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'delete-buyer@example.com', password: 'secret1' }),
  });
  assert.equal(login.status, 401);

  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'aomai.json'), 'utf8'));
  assert.equal(stored.users.some((user) => user.email === 'delete-buyer@example.com'), false);
  assert.equal(stored.users.some((user) => user.email === 'delete-seller@example.com'), true);
  assert.equal(JSON.stringify(stored).includes('買家訊息應刪除'), false);
  assert.match(JSON.stringify(stored.messages), /賣家回覆保留/);
  const stub = stored.listings.find((row) => row.id === buyerListing.id);
  assert.equal(stub.removedAt > 0, true);
  assert.equal(stub.title, '已刪除的刊登');
  assert.deepEqual(stub.photos, []);
  const kept = stored.listings.find((row) => row.id === sellerListing.id);
  assert.equal(kept.title, '賣家風扇');
  assert.equal(kept.photos.length, 1);
  assert.equal(fs.existsSync(path.join(uploads, buyerPhoto)), false);
  assert.equal(fs.existsSync(path.join(uploads, sellerPhoto)), true);
  const bid = stored.offers.find((row) => row.fromId === buyer.user.id);
  assert.equal(bid.status, 'cancelled');

  const sellerStill = await fetch(`${base}/api/threads`, { headers: sellerAuth });
  assert.equal(sellerStill.status, 200);
  const sellerThreads = await sellerStill.json();
  assert.equal(sellerThreads.threads.length, 1);
  assert.equal(
    sellerThreads.threads[0].messages.some((message) => message.text === '賣家回覆保留'),
    true
  );
  assert.equal(
    sellerThreads.threads[0].messages.some((message) => message.text === '買家訊息應刪除'),
    false
  );

  const again = await registerAndLogin(base, { name: '新帳號', email: 'delete-buyer@example.com' });
  assert.notEqual(again.user.id, buyer.user.id);
  const oldTokenAgain = await fetch(`${base}/api/me`, { headers: buyerAuth });
  assert.equal(oldTokenAgain.status, 401);
});
