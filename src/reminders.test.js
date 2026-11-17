import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  bargainRemindersToMark,
  bargainVisitEffect,
  countUnseenOfferReminders,
  messageVisitEffect,
  noticeIdsMarkedOnVisit,
  tabBadges,
  visibleUnreadNotices,
} from './reminders.js';

const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function fn(name, next) {
  const start = main.indexOf(`function ${name}`);
  const end = main.indexOf(`function ${next}`);
  assert.ok(start > 0 && end > start, name);
  return main.slice(start, end);
}

test('我的 has no reminder badge, and 訊息 adds notices to unread threads', () => {
  const both = tabBadges({ messages: 2, notices: 3, offers: 1 });
  assert.equal(both.me.count, 0);
  assert.equal(both.me.label, '');
  assert.equal(both.messages.count, 5);
  assert.equal(both.messages.label, '2 則未讀訊息，3 則新提醒');
  assert.equal(both.bargains.count, 1);
  assert.equal(both.bargains.label, '1 筆待看議價');

  assert.equal(tabBadges({ messages: 4, notices: 0 }).messages.label, '4 則未讀訊息');
  assert.equal(tabBadges({ messages: 0, notices: 2 }).messages.label, '2 則新提醒');
  assert.equal(tabBadges({ messages: 0, notices: 0 }).messages.count, 0);
  assert.equal(tabBadges({ notices: 9 }).me.count, 0);
});

test('訊息 lists every unread notice and marks only those after a successful load', () => {
  const notices = [
    { id: 'n1', read: false, body: '一' },
    { id: 'n2', read: false, body: '二' },
    { id: 'n3', read: true, body: '已讀' },
    { id: 'n4', read: false, kind: 'moderation', body: '刊登已被隱藏' },
    { id: 'n5', read: false, body: '五' },
  ];
  assert.deepEqual(
    visibleUnreadNotices(notices).map((row) => row.id),
    ['n1', 'n2', 'n4', 'n5']
  );
  assert.equal(visibleUnreadNotices(notices).length > 3, true);
  assert.deepEqual(noticeIdsMarkedOnVisit(notices, { loaded: false }), []);

  const threads = [{ id: 't1', unread: true }, { id: 't2', unread: false }];
  const opened = messageVisitEffect({ notices, threads, noticesLoaded: true, listed: true });
  assert.deepEqual(opened.noticeIds, ['n1', 'n2', 'n4', 'n5']);
  assert.deepEqual(opened.offerIds, []);
  assert.deepEqual(opened.threads, [
    { id: 't1', unread: true },
    { id: 't2', unread: false },
  ]);
  assert.deepEqual(messageVisitEffect({ notices, threads, noticesLoaded: false }).noticeIds, []);
  assert.deepEqual(messageVisitEffect({ notices, threads, noticesLoaded: true, listed: false }).noticeIds, []);
});

test('opening 議價 marks unseen reminders and leaves threads and notices alone', () => {
  const listings = [{ id: 'l1', sellerId: 'seller', sold: false }];
  const incoming = [
    { id: 'o1', listingId: 'l1', fromId: 'buyer', status: 'pending', updatedAt: 10 },
    { id: 'o2', listingId: 'l1', fromId: 'buyer2', status: 'pending', updatedAt: 11, seenUpdatedAt: 11 },
    { id: 'o3', listingId: 'l1', fromId: 'buyer3', status: 'accepted', updatedAt: 12 },
  ];
  const mine = [{ id: 'o4', listingId: 'l1', fromId: 'seller', status: 'pending', updatedAt: 13 }];
  const marks = bargainRemindersToMark({
    userId: 'seller',
    incoming,
    mine,
    listings,
    incomingLoaded: true,
    mineLoaded: true,
  });
  assert.deepEqual(marks, [{ id: 'o1', updatedAt: 10 }]);
  assert.equal(countUnseenOfferReminders({ userId: 'seller', incoming, mine, listings }), 1);

  incoming[0].updatedAt = 20;
  incoming[0].seenUpdatedAt = 10;
  assert.deepEqual(
    bargainRemindersToMark({ userId: 'seller', incoming, listings, incomingLoaded: true }).map((row) => row.id),
    ['o1']
  );
  assert.deepEqual(
    bargainRemindersToMark({ userId: 'seller', incoming, listings, incomingLoaded: false, mineLoaded: false }),
    []
  );

  const buyerMine = [{ id: 'o4', listingId: 'l1', fromId: 'buyer', status: 'countered', updatedAt: 13 }];
  const visit = bargainVisitEffect({
    userId: 'buyer',
    mine: buyerMine,
    listings,
    mineLoaded: true,
    incomingLoaded: false,
    notices: [{ id: 'n1', read: false }],
    threads: [{ id: 't1', unread: true }],
  });
  assert.deepEqual(visit.offers, [{ id: 'o4', updatedAt: 13 }]);
  assert.deepEqual(visit.noticeIds, []);
  assert.deepEqual(visit.notices, [{ id: 'n1', read: false }]);
  assert.deepEqual(visit.threads, [{ id: 't1', unread: true }]);
});

test('the tab bar and the two pages use the reminder helpers', () => {
  const tab = fn('tabbar', 'scamTipHtml');
  const paint = fn('paintTabBadges', 'skeletonThreads');
  const messages = fn('renderMessages', 'blobToDataUrl');
  const bargains = fn('renderBargainsTab', 'managedGrid');
  assert.match(tab, /tabBadges\(getBadges\(\)\)/);
  assert.doesNotMatch(tab, /badges\.notices/);
  assert.doesNotMatch(tab, /則新提醒/);
  assert.match(paint, /spec\.me\.count/);
  assert.doesNotMatch(paint, /badges\.notices/);
  assert.match(messages, /visibleUnreadNotices/);
  assert.match(messages, /noticeIdsMarkedOnVisit/);
  assert.match(messages, /markNoticesRead\(noticeIds\)/);
  assert.doesNotMatch(messages, /slice\(0,\s*3\)/);
  assert.doesNotMatch(messages, /markOffersSeen/);
  assert.match(bargains, /bargainRemindersToMark/);
  assert.match(bargains, /markOffersSeen\(marks\)/);
  assert.doesNotMatch(bargains, /markNoticesRead/);
  assert.doesNotMatch(bargains, /markThreadRead/);
  const me = fn('renderMe', 'renderProfile');
  assert.doesNotMatch(me, /新提醒/);
});
