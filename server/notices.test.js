import assert from 'node:assert/strict';
import test from 'node:test';
import { noticeVisible, noticesFor, unreadNotices } from './notices.js';

test('cancelled-offer notices stay out of 訊息 while other notices stay', () => {
  const offers = [
    { id: 'o-cancel', status: 'cancelled' },
    { id: 'o-open', status: 'pending' },
  ];
  assert.equal(
    noticeVisible({ kind: 'offer', refId: 'o-cancel', body: 'AppReview Demo 取消了出價' }, offers),
    false
  );
  assert.equal(noticeVisible({ kind: 'offer', refId: 'o-open', body: '阿明 出價 MOP 80' }, offers), true);
  assert.equal(noticeVisible({ kind: 'message', refId: 'm-1', body: '星期六得唔得閒' }, offers), true);
  assert.equal(noticeVisible({ kind: 'offer', refId: 'o-missing', body: '阿明 出價 MOP 10' }, offers), true);

  const db = {
    offers,
    notices: [
      { id: 'n-cancel', userId: 'seller', kind: 'offer', refId: 'o-cancel', title: '議價有更新', body: 'AppReview Demo 取消了出價', href: 'chat/t-1', createdAt: 3, readAt: null },
      { id: 'n-rebid', userId: 'seller', kind: 'offer', refId: 'o-cancel', title: '新出價', body: 'AppReview Demo 再出價 MOP 2125', href: 'chat/t-1', createdAt: 2, readAt: null },
      { id: 'n-chat', userId: 'seller', kind: 'message', refId: 'm-1', title: '新訊息', body: '星期六得唔得閒', href: 'chat/t-1', createdAt: 4, readAt: null },
      { id: 'n-open', userId: 'seller', kind: 'offer', refId: 'o-open', title: '新出價', body: '阿明 出價 MOP 80', href: 'chat/t-2', createdAt: 1, readAt: null },
      { id: 'n-other', userId: 'buyer', kind: 'offer', refId: 'o-cancel', title: '議價有更新', body: '不應出現', href: '', createdAt: 5, readAt: null },
    ],
  };
  const visible = noticesFor(db, 'seller').map((n) => n.id);
  assert.deepEqual(visible, ['n-chat', 'n-open']);
  assert.equal(unreadNotices(db, 'seller'), 2);
});
