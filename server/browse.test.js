import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-browse-'));
const port = 21000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;

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

test('sold listings stay off the public feed and remain on mine and detail', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: path.join(tmp, 'data'),
      UPLOADS_DIR: path.join(tmp, 'uploads'),
      JWT_SECRET: 'browse-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  const homeRes = await fetch(`${base}/api/listings`);
  assert.equal(homeRes.status, 200);
  const home = await homeRes.json();
  assert.equal(home.listings.some((l) => l.sold), false);
  assert.equal(home.listings.some((l) => l.title === '座檯小風扇'), false);
  assert.equal(home.listings.some((l) => l.title === '舊雜誌一疊'), false);
  assert.ok(home.listings.some((l) => l.title === '舊書三本 中文小說'));

  const searched = await fetch(`${base}/api/listings?q=${encodeURIComponent('風扇')}&category=${encodeURIComponent('其他')}`);
  const found = await searched.json();
  assert.deepEqual(found.listings, []);

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@aomai.got', password: 'demo1234' }),
  });
  const login = await loginRes.json();
  const auth = { Authorization: `Bearer ${login.token}` };

  const anonMine = await fetch(`${base}/api/listings?mine=1`);
  assert.equal(anonMine.status, 401);

  const mineRes = await fetch(`${base}/api/listings?mine=1`, { headers: auth });
  assert.equal(mineRes.status, 200);
  const mine = await mineRes.json();
  assert.ok(mine.listings.some((l) => l.title === '舊雜誌一疊' && l.sold));
  assert.ok(mine.listings.some((l) => l.title === '舊書三本 中文小說' && !l.sold));
  assert.equal(mine.listings.some((l) => l.sellerId !== login.user.id), false);

  const threads = await fetch(`${base}/api/threads`, { headers: auth }).then((r) => r.json());
  const fan = threads.threads.map((thread) => thread.listing).find((l) => l?.title === '座檯小風扇');
  assert.ok(fan?.id);
  const detail = await fetch(`${base}/api/listings/${fan.id}`);
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.listing.sold, true);
  assert.equal(body.listing.title, '座檯小風扇');
});
