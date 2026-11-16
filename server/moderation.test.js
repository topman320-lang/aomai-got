import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  banUser,
  hideListing,
  isStaffUser,
  listModerationBlocks,
  listModerationReports,
  setReportStatus,
} from './moderation.js';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('empty staff list denies everyone, and repeat counts ignore older reports', () => {
  assert.equal(isStaffUser({ id: 'u-1', name: '審核員' }, { MOD_STAFF: '' }), false);
  assert.equal(isStaffUser({ id: 'u-1', name: '審核員' }, {}), false);
  assert.equal(isStaffUser({ id: 'u-1', name: '審核員' }, { MOD_STAFF: 'u-1' }), true);
  assert.equal(isStaffUser({ id: 'u-1', name: '審核員' }, { MOD_STAFF: '審核員' }), true);
  assert.equal(isStaffUser({ id: 'u-2', name: '街坊' }, { MOD_STAFF: 'u-1' }), false);

  const now = Date.now();
  const db = {
    listings: [{ id: 'l-1', title: '風扇', sellerId: 'u-seller' }],
    blocks: [],
    reports: [
      { id: 'r1', reporterId: 'u-hot', reporterName: '投訴人', targetType: 'listing', targetId: 'l-1', reason: 'spam', detail: 'write hidden@example.com', createdAt: now - DAY, snapshot: { title: '風扇' } },
      { id: 'r2', reporterId: 'u-hot', reporterName: '投訴人', targetType: 'listing', targetId: 'l-1', reason: 'spam', detail: '', createdAt: now - 2 * DAY, snapshot: {} },
      { id: 'r3', reporterId: 'u-hot', reporterName: '投訴人', targetType: 'listing', targetId: 'l-1', reason: 'spam', detail: '', createdAt: now - 8 * DAY, snapshot: {} },
      { id: 'r4', reporterId: 'u-hot', reporterName: '投訴人', targetType: 'listing', targetId: 'l-1', reason: 'scam', detail: '', createdAt: now - 3 * DAY, status: 'malicious', snapshot: {} },
    ],
  };
  const inbox = listModerationReports(db, { status: 'inbox', now });
  assert.equal(inbox.reports.length, 3);
  assert.equal(inbox.reports.some((row) => row.status === 'malicious'), false);
  const sample = inbox.reports[0];
  assert.equal(sample.recentCount, 3);
  assert.equal(sample.totalCount, 4);
  assert.equal(sample.busy, true);
  assert.equal(sample.detail.includes('@'), false);
  assert.equal(JSON.stringify(inbox).includes('@'), false);

  const marked = setReportStatus(db, { reportId: 'r1', status: 'malicious', staffId: 'u-1', now });
  assert.equal(marked.ok, true);
  assert.equal(db.listings[0].title, '風扇');
  assert.deepEqual(db.blocks, []);
  const after = listModerationReports(db, { status: 'inbox', now });
  assert.equal(after.reports.some((row) => row.id === 'r1'), false);
  const malicious = listModerationReports(db, { status: 'malicious', now });
  assert.equal(malicious.reports.some((row) => row.id === 'r1'), true);
  const bad = setReportStatus(db, { reportId: 'r1', status: 'ban', staffId: 'u-1' });
  assert.equal(bad.ok, false);
});

