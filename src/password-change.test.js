import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MISMATCH,
  PASSWORD_NEED_CONFIRM,
  PASSWORD_NEED_CURRENT,
  PASSWORD_NEED_NEW,
  PASSWORD_SAME,
  PASSWORD_TOO_SHORT,
  PASSWORD_UPDATED,
  PASSWORD_WRONG_CURRENT,
  firstPasswordChangeError,
  passwordChangeErrors,
  passwordChangeFieldFor,
} from './password-change.js';

test('password change rules match registration length and confirm-match', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 6);
  assert.equal(PASSWORD_TOO_SHORT, '密碼至少 6 位');
  assert.equal(PASSWORD_MISMATCH, '兩次密碼不一致');
  assert.equal(PASSWORD_WRONG_CURRENT, '現時密碼不正確');
  assert.equal(PASSWORD_UPDATED, '密碼已更新');

  assert.deepEqual(passwordChangeErrors('', '', ''), {
    currentPassword: PASSWORD_NEED_CURRENT,
    newPassword: PASSWORD_NEED_NEW,
    confirmPassword: PASSWORD_NEED_CONFIRM,
  });
  assert.equal(firstPasswordChangeError('', 'abcdef', 'abcdef'), PASSWORD_NEED_CURRENT);
  assert.equal(firstPasswordChangeError('old-pass', 'abc', 'abc'), PASSWORD_TOO_SHORT);
  assert.equal(firstPasswordChangeError('old-pass', 'new-pass', 'other'), PASSWORD_MISMATCH);
  assert.equal(firstPasswordChangeError('old-pass', 'old-pass', 'old-pass'), PASSWORD_SAME);
  assert.equal(firstPasswordChangeError('old-pass', '     ', '     '), PASSWORD_TOO_SHORT);
  assert.equal(firstPasswordChangeError('old-pass', '      ', '      '), '');
  assert.equal(firstPasswordChangeError(12, 'new-pass', 'new-pass'), PASSWORD_NEED_CURRENT);
  assert.equal(firstPasswordChangeError('old-pass', 'new-pass', 'new-pass'), '');
  assert.deepEqual(passwordChangeErrors('old-pass', 'new-pass', 'new-pass'), {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
});

test('known password errors point at the field that should show them', () => {
  assert.equal(passwordChangeFieldFor(PASSWORD_WRONG_CURRENT, 'BAD_PASSWORD'), 'currentPassword');
  assert.equal(passwordChangeFieldFor('其他', 'BAD_PASSWORD'), 'currentPassword');
  assert.equal(passwordChangeFieldFor(PASSWORD_NEED_NEW), 'newPassword');
  assert.equal(passwordChangeFieldFor(PASSWORD_TOO_SHORT), 'newPassword');
  assert.equal(passwordChangeFieldFor(PASSWORD_SAME), 'newPassword');
  assert.equal(passwordChangeFieldFor(PASSWORD_MISMATCH), 'confirmPassword');
  assert.equal(passwordChangeFieldFor('伺服器錯誤'), '');
});

test('edit profile has the change-password section and forgot-password stays on its own screen', () => {
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const profile = main.slice(main.indexOf('function renderProfile'), main.indexOf('async function route'));
  assert.match(profile, /<h1>編輯個人資料<\/h1>/);
  assert.match(profile, /id="password-form"/);
  assert.match(profile, /修改密碼/);
  assert.match(profile, /現時密碼/);
  assert.match(profile, /新密碼/);
  assert.match(profile, /確認新密碼/);
  assert.match(profile, /更新後仍然保持登入。/);
  assert.match(profile, /autocomplete="current-password"/);
  assert.match(profile, /autocomplete="new-password"/);
  assert.equal(profile.includes('font-size'), false);

  const forgot = main.slice(main.indexOf('function renderForgot'), main.indexOf('function renderReset'));
  assert.match(forgot, /<h1>忘記密碼<\/h1>/);
  assert.match(forgot, /id="forgot-form"/);
  const reset = main.slice(main.indexOf('function renderReset'), main.indexOf('function renderHostedPage'));
  assert.match(reset, /<h1>重設密碼<\/h1>/);
  assert.match(reset, /id="reset-form"/);

  const api = fs.readFileSync(new URL('./api.js', import.meta.url), 'utf8');
  assert.match(api, /\/api\/me\/password/);
  assert.match(api, /\/api\/auth\/forgot/);
  assert.match(api, /\/api\/auth\/reset/);

  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(css, /\.password-form \.actionbar\s*\{[^}]*position:\s*static/);
  assert.match(css, /font-size:\s*16px !important/);
});
