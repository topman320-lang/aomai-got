import assert from 'node:assert/strict';
import test from 'node:test';
import { filterBrowseListings, pageWindow } from './paging.js';

test('public browse hides sold listings from search and categories', () => {
  const rows = [
    { id: 'open', title: '風扇', description: '還在', category: '家電', location: '氹仔', price: 50, sold: false, createdAt: 2 },
    { id: 'sold', title: '風扇已售', description: '已面交', category: '家電', location: '氹仔', price: 40, sold: true, createdAt: 3 },
    { id: 'other', title: '書', description: '小說', category: '書本', location: '澳門', price: 10, sold: false, createdAt: 1 },
  ];
  const home = filterBrowseListings(rows, {});
  assert.deepEqual(home.map((l) => l.id), ['open', 'other']);
  assert.deepEqual(filterBrowseListings(rows, { q: '風扇' }).map((l) => l.id), ['open']);
  assert.deepEqual(filterBrowseListings(rows, { category: '家電' }).map((l) => l.id), ['open']);
  const mine = filterBrowseListings(rows, { sellerId: 'me', includeSold: true });
  assert.deepEqual(mine.map((l) => l.id), []);
  const owned = filterBrowseListings(
    rows.map((l) => ({ ...l, sellerId: 'me' })),
    { sellerId: 'me', includeSold: true }
  );
  assert.deepEqual(owned.map((l) => l.id), ['sold', 'open', 'other']);
});

test('pageWindow keeps the full list when limit is omitted', () => {
  const rows = [1, 2, 3];
  const page = pageWindow(rows, {});
  assert.deepEqual(page.items, rows);
  assert.equal(page.hasMore, false);
  assert.equal(page.total, 3);
  assert.equal(page.nextOffset, 3);
});

test('pageWindow slices and reports the next offset', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];
  const first = pageWindow(rows, { limit: '2', offset: '0' });
  assert.deepEqual(first.items, ['a', 'b']);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 2);
  assert.equal(first.total, 5);
  const last = pageWindow(rows, { limit: 2, offset: 4 });
  assert.deepEqual(last.items, ['e']);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextOffset, 5);
  const capped = pageWindow(rows, { limit: 99 });
  assert.equal(capped.limit, 48);
  assert.equal(pageWindow(rows, { limit: 0 }).error, 'INVALID_LIMIT');
  assert.equal(pageWindow(rows, { limit: -3 }).error, 'INVALID_LIMIT');
});