test('only staff can list and triage reports, and triage does not hide the listing', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-mod-'));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'moderation-test-secret',
        MOD_STAFF: '審核員',
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

  const staff = await registerAndLogin(base, { name: '審核員', email: 'mod-staff@example.com' });
  const reporter = await registerAndLogin(base, { name: '投訴人', email: 'mod-reporter@example.com' });
  const seller = await registerAndLogin(base, { name: '賣家', email: 'mod-seller@example.com' });
  assert.equal(staff.user.staff, true);
  assert.equal(reporter.user.staff, false);
  const staffAuth = { Authorization: `Bearer ${staff.token}`, 'Content-Type': 'application/json' };
  const reporterAuth = { Authorization: `Bearer ${reporter.token}`, 'Content-Type': 'application/json' };
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };

  const guest = await fetch(`${base}/api/moderation/reports`);
  assert.equal(guest.status, 401);
  const stranger = await fetch(`${base}/api/moderation/reports`, { headers: reporterAuth });
  assert.equal(stranger.status, 403);

  const listingIds = [];
  for (const title of ['風扇', '書', '燈']) {
    const res = await fetch(`${base}/api/listings`, {
      method: 'POST',
      headers: sellerAuth,
      body: JSON.stringify({
        title,
        price: 30,
        category: '家電',
        location: '氹仔',
        condition: '良好',
        description: '面交',
        handover: '面交',
        negotiable: true,
        photos: [PNG],
      }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    listingIds.push((await res.json()).listing.id);
  }
  const reportIds = [];
  for (const listingId of listingIds) {
    const res = await fetch(`${base}/api/reports`, {
      method: 'POST',
      headers: reporterAuth,
      body: JSON.stringify({ targetType: 'listing', targetId: listingId, reason: 'spam', detail: '重複' }),
    });
    assert.equal(res.status, 201, await res.clone().text());
  }

  const inboxRes = await fetch(`${base}/api/moderation/reports`, { headers: staffAuth });
  assert.equal(inboxRes.status, 200, await inboxRes.clone().text());
  const inbox = await inboxRes.json();
  assert.equal(inbox.reports.length, 3);
  assert.equal(inbox.reports.every((row) => row.busy && row.recentCount === 3), true);
  assert.equal(JSON.stringify(inbox).includes('@'), false);
  reportIds.push(...inbox.reports.map((row) => row.id));

  const denied = await fetch(`${base}/api/moderation/reports/${reportIds[0]}`, {
    method: 'PATCH',
    headers: reporterAuth,
    body: JSON.stringify({ status: 'malicious' }),
  });
  assert.equal(denied.status, 403);

  const updated = await fetch(`${base}/api/moderation/reports/${reportIds[0]}`, {
    method: 'PATCH',
    headers: staffAuth,
    body: JSON.stringify({ status: 'malicious' }),
  });
  assert.equal(updated.status, 200, await updated.clone().text());
  const follow = await fetch(`${base}/api/moderation/reports/${reportIds[1]}`, {
    method: 'PATCH',
    headers: staffAuth,
    body: JSON.stringify({ status: 'follow' }),
  });
  assert.equal(follow.status, 200);
  const done = await fetch(`${base}/api/moderation/reports/${reportIds[2]}`, {
    method: 'PATCH',
    headers: staffAuth,
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(done.status, 200);

  const nextInbox = await fetch(`${base}/api/moderation/reports`, { headers: staffAuth });
  const nextRows = (await nextInbox.json()).reports.map((row) => row.id);
  assert.deepEqual(nextRows, [reportIds[1]]);
  const hidden = await fetch(`${base}/api/moderation/reports?status=malicious`, { headers: staffAuth });
  const hiddenRows = (await hidden.json()).reports.map((row) => row.id);
  assert.deepEqual(hiddenRows, [reportIds[0]]);

  const browse = await fetch(`${base}/api/listings`);
  const titles = (await browse.json()).listings.map((row) => row.title).sort();
  assert.deepEqual(titles, ['書', '燈', '風扇']);
  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'aomai.json'), 'utf8'));
  assert.equal(stored.blocks.length, 0);
  assert.equal(stored.listings.every((row) => !row.removedAt), true);
  assert.equal(stored.listings.every((row) => !row.staffHiddenAt), true);
  assert.equal(stored.users.every((row) => !row.bannedAt), true);
});

