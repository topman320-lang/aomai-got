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

  const emptyRes = await fetch(`${base}/api/listings`);
  assert.equal(emptyRes.status, 200);
  const empty = await emptyRes.json();
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.listings, []);

  const demoLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@aomai.got', password: 'demo1234' }),
  });
  assert.equal(demoLogin.status, 401);

  async function register(name, email) {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: 'secret1' }),
    });
    assert.equal(res.status, 201);
    return res.json();
  }

  const seller = await register('賣家', 'seller-browse@example.com');
  const buyer = await register('買家', 'buyer-browse@example.com');
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };
  const auth = { Authorization: `Bearer ${seller.token}` };

  async function createListing(body) {
    const res = await fetch(`${base}/api/listings`, {
      method: 'POST',
      headers: sellerAuth,
      body: JSON.stringify({
        price: 40,
        category: '其他',
        location: '氹仔',
        condition: '良好',
        handover: '面交',
        photos: [PNG],
        ...body,
      }),
    });
    assert.equal(res.status, 201);
    return (await res.json()).listing;
  }

  const book = await createListing({
    title: '舊書三本 中文小說',
    description: '自用小說三本，有摺角。週末可面交。',
  });
  const fanListing = await createListing({
    title: '座檯小風扇',
    price: 50,
    description: '夏天用過，風力正常。',
  });
  const magazine = await createListing({
    title: '舊雜誌一疊',
    price: 20,
    description: '雜誌有摺痕。',
  });

  const offerRes = await fetch(`${base}/api/listings/${fanListing.id}/offers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 50, meetup: '賣家地點', message: '今晚可以。' }),
  });
  assert.equal(offerRes.status, 201);
  const offer = await offerRes.json();
  const acceptRes = await fetch(`${base}/api/offers/${offer.offer.id}`, {
    method: 'PATCH',
    headers: sellerAuth,
    body: JSON.stringify({ action: 'accept' }),
  });
  assert.equal(acceptRes.status, 200);

  for (const id of [fanListing.id, magazine.id]) {
    const soldRes = await fetch(`${base}/api/listings/${id}/sold`, {
      method: 'PATCH',
      headers: sellerAuth,
      body: JSON.stringify({ sold: true }),
    });
    assert.equal(soldRes.status, 200);
  }

  const homeRes = await fetch(`${base}/api/listings`);
  assert.equal(homeRes.status, 200);
  const home = await homeRes.json();
  assert.equal(home.listings.some((l) => l.sold), false);
  assert.equal(home.listings.some((l) => l.title === '座檯小風扇'), false);
  assert.equal(home.listings.some((l) => l.title === '舊雜誌一疊'), false);
  assert.ok(home.listings.some((l) => l.title === '舊書三本 中文小說'));
  assert.equal(book.sold, false);

  const searched = await fetch(`${base}/api/listings?q=${encodeURIComponent('風扇')}&category=${encodeURIComponent('其他')}`);
  const found = await searched.json();
  assert.deepEqual(found.listings, []);

  const anonMine = await fetch(`${base}/api/listings?mine=1`);
  assert.equal(anonMine.status, 401);

  const mineRes = await fetch(`${base}/api/listings?mine=1`, { headers: auth });
  assert.equal(mineRes.status, 200);
  const mine = await mineRes.json();
  assert.ok(mine.listings.some((l) => l.title === '舊雜誌一疊' && l.sold));
  assert.ok(mine.listings.some((l) => l.title === '舊書三本 中文小說' && !l.sold));
  assert.equal(mine.listings.some((l) => l.sellerId !== seller.user.id), false);

  const threads = await fetch(`${base}/api/threads`, {
    headers: { Authorization: `Bearer ${buyer.token}` },
  }).then((r) => r.json());
  const fan = threads.threads.map((thread) => thread.listing).find((l) => l?.title === '座檯小風扇');
  assert.ok(fan?.id);
  const detail = await fetch(`${base}/api/listings/${fan.id}`);
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.listing.sold, true);
  assert.equal(body.listing.title, '座檯小風扇');
});
