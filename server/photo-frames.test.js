import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-photo-frames-'));
const port = 26000 + Math.floor(Math.random() * 20000);
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

test('listing photo framing is saved, kept when an older client omits it, and cleared when asked', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'photo-frames-test-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  const seller = await registerAndLogin(base, { name: '賣家', email: 'seller-frame@example.com' });
  const auth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };
  const body = {
    title: '雪櫃',
    price: 800,
    category: '家電',
    location: '氹仔',
    condition: '良好',
    description: '正面有少少花痕。',
    handover: '面交',
    negotiable: true,
  };

  const plain = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ...body, photos: [PNG] }),
  });
  assert.equal(plain.status, 201);
  const unframed = (await plain.json()).listing;
  assert.deepEqual(unframed.photoFrames, [null]);

  const framedRes = await fetch(`${base}/api/listings/${unframed.id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({
      ...body,
      photos: [unframed.photos[0]],
      photoFrames: [{ x: 12.24, y: 180, z: 1.256, note: 'ignore' }],
    }),
  });
  assert.equal(framedRes.status, 200);
  const framed = (await framedRes.json()).listing;
  assert.deepEqual(framed.photoFrames, [{ x: 12.2, y: 100, z: 1.26 }]);

  const home = await fetch(`${base}/api/listings`).then((r) => r.json());
  assert.deepEqual(home.listings.find((row) => row.id === framed.id).photoFrames, framed.photoFrames);

  const keptRes = await fetch(`${base}/api/listings/${framed.id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ ...body, photos: [framed.photos[0], PNG_TWO] }),
  });
  assert.equal(keptRes.status, 200);
  const kept = (await keptRes.json()).listing;
  assert.equal(kept.photos.length, 2);
  assert.deepEqual(kept.photoFrames, [{ x: 12.2, y: 100, z: 1.26 }, null]);

  const swapped = await fetch(`${base}/api/listings/${framed.id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ ...body, photos: [kept.photos[1], kept.photos[0]] }),
  });
  assert.equal(swapped.status, 200);
  const reordered = (await swapped.json()).listing;
  assert.deepEqual(reordered.photoFrames, [null, { x: 12.2, y: 100, z: 1.26 }]);

  const cleared = await fetch(`${base}/api/listings/${framed.id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({
      ...body,
      photos: reordered.photos,
      photoFrames: [null, { x: 50, y: 50, z: 1 }],
    }),
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await cleared.json()).listing.photoFrames, [null, null]);
});
