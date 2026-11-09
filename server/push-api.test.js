import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-push-'));
const port = 24000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const TOKEN = 'ab'.repeat(32);
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

test('message alerts persist per user and device, and unread badges stay when alerts are off', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'push-api-test-secret',
        APNS_KEY_ID: '',
        APNS_TEAM_ID: '',
        APNS_KEY: '',
        APNS_BUNDLE_ID: '',
        APNS_ENV: '',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth();

  const seller = await registerAndLogin(base, { name: '賣家', email: 'seller-push@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家', email: 'buyer-push@example.com' });
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };
  const buyerAuth = { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' };

  const guest = await fetch(`${base}/api/push/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, installId: 'phone-a' }),
  });
  assert.equal(guest.status, 401);

  const bad = await fetch(`${base}/api/push/prefs`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ installId: 'phone-a' }),
  });
  assert.equal(bad.status, 400);

  const off = await fetch(`${base}/api/push/status?installId=phone-a`, { headers: buyerAuth });
  assert.equal(off.status, 200);
  const offBody = await off.json();
  assert.equal(offBody.enabled, false);
  assert.equal(offBody.remotePush, false);

  const turnedOn = await fetch(`${base}/api/push/prefs`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ enabled: true, installId: 'phone-a', platform: 'ios', token: TOKEN }),
  });
  assert.equal(turnedOn.status, 200);
  assert.equal((await turnedOn.json()).enabled, true);

  const on = await fetch(`${base}/api/push/status?installId=phone-a`, { headers: buyerAuth });
  const onBody = await on.json();
  assert.equal(onBody.enabled, true);
  assert.equal(onBody.devices, 1);
  assert.equal(onBody.remotePush, false);

  const other = await fetch(`${base}/api/push/status?installId=phone-a`, { headers: sellerAuth });
  assert.equal((await other.json()).enabled, false);

  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'aomai.json'), 'utf8'));
  const buyerRow = stored.devices.find((d) => d.installId === 'phone-a' && d.userId === buyer.user.id);
  assert.equal(buyerRow.alerts, true);
  assert.equal(buyerRow.token, TOKEN);
  assert.equal(buyerRow.platform, 'ios');

  const created = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '二手風扇',
      price: 80,
      category: '家電',
      location: '氹仔',
      condition: '良好',
      description: '可以私訊。',
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

  const turnedOff = await fetch(`${base}/api/push/prefs`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ enabled: false, installId: 'phone-a', platform: 'ios', token: TOKEN }),
  });
  assert.equal(turnedOff.status, 200);
  assert.equal((await turnedOff.json()).enabled, false);
  const again = await fetch(`${base}/api/push/status?installId=phone-a`, { headers: buyerAuth });
  assert.equal((await again.json()).enabled, false);

  const sent = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({ text: '今晚得唔得閒？' }),
  });
  assert.equal(sent.status, 201);

  const badges = await fetch(`${base}/api/badges`, { headers: buyerAuth });
  const badgeBody = await badges.json();
  assert.equal(badges.status, 200);
  assert.ok(badgeBody.messages >= 1);
  assert.ok(badgeBody.notices >= 1);

  const notices = await fetch(`${base}/api/notifications`, { headers: buyerAuth });
  const noticeBody = await notices.json();
  assert.ok(noticeBody.notices.some((item) => item.body.includes('今晚得唔得閒')));

  const after = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'aomai.json'), 'utf8'));
  const quiet = after.devices.find((d) => d.installId === 'phone-a' && d.userId === buyer.user.id);
  assert.equal(quiet.alerts, false);
});