test('hiding a listing and banning an account are separate from report status and user blocks', () => {
  const now = Date.now();
  const db = {
    users: [
      { id: 'staff', name: '審核員' },
      { id: 'seller', name: '賣家', email: 'seller-secret@example.com' },
      { id: 'other-staff', name: '另一位審核員' },
    ],
    listings: [
      { id: 'l-1', title: '風扇', sellerId: 'seller' },
      { id: 'l-2', title: '書', sellerId: 'buyer' },
    ],
    blocks: [],
    reports: [
      {
        id: 'r1',
        reporterId: 'buyer',
        reporterName: '投訴人',
        targetType: 'listing',
        targetId: 'l-1',
        targetUserId: 'seller',
        targetName: '賣家',
        reason: 'spam',
        detail: 'write hidden@example.com',
        createdAt: now,
        status: 'open',
        snapshot: { title: '風扇' },
      },
    ],
  };
  const env = { MOD_STAFF: '審核員,另一位審核員' };
  const unconfirmed = hideListing(db, { listingId: 'l-1', staffId: 'staff', confirm: false, now });
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.error, 'CONFIRM_REQUIRED');
  assert.equal(db.listings[0].staffHiddenAt, undefined);

  const hidden = hideListing(db, { listingId: 'l-1', staffId: 'staff', confirm: true, now });
  assert.equal(hidden.ok, true);
  assert.equal(db.listings[0].staffHiddenAt, now);
  assert.equal(db.listings[0].removedAt, undefined);
  assert.equal(db.listings[1].staffHiddenAt, undefined);
  assert.equal(db.reports[0].status, 'open');
  assert.deepEqual(db.blocks, []);

  const inbox = listModerationReports(db, { status: 'inbox', now });
  assert.equal(inbox.reports[0].listingId, 'l-1');
  assert.equal(inbox.reports[0].accountId, 'seller');
  assert.equal(inbox.reports[0].listingHidden, true);
  assert.equal(inbox.reports[0].accountBanned, false);
  assert.equal(JSON.stringify(inbox).includes('@'), false);

  const missingConfirm = banUser(db, { userId: 'seller', staffId: 'staff', confirm: false, now, env });
  assert.equal(missingConfirm.ok, false);
  assert.equal(db.users[1].bannedAt, undefined);
  const self = banUser(db, { userId: 'staff', staffId: 'staff', confirm: true, now, env });
  assert.equal(self.ok, false);
  const otherStaff = banUser(db, { userId: 'other-staff', staffId: 'staff', confirm: true, now, env });
  assert.equal(otherStaff.ok, false);

  const banned = banUser(db, { userId: 'seller', staffId: 'staff', confirm: true, now, env });
  assert.equal(banned.ok, true);
  assert.equal(banned.user.email, undefined);
  assert.equal(db.users[1].bannedAt, now);
  assert.deepEqual(db.blocks, []);
  assert.equal(db.reports[0].status, 'open');
  const again = listModerationReports(db, { status: 'inbox', now });
  assert.equal(again.reports[0].accountBanned, true);
  assert.equal(JSON.stringify(again).includes('seller-secret@example.com'), false);

  db.blocks.push({
    id: 'blk-1',
    blockerId: 'buyer',
    blockerName: '投訴人',
    blockedId: 'seller',
    blockedName: '賣家',
    createdAt: now,
  });
  db.users.push({ id: 'buyer', name: '投訴人', email: 'buyer-secret@example.com' });
  const blockInbox = listModerationBlocks(db);
  assert.equal(blockInbox.blocks.length, 1);
  assert.equal(blockInbox.blocks[0].blockedId, 'seller');
  assert.equal(blockInbox.blocks[0].blockerId, 'buyer');
  assert.equal(blockInbox.blocks[0].blockedBanned, true);
  assert.equal(JSON.stringify(blockInbox).includes('@'), false);
});

test('staff can hide a reported listing, and ordinary users no longer see it', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-hide-'));
  const port = 31000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: path.join(tmp, 'data'),
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'hide-test-secret',
        MOD_STAFF: '審核員',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth(base);

  const staff = await registerAndLogin(base, { name: '審核員', email: 'hide-staff@example.com' });
  const reporter = await registerAndLogin(base, { name: '投訴人', email: 'hide-reporter@example.com' });
  const seller = await registerAndLogin(base, { name: '賣家', email: 'hide-seller@example.com' });
  const staffAuth = { Authorization: `Bearer ${staff.token}`, 'Content-Type': 'application/json' };
  const reporterAuth = { Authorization: `Bearer ${reporter.token}`, 'Content-Type': 'application/json' };
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };

  const listed = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify(listingBody('被檢舉風扇')),
  });
  assert.equal(listed.status, 201, await listed.clone().text());
  const listingId = (await listed.json()).listing.id;
  const kept = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify(listingBody('仍然可見')),
  });
  assert.equal(kept.status, 201);
  const keptId = (await kept.json()).listing.id;

  const reported = await fetch(`${base}/api/reports`, {
    method: 'POST',
    headers: reporterAuth,
    body: JSON.stringify({ targetType: 'listing', targetId: listingId, reason: 'spam', detail: '重複廣告' }),
  });
  assert.equal(reported.status, 201);

  const denied = await fetch(`${base}/api/moderation/listings/${listingId}/hide`, {
    method: 'POST',
    headers: reporterAuth,
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(denied.status, 403);
  const unconfirmed = await fetch(`${base}/api/moderation/listings/${listingId}/hide`, {
    method: 'POST',
    headers: staffAuth,
    body: JSON.stringify({}),
  });
  assert.equal(unconfirmed.status, 400);

  const before = await fetch(`${base}/api/listings`);
  const beforeIds = (await before.json()).listings.map((row) => row.id);
  assert.equal(beforeIds.includes(listingId), true);

  const hidden = await fetch(`${base}/api/moderation/listings/${listingId}/hide`, {
    method: 'POST',
    headers: staffAuth,
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(hidden.status, 200, await hidden.clone().text());

  const after = await fetch(`${base}/api/listings`);
  const afterIds = (await after.json()).listings.map((row) => row.id);
  assert.equal(afterIds.includes(listingId), false);
  assert.equal(afterIds.includes(keptId), true);
  const guestDetail = await fetch(`${base}/api/listings/${listingId}`);
  assert.equal(guestDetail.status, 404);
  const sellerDetail = await fetch(`${base}/api/listings/${listingId}`, { headers: sellerAuth });
  assert.equal(sellerDetail.status, 404);
  const staffDetail = await fetch(`${base}/api/listings/${listingId}`, { headers: staffAuth });
  assert.equal(staffDetail.status, 200, await staffDetail.clone().text());
  assert.equal((await staffDetail.json()).listing.staffHidden, true);

  const mine = await fetch(`${base}/api/listings?mine=1`, { headers: sellerAuth });
  assert.equal((await mine.json()).listings.some((row) => row.id === listingId), false);

  const inbox = await fetch(`${base}/api/moderation/reports`, { headers: staffAuth });
  const report = (await inbox.json()).reports.find((row) => row.listingId === listingId);
  assert.equal(report.status, 'open');
  assert.equal(report.listingHidden, true);
  assert.equal(report.accountId, seller.user.id);
  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'aomai.json'), 'utf8'));
  assert.equal(stored.blocks.length, 0);
  assert.equal(stored.listings.find((row) => row.id === listingId).staffHiddenAt > 0, true);
  assert.equal(stored.listings.find((row) => row.id === listingId).removedAt, undefined);
});

