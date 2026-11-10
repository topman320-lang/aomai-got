import assert from 'node:assert/strict';
import test from 'node:test';
import { messagesPane } from './messages-view.js';

test('訊息 empty state is only when there is nothing to show', () => {
  assert.equal(messagesPane({}), 'empty');
  assert.equal(messagesPane({ threadCount: 0, noticeCount: 0 }), 'empty');
  assert.equal(messagesPane({ threadCount: 1, noticeCount: 0 }), 'list');
  assert.equal(messagesPane({ threadCount: 0, noticeCount: 3 }), 'list');
  assert.equal(messagesPane({ threadCount: 2, noticeCount: 1 }), 'list');
});

test('a failed load with no threads still shows the error, not the empty line', () => {
  assert.equal(messagesPane({ failed: true }), 'error');
  assert.equal(messagesPane({ failed: true, threadCount: 0, noticeCount: 2 }), 'error');
  assert.equal(messagesPane({ failed: true, threadCount: 1, noticeCount: 0 }), 'list');
});
