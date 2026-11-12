import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerAndLogin, testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-password-change-'));
const dataDir = path.join(tmp, 'data');
const port = 24000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const OLD_PASSWORD = 'pw-OLD-9f3a';
const NEW_PASSWORD = 'pw-NEW-9f3a';
const OTHER_PASSWORD = 'pw-OTHER-9f3a';
const EMAIL = 'change-pw@example.com';

async function waitForHealth(logs) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`API did not start\n${logs()}`);
}

async function post(urlPath, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { res, text, data };
}

test('signed-in user can change password from the current password; forgot-password still answers', async (t) => {
  let logs = '';
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...testServerEnv({
        PORT: String(port),
        DATA_DIR: dataDir,
        UPLOADS_DIR: path.join(tmp, 'uploads'),
        JWT_SECRET: 'password-change-test-secret',
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  t.after(() => child.kill());
  await waitForHealth(() => logs);

  const session = await registerAndLogin(base, {
    name: '改密碼',
    email: EMAIL,
    password: OLD_PASSWORD,
  });
  const token = session.token;
  assert.equal(typeof token, 'string');

  const anonymous = await post('/api/me/password', {
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  assert.equal(anonymous.res.status, 401, anonymous.text);
  assert.equal(anonymous.text.includes(OLD_PASSWORD), false);
  assert.equal(anonymous.text.includes(NEW_PASSWORD), false);

  async function change(body, auth = token) {
    const result = await post('/api/me/password', body, auth);
    assert.equal(result.text.includes(OLD_PASSWORD), false, result.text);
    assert.equal(result.text.includes(NEW_PASSWORD), false, result.text);
    assert.equal(result.text.includes(OTHER_PASSWORD), false, result.text);
    assert.equal(result.text.includes('passwordHash'), false, result.text);
    return result;
  }

  const wrong = await change({
    currentPassword: OTHER_PASSWORD,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  assert.equal(wrong.res.status, 400, wrong.text);
  assert.equal(wrong.data.error, 'BAD_PASSWORD');
  assert.equal(wrong.data.message, '現時密碼不正確');

  const short = await change({
    currentPassword: OLD_PASSWORD,
    newPassword: 'abc',
    confirmPassword: 'abc',
  });
  assert.equal(short.res.status, 400, short.text);
  assert.equal(short.data.message, '密碼至少 6 位');

  const mismatch = await change({
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
    confirmPassword: OTHER_PASSWORD,
  });
  assert.equal(mismatch.res.status, 400, mismatch.text);
  assert.equal(mismatch.data.message, '兩次密碼不一致');

  const missingConfirm = await change({
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
  });
  assert.equal(missingConfirm.res.status, 400, missingConfirm.text);
  assert.equal(missingConfirm.data.message, '請確認新密碼');

  const same = await change({
    currentPassword: OLD_PASSWORD,
    newPassword: OLD_PASSWORD,
    confirmPassword: OLD_PASSWORD,
  });
  assert.equal(same.res.status, 400, same.text);
  assert.equal(same.data.message, '新密碼不可與現時密碼相同');

  const notString = await change({
    currentPassword: 12345678,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  assert.equal(notString.res.status, 400, notString.text);
  assert.equal(notString.data.message, '請填寫現時密碼');

  const stillOld = await post('/api/auth/login', { email: EMAIL, password: OLD_PASSWORD });
  assert.equal(stillOld.res.status, 200, stillOld.text);

  const changed = await change({
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
  });
  assert.equal(changed.res.status, 200, changed.text);
  assert.deepEqual(changed.data, { ok: true, message: '密碼已更新' });
  assert.equal(changed.data.token, undefined);

  const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meText = await me.text();
  assert.equal(me.status, 200, meText);
  const meBody = JSON.parse(meText);
  assert.equal(meBody.user.email, EMAIL);
  assert.equal(meBody.user.passwordHash, undefined);
  assert.equal(meText.includes(NEW_PASSWORD), false);

  const renamed = await fetch(`${base}/api/me`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '改名街坊', password: NEW_PASSWORD }),
  });
  const renamedText = await renamed.text();
  assert.equal(renamed.status, 200, renamedText);
  assert.equal(JSON.parse(renamedText).user.name, '改名街坊');

  const oldLogin = await post('/api/auth/login', { email: EMAIL, password: OLD_PASSWORD });
  assert.equal(oldLogin.res.status, 401, oldLogin.text);
  assert.equal(oldLogin.data.message, '電郵或密碼不正確');

  const newLogin = await post('/api/auth/login', { email: EMAIL, password: NEW_PASSWORD });
  assert.equal(newLogin.res.status, 200, newLogin.text);
  assert.equal(typeof newLogin.data.token, 'string');
  assert.equal(newLogin.text.includes(NEW_PASSWORD), false);

  const forgot = await post('/api/auth/forgot', { email: EMAIL });
  assert.equal(forgot.res.status, 200, forgot.text);
  assert.deepEqual(forgot.data, { ok: true, message: '若電郵已註冊，我們會寄出重設指引' });

  const reset = await post('/api/auth/reset', { token: 'not-a-reset-token', password: 'another1' });
  assert.equal(reset.res.status, 400, reset.text);
  assert.equal(reset.data.message, '重設連結無效或已過期');

  const stored = fs.readFileSync(path.join(dataDir, 'aomai.json'), 'utf8');
  assert.equal(stored.includes(OLD_PASSWORD), false);
  assert.equal(stored.includes(NEW_PASSWORD), false);
  assert.equal(stored.includes(OTHER_PASSWORD), false);
  assert.match(stored, /"passwordHash":\s*"\$2[ab]\$/);

  const leaked = logs
    .split('\n')
    .filter((line) => line.includes(OLD_PASSWORD) || line.includes(NEW_PASSWORD) || line.includes(OTHER_PASSWORD));
  assert.deepEqual(leaked, []);
});
