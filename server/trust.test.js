import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backfillDeals,
  badgeCountsFor,
  lastActiveHint,
  priceHint,
  replyHint,
  reviewAccess,
  trustSummary,
} from './trust.js';

const MIN = 60 * 1000;

function emptyDb() {
  return { users: [], listings: [], offers: [], threads: [], messages: [], reviews: [] };
}

test('price hint uses peer prices and refuses appraisal language', () => {
  const db = emptyDb();
  db.listings.push(
    { category: '數碼', condition: '良好', price: 300 },
    { category: '數碼', condition: '良好', price: 500 },
    { category: '數碼', condition: '全新', price: 900 }
  );
  const peers = priceHint(db, '數碼', '良好');
  assert.equal(peers.basis, 'peers');
  assert.equal(peers.count, 2);
  assert.equal(peers.low, 300);
  assert.equal(peers.high, 500);
  assert.equal(peers.mid, 400);
  assert.match(peers.note, /不是估價或鑑定/);
  assert.doesNotMatch(peers.note, /擔保|官方鑑定|已驗證/);

  const guide = priceHint(emptyDb(), '美妝', '全新');
  assert.equal(guide.basis, 'guide');
  assert.equal(guide.count, 0);
  assert.equal(guide.mid, 60);
  assert.match(guide.note, /不是估價或鑑定/);
});

test('reply hint stays descriptive and last-active is relative', () => {
  const db = emptyDb();
  db.users.push({ id: 'me', lastActiveAt: Date.now() - 10 * MIN });
  db.threads.push({ id: 't1', buyerId: 'them', sellerId: 'me' });
  const t0 = Date.now() - 60 * MIN;
  db.messages.push(
    { threadId: 't1', fromId: 'them', createdAt: t0 },
    { threadId: 't1', fromId: 'me', createdAt: t0 + 8 * MIN },
    { threadId: 't1', fromId: 'them', createdAt: t0 + 20 * MIN },
    { threadId: 't1', fromId: 'me', createdAt: t0 + 26 * MIN }
  );
  assert.equal(replyHint('me', db), '通常很快回覆');
  assert.equal(replyHint('nobody', db), '尚無足夠回覆紀錄');
  assert.equal(lastActiveHint(Date.now()), '剛剛有活動');
  assert.equal(lastActiveHint(Date.now() - 10 * MIN), '10 分鐘前有活動');
  assert.equal(lastActiveHint(0), '尚無活動紀錄');
});

test('trust counts sold, bought, and active reviews only', () => {
  const db = emptyDb();
  db.users.push({ id: 'seller', name: '小美' }, { id: 'buyer', name: '阿輝' });
  db.listings.push(
    { id: 'sold', sellerId: 'seller', buyerId: 'buyer', sold: true },
    { id: 'open', sellerId: 'seller', sold: false },
    { id: 'bought-back', sellerId: 'buyer', buyerId: 'seller', sold: true }
  );
  db.reviews.push(
    { id: 'r1', listingId: 'sold', fromId: 'buyer', toId: 'seller', stars: 5, text: '準時', createdAt: 2 },
    { id: 'r2', listingId: 'sold', fromId: 'seller', toId: 'buyer', stars: 4, text: '順利', createdAt: 3 },
    { id: 'r3', listingId: 'open', fromId: 'buyer', toId: 'seller', stars: 1, text: '不應計算', createdAt: 4 }
  );
  const seller = trustSummary('seller', db, { recentLimit: 3 });
  assert.equal(seller.sold, 1);
  assert.equal(seller.bought, 1);
  assert.equal(seller.ratingCount, 1);
  assert.equal(seller.ratingAvg, 5);
  assert.equal(seller.recent[0].text, '準時');
  assert.equal(trustSummary('buyer', db).ratingAvg, 4);
});

test('badges count unread threads and offers that need a response', () => {
  const db = emptyDb();
  db.listings.push(
    { id: 'open', sellerId: 'seller', sold: false },
    { id: 'done', sellerId: 'seller', sold: true }
  );
  db.threads.push(
    { buyerId: 'buyer', sellerId: 'seller', buyerUnread: false, sellerUnread: true },
    { buyerId: 'buyer', sellerId: 'other', buyerUnread: true, sellerUnread: false }
  );
  db.offers.push(
    { listingId: 'open', fromId: 'buyer', status: 'pending' },
    { listingId: 'open', fromId: 'buyer2', status: 'countered' },
    { listingId: 'open', fromId: 'buyer3', status: 'accepted' },
    { listingId: 'done', fromId: 'buyer', status: 'pending' }
  );
  assert.deepEqual(badgeCountsFor(db, 'seller'), { messages: 1, offers: 1 });
  assert.deepEqual(badgeCountsFor(db, 'buyer'), { messages: 1, offers: 0 });
  assert.deepEqual(badgeCountsFor(db, 'buyer2'), { messages: 0, offers: 1 });
});

test('review access is only for the two people on a completed deal', () => {
  const db = emptyDb();
  db.users.push({ id: 'seller', name: '小美' }, { id: 'buyer', name: '阿輝' });
  const listing = { id: 'l1', sellerId: 'seller', buyerId: 'buyer', sold: true };
  db.listings.push(listing);
  assert.equal(reviewAccess(listing, db, 'buyer').canReview, true);
  assert.equal(reviewAccess(listing, db, 'seller').reviewRole, 'seller');
  assert.equal(reviewAccess(listing, db, 'stranger').canReview, false);
  db.reviews.push({ id: 'r', listingId: 'l1', fromId: 'buyer', toId: 'seller', stars: 5, text: '', createdAt: 1 });
  assert.equal(reviewAccess(listing, db, 'buyer').canReview, false);
  assert.equal(reviewAccess({ ...listing, sold: false, buyerId: '' }, db, 'seller').canReview, false);
});

test('backfill links a sold listing to the accepted buyer', () => {
  const db = emptyDb();
  db.listings.push({ id: 'l1', sellerId: 'seller', sold: true }, { id: 'l2', sellerId: 'seller', sold: false, buyerId: 'x' });
  db.offers.push({ listingId: 'l1', fromId: 'buyer', status: 'accepted', updatedAt: 5 });
  assert.equal(backfillDeals(db), true);
  assert.equal(db.listings[0].buyerId, 'buyer');
  assert.equal(db.listings[1].buyerId, undefined);
  assert.equal(backfillDeals(db), false);
});
