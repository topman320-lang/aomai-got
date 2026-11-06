import assert from 'node:assert/strict';
import test from 'node:test';
import { pageWindow } from './paging.js';

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