test('staff can platform-ban an account without turning it into a user block', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-ban-'));
  const port = 32000 + Math.floor(Math.random() * 10000);
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
        JWT_SECRET: 'ban-test-secret',
        MOD_STAFF: '審核員',
        MAIL_OUTBOX: outbox,
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth(base);

  const staff = await registerAndLogin(base, { name: '審核員', email: 'ban-staff@example.com' });
  const seller = await registerAndLogin(base, { name: '賣家', email: 'ban-seller@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家', email: 'ban-buyer@example.com' });
  const staffAuth = { Authorization: `Bearer ${staff.token}`, 'Content-Type': 'application/json' };
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };
  const buyerAuth = { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' };

  const listed = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify(listingBody('問題刊登')),
  });
  assert.equal(listed.status, 201, await listed.clone().text());
  const listingId = (await listed.json()).listing.id;
  const buyerListed = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify(listingBody('買家的書')),
  });
  assert.equal(buyerListed.status, 201);
  const buyerListingId = (await buyerListed.json()).listing.id;

  const stranger = await fetch(`${base}/api/moderation/users/${seller.user.id}/ban`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(stranger.status, 403);
  const unconfirmed = await fetch(`${base}/api/moderation/users/${seller.user.id}/ban`, {
    method: 'POST',
    headers: staffAuth,
    body: JSON.stringify({ confirm: false }),
  });
  assert.equal(unconfirmed.status, 400);
  const self = await fetch(`${base}/api/moderation/users/${staff.user.id}/ban`, {
    method: 'POST',
    headers: staffAuth,
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(self.status, 400);

  const profileBefore = await fetch(`${base}/api/users/${seller.user.id}`, { headers: buyerAuth });
  assert.equal(profileBefore.status, 200);

  const banned = await fetch(`${base}/api/moderation/users/${seller.user.id}/ban`, {
    method: 'POST',
    headers: staffAuth,
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(banned.status, 200, await banned.clone().text());
  const banBody = await banned.json();
  assert.equal(banBody.user.banned, true);
  assert.equal(JSON.stringify(banBody).includes('@'), false);

  const feed = await fetch(`${base}/api/listings`, { headers: buyerAuth });
  const titles = (await feed.json()).listings.map((row) => row.id);
  assert.equal(titles.includes(listingId), false);
  assert.equal(titles.includes(buyerListingId), true);
  const hiddenProfile = await fetch(`${base}/api/users/${seller.user.id}`, { headers: buyerAuth });
  assert.equal(hiddenProfile.status, 404);
  const staffProfile = await fetch(`${base}/api/users/${seller.user.id}`, { headers: staffAuth });
  assert.equal(staffProfile.status, 200, await staffProfile.clone().text());
  const staffBody = await staffProfile.json();
  assert.equal(staffBody.banned, true);
  assert.equal(JSON.stringify(staffBody).includes('ban-seller@example.com'), false);
  const staffListing = await fetch(`${base}/api/listings/${listingId}`, { headers: staffAuth });
  assert.equal(staffListing.status, 200);

  const still = await fetch(`${base}/api/me`, { headers: sellerAuth });
  assert.equal(still.status, 403);
  assert.equal((await still.json()).error, 'ACCOUNT_BANNED');
  const relogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ban-seller@example.com', password: 'secret1' }),
  });
  assert.equal(relogin.status, 403);
  assert.equal((await relogin.json()).error, 'ACCOUNT_BANNED');

  const buyerStill = await fetch(`${base}/api/me`, { headers: buyerAuth });
  assert.equal(buyerStill.status, 200);
  const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'aomai.json'), 'utf8'));
  assert.equal(stored.blocks.length, 0);
  assert.equal(stored.users.find((row) => row.id === seller.user.id).bannedAt > 0, true);
});

