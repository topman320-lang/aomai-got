import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyMailResult, createReport } from './safety.js';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('a failed developer email still keeps the report and omits the address from the row', () => {
  const db = {
    users: [
      { id: 'u-reporter', name: '檢舉人', email: 'reporter-secret@example.com' },
      { id: 'u-author', name: '作者', email: 'author-secret@example.com' },
    ],
    listings: [{ id: 'l-1', sellerId: 'u-author', title: '可疑貨', description: '太便宜', price: 10 }],
    reports: [],
  };
  const created = createReport(db, {
    id: 'rep-1',
    reporter: db.users[0],
    targetType: 'listing',
    targetId: 'l-1',
    reason: 'scam',
    detail: '價錢不合理',
  });
  assert.equal(created.ok, true);
  applyMailResult(created.report, false);
  assert.equal(created.report.mailError, true);
  assert.equal(db.reports.length, 1);
  const stored = JSON.stringify(db.reports);
  assert.equal(stored.includes('reporter-secret@example.com'), false);
  assert.equal(stored.includes('author-secret@example.com'), false);
  assert.match(stored, /可疑貨/);
  assert.equal(created.report.reason, 'scam');
});

test('report and block notify the developer, hide content from the blocker, and leave the other person alone', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-safety-'));
  const port = 28000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const outbox = path.join(tmp, 'outbox.jsonl');
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'safety-test-secret',
        MAIL_OUTBOX: outbox,
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

  const seller = await registerAndLogin(base, { name: '賣家甲', email: 'seller-safety@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家乙', email: 'buyer-safety@example.com' });
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };
  const buyerAuth = { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' };

  const listed = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({
      title: '可疑風扇',
      price: 80,
      category: '家電',
      location: '氹仔',
      condition: '良好',
      description: '請面交，唔好預付。',
      handover: '面交',
      negotiable: true,
      photos: [
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ],
    }),
  });
  assert.equal(listed.status, 201, await listed.clone().text());
  const listing = (await listed.json()).listing;

  const buyerListing = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({
      title: '買家的書',
      price: 20,
      category: '書本',
      location: '中區',
      condition: '良好',
      description: '面交。',
      handover: '面交',
      negotiable: false,
      photos: [
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ],
    }),
  });
  assert.equal(buyerListing.status, 201);
  const buyerItem = (await buyerListing.json()).listing;

  const offer = await fetch(`${base}/api/listings/${listing.id}/offers`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ amount: 50, meetup: '賣家地點', message: '這句出價要被檢舉' }),
  });
  assert.equal(offer.status, 201, await offer.clone().text());
  const offerBody = await offer.json();

  const selfReport = await fetch(`${base}/api/reports`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({ targetType: 'listing', targetId: listing.id, reason: 'spam' }),
  });
  assert.equal(selfReport.status, 400);

  const reported = await fetch(`${base}/api/reports`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({
      targetType: 'listing',
      targetId: listing.id,
      reason: 'scam',
      detail: '描述同相片不符',
    }),
  });
  assert.equal(reported.status, 201, await reported.clone().text());

  const offerMessages = offerBody.thread.messages;
  const messageReport = await fetch(`${base}/api/reports`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify({
      targetType: 'message',
      targetId: offerMessages[offerMessages.length - 1].id,
      reason: 'harassment',
    }),
  });
  assert.equal(messageReport.status, 201, await messageReport.clone().text());

  const selfBlock = await fetch(`${base}/api/blocks`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ userId: buyer.user.id }),
  });
  assert.equal(selfBlock.status, 400);

  const blocked = await fetch(`${base}/api/blocks`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ userId: seller.user.id }),
  });
  assert.equal(blocked.status, 201, await blocked.clone().text());

  const buyerFeed = await fetch(`${base}/api/listings`, { headers: buyerAuth });
  const buyerRows = (await buyerFeed.json()).listings.map((row) => row.id);
  assert.equal(buyerRows.includes(listing.id), false);
  assert.equal(buyerRows.includes(buyerItem.id), true);

  const sellerFeed = await fetch(`${base}/api/listings`, { headers: sellerAuth });
  const sellerRows = (await sellerFeed.json()).listings.map((row) => row.id);
  assert.equal(sellerRows.includes(buyerItem.id), true);
  assert.equal(sellerRows.includes(listing.id), true);

  const buyerThreads = await fetch(`${base}/api/threads`, { headers: buyerAuth });
  assert.equal((await buyerThreads.json()).threads.length, 0);
  const sellerThreads = await fetch(`${base}/api/threads`, { headers: sellerAuth });
  assert.equal((await sellerThreads.json()).threads.length, 1);

  const hiddenDetail = await fetch(`${base}/api/listings/${listing.id}`, { headers: buyerAuth });
  assert.equal(hiddenDetail.status, 403);
  assert.equal((await hiddenDetail.json()).error, 'BLOCKED');

  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'aomai.json'), 'utf8'));
  assert.equal(stored.reports.length, 2);
  assert.equal(stored.blocks.length, 1);
  const dumped = JSON.stringify({ reports: stored.reports, blocks: stored.blocks });
  assert.equal(dumped.includes('seller-safety@example.com'), false);
  assert.equal(dumped.includes('buyer-safety@example.com'), false);
  assert.equal(stored.reports.some((row) => row.snapshot && row.snapshot.title === '可疑風扇'), true);

  const mail = fs
    .readFileSync(outbox, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const reportMail = mail.find((row) => row.subject === '澳賣GOT：新的內容檢舉');
  const blockMail = mail.find((row) => row.subject === '澳賣GOT：有街坊封鎖了另一位用戶');
  assert.equal(reportMail.to, 'mogot.app@gmail.com');
  assert.match(reportMail.text, /buyer-safety@example.com/);
  assert.match(reportMail.text, /可疑風扇/);
  assert.match(reportMail.text, /詐騙或不實內容/);
  assert.equal(blockMail.to, 'mogot.app@gmail.com');
  assert.match(blockMail.text, /買家乙/);
  assert.match(blockMail.text, /賣家甲/);

  const unblocked = await fetch(`${base}/api/blocks/${encodeURIComponent(seller.user.id)}`, {
    method: 'DELETE',
    headers: buyerAuth,
  });
  assert.equal(unblocked.status, 200);
  const restored = await fetch(`${base}/api/listings`, { headers: buyerAuth });
  const restoredIds = (await restored.json()).listings.map((row) => row.id);
  assert.equal(restoredIds.includes(listing.id), true);
  const restoredThreads = await fetch(`${base}/api/threads`, { headers: buyerAuth });
  assert.equal((await restoredThreads.json()).threads.length, 1);
});
