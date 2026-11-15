import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isStaffUser, listModerationReports, setReportStatus } from './moderation.js';
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
});