test('staff can review user blocks, while a block still only hides content from the blocker', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-block-staff-'));
  const port = 33000 + Math.floor(Math.random() * 10000);
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
        JWT_SECRET: 'block-staff-secret',
        MOD_STAFF: '審核員',
        MAIL_OUTBOX: outbox,
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await waitForHealth(base);

  const staff = await registerAndLogin(base, { name: '審核員', email: 'block-staff@example.com' });
  const seller = await registerAndLogin(base, { name: '賣家', email: 'block-seller@example.com' });
  const buyer = await registerAndLogin(base, { name: '買家', email: 'block-buyer@example.com' });
  const staffAuth = { Authorization: `Bearer ${staff.token}`, 'Content-Type': 'application/json' };
  const sellerAuth = { Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' };
  const buyerAuth = { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' };

  const listed = await fetch(`${base}/api/listings`, {
    method: 'POST',
    headers: sellerAuth,
    body: JSON.stringify(listingBody('只對封鎖者隱藏')),
  });
  assert.equal(listed.status, 201, await listed.clone().text());
  const listingId = (await listed.json()).listing.id;

  const blocked = await fetch(`${base}/api/blocks`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ userId: seller.user.id }),
  });
  assert.equal(blocked.status, 201, await blocked.clone().text());

  const buyerFeed = await fetch(`${base}/api/listings`, { headers: buyerAuth });
  assert.equal((await buyerFeed.json()).listings.some((row) => row.id === listingId), false);
  const guestFeed = await fetch(`${base}/api/listings`);
  assert.equal((await guestFeed.json()).listings.some((row) => row.id === listingId), true);
  const sellerProfile = await fetch(`${base}/api/users/${seller.user.id}`);
  assert.equal(sellerProfile.status, 200);

  const denied = await fetch(`${base}/api/moderation/blocks`, { headers: buyerAuth });
  assert.equal(denied.status, 403);
  const inbox = await fetch(`${base}/api/moderation/blocks`, { headers: staffAuth });
  assert.equal(inbox.status, 200, await inbox.clone().text());
  const body = await inbox.json();
  assert.equal(body.blocks.length, 1);
  assert.equal(body.blocks[0].blockerId, buyer.user.id);
  assert.equal(body.blocks[0].blockedId, seller.user.id);
  assert.equal(body.blocks[0].blockedBanned, false);
  assert.equal(JSON.stringify(body).includes('@'), false);

  const mail = fs.readFileSync(outbox, 'utf8');
  assert.match(mail, /封鎖/);

  const banned = await fetch(`${base}/api/moderation/users/${seller.user.id}/ban`, {
    method: 'POST',
    headers: staffAuth,
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(banned.status, 200, await banned.clone().text());
  const after = await fetch(`${base}/api/moderation/blocks`, { headers: staffAuth });
  assert.equal((await after.json()).blocks[0].blockedBanned, true);
  const publicFeed = await fetch(`${base}/api/listings`);
  assert.equal((await publicFeed.json()).listings.some((row) => row.id === listingId), false);
});

async function waitForHealth(base) {
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
  throw new Error(`server did not start: ${base}`);
}

function listingBody(title) {
  return {
    title,
    price: 30,
    category: '家電',
    location: '氹仔',
    condition: '良好',
    description: '面交',
    handover: '面交',
    negotiable: true,
    photos: [PNG],
  };
}
