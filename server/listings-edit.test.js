import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-listing-edit-'));
const port = 24000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_TWO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

test('owner can update a published listing; other accounts cannot', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'listing-edit-test-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  async function register(name, email) {
    return registerAndLogin(base, { name, email });
  }

  const seller = await register('賣家', 'seller-edit@example.com');
  const other = await register('其他人', 'other-edit@example.com');
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };

  const createdRes = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '舊風扇',
      price: 80,
      category: '家電',
      location: '氹仔',
      condition: '良好',
      description: '夏天用過。',
      handover: '面交',
      negotiable: true,
      photos: [PNG],
    }),
  });
  assert.equal(createdRes.status, 201);
  const created = (await createdRes.json()).listing;
  assert.equal(created.negotiable, true);
  assert.equal(created.photos.length, 1);

  const guest = await fetch(`${base}/api/listings/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '被改走',
      price: 1,
      description: '不應該成功',
      photos: [PNG],
    }),
  });
  assert.equal(guest.status, 401);

  const stranger = await fetch(`${base}/api/listings/${created.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${other.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '被改走',
      price: 1,
      description: '不應該成功',
      negotiable: false,
      photos: [PNG],
    }),
  });
  assert.equal(stranger.status, 403);

  const missing = await fetch(`${base}/api/listings/missing-listing`, {
    method: 'PATCH',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '沒有這筆',
      price: 10,
      description: '不存在',
      photos: [PNG],
    }),
  });
  assert.equal(missing.status, 404);

  const emptyPhotos = await fetch(`${base}/api/listings/${created.id}`, {
    method: 'PATCH',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '沒有相片',
      price: 90,
      description: '應該被拒',
      photos: [],
    }),
  });
  assert.equal(emptyPhotos.status, 400);

  const unchanged = await fetch(`${base}/api/listings/${created.id}`).then((r) => r.json());
  assert.equal(unchanged.listing.title, '舊風扇');
  assert.equal(unchanged.listing.price, 80);
  assert.equal(unchanged.listing.negotiable, true);

  const updatedRes = await fetch(`${base}/api/listings/${created.id}`, {
    method: 'PATCH',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '座檯風扇 可議',
      price: 60,
      category: '家居',
      location: '中區',
      condition: '有使用痕跡',
      description: '風力正常，外殼有刮花。',
      handover: '自取',
      negotiable: false,
      photos: [created.photos[0], PNG_TWO],
    }),
  });
  assert.equal(updatedRes.status, 200);
  const updated = (await updatedRes.json()).listing;
  assert.equal(updated.id, created.id);
  assert.equal(updated.sellerId, seller.user.id);
  assert.equal(updated.title, '座檯風扇 可議');
  assert.equal(updated.price, 60);
  assert.equal(updated.category, '家居');
  assert.equal(updated.location, '中區');
  assert.equal(updated.condition, '有使用痕跡');
  assert.equal(updated.description, '風力正常，外殼有刮花。');
  assert.equal(updated.handover, '自取');
  assert.equal(updated.negotiable, false);
  assert.equal(updated.sold, false);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.photos.length, 2);
  assert.equal(updated.emoji, '🪑');

  const home = await fetch(`${base}/api/listings`).then((r) => r.json());
  const onFeed = home.listings.find((l) => l.id === created.id);
  assert.ok(onFeed);
  assert.equal(onFeed.negotiable, false);
  assert.equal(onFeed.title, '座檯風扇 可議');

  const soldRes = await fetch(`${base}/api/listings/${created.id}/sold`, {
    method: 'PATCH',
    headers: sellerAuth,
    body: JSON.stringify({ sold: true }),
  });
  assert.equal(soldRes.status, 200);

  const soldEdit = await fetch(`${base}/api/listings/${created.id}`, {
    method: 'PATCH',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '已售仍可改說明',
      price: 55,
      category: '家居',
      location: '中區',
      condition: '有使用痕跡',
      description: '已售，修正說明。',
      handover: '自取',
      negotiable: false,
      photos: updated.photos,
    }),
  });
  assert.equal(soldEdit.status, 200);
  const soldBody = (await soldEdit.json()).listing;
  assert.equal(soldBody.id, created.id);
  assert.equal(soldBody.sold, true);
  assert.equal(soldBody.title, '已售仍可改說明');
  assert.equal(soldBody.negotiable, false);
});
