import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function fn(name, next) {
  const start = main.indexOf(`function ${name}`);
  const end = main.indexOf(`function ${next}`);
  assert.ok(start > 0 && end > start, name);
  return main.slice(start, end);
}

test('login shows the terms link before the sign-in button', () => {
  const login = fn('renderLogin', 'plausibleEmail');
  const termsAt = login.indexOf('data-go="terms?from=login"');
  const submitAt = login.indexOf('type="submit">登入');
  assert.ok(termsAt > 0 && submitAt > termsAt);
  assert.match(login, /登入前請先閱讀<a class="legal-link" href="#\/terms\?from=login"/);
});

test('profile deletion needs a second confirmation and a password', () => {
  const profile = fn('renderProfile', 'bindDeleteAccount');
  assert.match(profile, /id="delete-heading">刪除帳號/);
  assert.match(profile, /id="delete-account-open">刪除帳號/);
  const bind = fn('bindDeleteAccount', 'renderBlocked');
  assert.match(bind, /id="delete-account-form"/);
  assert.match(bind, /id="delete-password"/);
  assert.match(bind, /id="delete-account-confirm">確認刪除/);
  assert.match(bind, /只按「刪除帳號」不會刪除/);
  assert.match(bind, /deleteMyAccount\(password\)/);
  assert.match(bind, /go\('login'\)/);
});

test('listings, messages, reviews, and profiles can be reported or blocked', () => {
  assert.match(main, /reportLabel: '檢舉這件刊登'/);
  assert.match(main, /blockLabel = '封鎖這位街坊'/);
  assert.match(main, /data-report-type="message"/);
  assert.match(main, /reportLabel: '檢舉這位街坊'/);
  assert.match(main, /reportType: 'review'/);
  assert.match(main, /reportType: 'offer'/);
  assert.match(main, /case 'terms':/);
  assert.match(main, /case 'blocked':/);
  assert.match(main, /已封鎖的街坊/);
});
