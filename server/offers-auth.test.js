import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-offers-auth-'));
const port = 23000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;

const SECRET_A = '甲的私訊只給賣家';
const SECRET_B = '乙的私訊只給賣家';
const MEET_A = '甲的見面點';
const MEET_B = '乙的見面點';

async function waitForHealth() {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
      last = `status ${res.status}`;
    } catch (err) {
      last = err?.message || String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`API did not start (${last})`);
}

async function login(email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

async function register(name, email) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'secret1' }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test('listing offers are hidden from guests and other buyers', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: path.join(tmp, 'data'),
      UPLOADS_DIR: path.join(tmp, 'uploads'),
      JWT_SECRET: 'offers-auth-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  t.after(() => child.kill());

  try {
    await waitForHealth();
  } catch (err) {
    child.kill();
    throw new Error(`${err.message}\n${logs}`);
  }

  const seller = await login('demo@aomai.got', 'demo1234');
  const mineRes = await fetch(`${base}/api/listings?mine=1`, {
    headers: authHeaders(seller.token),
  });
  assert.equal(mineRes.status, 200);
  const mine = await mineRes.json();
  const listing = mine.listings.find((row) => row.title === '舊書三本 中文小說' && !row.sold);
  assert.ok(listing?.id);

  const guest = await fetch(`${base}/api/listings/${listing.id}/offers`);
  assert.equal(guest.status, 401);
  const guestBody = await guest.json();
  assert.equal(guestBody.error, 'UNAUTHORIZED');
  assert.equal(guestBody.offers, undefined);
  assert.equal(JSON.stringify(guestBody).includes('可以週末見嗎'), false);

  const bad = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    headers: { Authorization: 'Bearer not-a-token' },
  });
  assert.equal(bad.status, 401);

  const buyerA = await register('買家甲', 'buyer-a-offers@aomai.got');
  const buyerB = await register('買家乙', 'buyer-b-offers@aomai.got');
  const stranger = await register('路人丙', 'stranger-offers@aomai.got');

  const offerARes = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: authHeaders(buyerA.token),
    body: JSON.stringify({ amount: 33, meetup: MEET_A, message: SECRET_A }),
  });
  assert.equal(offerARes.status, 201);
  const offerA = await offerARes.json();
  assert.ok(offerA.thread?.id);
  assert.equal(offerA.offer.message, SECRET_A);

  const offerBRes = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: authHeaders(buyerB.token),
    body: JSON.stringify({ amount: 34, meetup: MEET_B, message: SECRET_B }),
  });
  assert.equal(offerBRes.status, 201);
  const offerB = await offerBRes.json();
  assert.ok(offerB.thread?.id);

  const sellerView = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    headers: authHeaders(seller.token),
  }).then((res) => res.json());
  const sellerText = JSON.stringify(sellerView);
  assert.ok(sellerView.offers.length >= 2);
  assert.equal(sellerText.includes(SECRET_A), true);
  assert.equal(sellerText.includes(SECRET_B), true);
  assert.equal(sellerText.includes(MEET_A), true);
  assert.equal(sellerText.includes(MEET_B), true);
  assert.equal(sellerText.includes(offerA.thread.id), true);
  assert.equal(sellerText.includes(offerB.thread.id), true);
  assert.equal(sellerText.includes('買家甲'), true);
  assert.equal(sellerText.includes('買家乙'), true);

  const viewARes = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    headers: authHeaders(buyerA.token),
  });
  assert.equal(viewARes.status, 200);
  const viewA = await viewARes.json();
  assert.equal(viewA.offers.length, 1);
  assert.equal(viewA.offers[0].fromId, buyerA.user.id);
  assert.equal(viewA.offers[0].message, SECRET_A);
  assert.equal(viewA.offers[0].meetup, MEET_A);
  assert.equal(viewA.offers[0].threadId, offerA.thread.id);
  assert.equal(viewA.offers[0].amount, 33);
  const textA = JSON.stringify(viewA);
  assert.equal(textA.includes(SECRET_B), false);
  assert.equal(textA.includes(MEET_B), false);
  assert.equal(textA.includes(offerB.thread.id), false);
  assert.equal(textA.includes('買家乙'), false);
  assert.equal(textA.includes('可以週末見嗎'), false);

  const viewB = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    headers: authHeaders(buyerB.token),
  }).then((res) => res.json());
  assert.equal(viewB.offers.length, 1);
  assert.equal(viewB.offers[0].fromId, buyerB.user.id);
  assert.equal(viewB.offers[0].message, SECRET_B);
  assert.equal(viewB.offers[0].threadId, offerB.thread.id);
  const textB = JSON.stringify(viewB);
  assert.equal(textB.includes(SECRET_A), false);
  assert.equal(textB.includes(MEET_A), false);
  assert.equal(textB.includes(offerA.thread.id), false);
  assert.equal(textB.includes('買家甲'), false);

  const strangerRes = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    headers: authHeaders(stranger.token),
  });
  assert.equal(strangerRes.status, 200);
  const strangerView = await strangerRes.json();
  assert.deepEqual(strangerView.offers, []);
  const strangerText = JSON.stringify(strangerView);
  assert.equal(strangerText.includes(SECRET_A), false);
  assert.equal(strangerText.includes(SECRET_B), false);
  assert.equal(strangerText.includes(offerA.thread.id), false);
  assert.equal(strangerText.includes(offerB.thread.id), false);

  const missing = await fetch(`${base}/api/listings/missing-listing/offers`, {
    headers: authHeaders(seller.token),
  });
  assert.equal(missing.status, 404);
});
