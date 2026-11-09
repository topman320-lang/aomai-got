import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-messages-delete-'));
const port = 26000 + Math.floor(Math.random() * 20000);
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

test('a person can delete only their own messages, and both sides stop seeing them', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'messages-delete-test-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  const seller = await registerAndLogin(base, { name: '賣家', email: 'seller-delete@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家', email: 'buyer-delete@example.com' });
  const stranger = await registerAndLogin(base, { name: '路人', email: 'stranger-delete@example.com' });
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

  async function send(token, text) {
    const res = await fetch(`${base}/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ text }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    return (await res.json()).message;
  }

  const first = await send(buyer.token, '還在嗎？');
  const second = await send(buyer.token, '我想睇下實物');
  const reply = await send(seller.token, '在，週末可以');

  const guest = await fetch(`${base}/api/threads/${threadId}/messages/${second.id}`, { method: 'DELETE' });
  assert.equal(guest.status, 401);

  const strangerRes = await fetch(`${base}/api/threads/${threadId}/messages/${second.id}`, {
    method: 'DELETE',
    headers: authHeaders(stranger.token),
  });
  assert.equal(strangerRes.status, 403);

  const steal = await fetch(`${base}/api/threads/${threadId}/messages/${reply.id}`, {
    method: 'DELETE',
    headers: buyerAuth,
  });
  assert.equal(steal.status, 403);
  assert.equal((await steal.json()).message, '只能刪除自己的訊息');

  const missing = await fetch(`${base}/api/threads/${threadId}/messages/missing-message`, {
    method: 'DELETE',
    headers: buyerAuth,
  });
  assert.equal(missing.status, 404);

  const removed = await fetch(`${base}/api/threads/${threadId}/messages/${second.id}`, {
    method: 'DELETE',
    headers: buyerAuth,
  });
  assert.equal(removed.status, 200);
  const buyerThread = (await removed.json()).thread;
  const buyerTexts = buyerThread.messages.map((m) => m.text);
  assert.deepEqual(buyerTexts, ['還在嗎？', '在，週末可以']);
  assert.equal(buyerThread.preview, '在，週末可以');

  const sellerView = await fetch(`${base}/api/threads/${threadId}`, { headers: sellerAuth }).then((r) => r.json());
  assert.deepEqual(
    sellerView.thread.messages.map((m) => m.id),
    [first.id, reply.id]
  );
  assert.equal(sellerView.thread.messages.some((m) => m.text === '我想睇下實物'), false);

  const inbox = await fetch(`${base}/api/threads`, { headers: sellerAuth }).then((r) => r.json());
  assert.equal(inbox.threads[0].preview, '在，週末可以');

  const dropLast = await fetch(`${base}/api/threads/${threadId}/messages/${reply.id}`, {
    method: 'DELETE',
    headers: sellerAuth,
  });
  assert.equal(dropLast.status, 200);
  const after = (await dropLast.json()).thread;
  assert.deepEqual(
    after.messages.map((m) => m.text),
    ['還在嗎？']
  );
  assert.equal(after.preview, '還在嗎？');

  const dropOnly = await fetch(`${base}/api/threads/${threadId}/messages/${first.id}`, {
    method: 'DELETE',
    headers: buyerAuth,
  });
  assert.equal(dropOnly.status, 200);
  const empty = (await dropOnly.json()).thread;
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.preview, '');
});
