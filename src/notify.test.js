import assert from 'node:assert/strict';
import test from 'node:test';
import { alertsStorageKey, messageAlertNote, notifyStatusText } from './notify.js';

test('訊息提醒 copy is an on/off control in Traditional Chinese', () => {
  assert.equal(notifyStatusText(true), '開啟');
  assert.equal(notifyStatusText(false), '關閉');
  assert.match(messageAlertNote({ enabled: false }), /關閉/);
  assert.match(messageAlertNote({ enabled: false }), /未讀紅點仍然會顯示/);
  assert.match(messageAlertNote({ enabled: false, permission: 'denied' }), /系統未允許通知/);
  assert.match(messageAlertNote({ enabled: true, remotePush: true }), /App 完全關閉/);
  assert.match(messageAlertNote({ enabled: true, remotePush: true }), /未讀紅點會保持/);
  assert.match(messageAlertNote({ enabled: true, remotePush: false }), /Apple 推播未設定/);
  assert.doesNotMatch(messageAlertNote({ enabled: true, remotePush: true }), /已開啟本機通知/);
  assert.doesNotMatch(messageAlertNote({ enabled: false }), /尚未接入/);
});

test('the alert preference key is per user', () => {
  assert.equal(alertsStorageKey('u-1'), 'aomai-message-alerts:u-1');
  assert.notEqual(alertsStorageKey('u-1'), alertsStorageKey('u-2'));
});
