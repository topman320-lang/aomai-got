import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import {
  RESEND_EMAIL_LIMIT,
  VERIFY_EN,
  VERIFY_SUBJECT,
  VERIFY_TTL_MS,
  VERIFY_ZH,
  assertCanSendMail,
  consumeEmailVerify,
  isEmailVerified,
  issueEmailVerify,
  mailTransportKind,
  RESET_CTA_EN,
  RESET_CTA_ZH,
  RESET_EN,
  RESET_SUBJECT,
  RESET_ZH,
  passwordResetMail,
  sendMail,
  verificationMail,
} from './mail.js';
import { testServerEnv } from './test-account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APPROVED_ZH = `歡迎加入澳賣GOT（MoGOT）！
多謝你註冊——澳門街坊二手，價錢可以傾。
請撳下面認證連結，啟用你嘅帳戶，之後就可以刊登同出價。`;

const APPROVED_EN = `Welcome to 澳賣GOT (MoGOT)!
Thanks for signing up — Macau neighborhood second-hand, where prices are negotiable.
Please tap the verification link below to activate your account, then you can list and make offers.`;

const APPROVED_SUBJECT = '請認證你嘅澳賣GOT帳戶 / Verify your 澳賣GOT account';

test('verification email is two stacked sections with the same link', () => {
  assert.equal(VERIFY_ZH, APPROVED_ZH);
  assert.equal(VERIFY_EN, APPROVED_EN);
  assert.equal(VERIFY_SUBJECT, APPROVED_SUBJECT);
  const url = 'https://aomai-got.onrender.com/auth/verify?token=abc';
  const mail = verificationMail({ url });
  assert.equal(mail.subject, APPROVED_SUBJECT);
  assert.equal(mail.text, `${APPROVED_ZH}\n${url}\n\n${APPROVED_EN}\n${url}`);
  const first = mail.text.indexOf(url);
  const englishAt = mail.text.indexOf(APPROVED_EN);
  const second = mail.text.indexOf(url, first + url.length);
  assert.ok(mail.text.startsWith(APPROVED_ZH));
  assert.ok(first > APPROVED_ZH.length);
  assert.ok(englishAt > first);
  assert.ok(second > englishAt);
  assert.equal(mail.text.indexOf(url, second + url.length), -1);
  const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, [url, url]);
  for (const line of APPROVED_ZH.split('\n')) assert.ok(mail.html.includes(line));
  for (const line of APPROVED_EN.split('\n')) assert.ok(mail.html.includes(line));
  const chineseEnd = mail.html.indexOf(APPROVED_ZH.split('\n')[2]);
  const englishStart = mail.html.indexOf(APPROVED_EN.split('\n')[0]);
  assert.ok(chineseEnd < mail.html.indexOf(`href="${url}"`));
  assert.ok(mail.html.indexOf(`href="${url}"`) < englishStart);
});

test('password reset email is bilingual with one clear link in each language', () => {
  const url = 'https://aomai-got.onrender.com/#/reset?token=abc.def';
  const mail = passwordResetMail({ url });
  assert.equal(mail.subject, RESET_SUBJECT);
  assert.match(mail.subject, /Reset your 澳賣GOT password/);
  assert.equal(mail.text, `${RESET_ZH}\n${RESET_CTA_ZH}：${url}\n\n${RESET_EN}\n${RESET_CTA_EN}: ${url}`);
  assert.ok(mail.text.includes('30'));
  assert.ok(mail.text.includes('ignore this email'));
  const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, [url, url, url, url]);
  assert.ok(mail.html.includes(`>${RESET_CTA_ZH}<`));
  assert.ok(mail.html.includes(`>${RESET_CTA_EN}<`));
  assert.ok(mail.html.includes('lang="zh-Hant"'));
  assert.ok(mail.html.includes('lang="en"'));
  const chineseAt = mail.html.indexOf(RESET_ZH.split('\n')[0]);
  const englishAt = mail.html.indexOf(RESET_EN.split('\n')[0]);
  assert.ok(chineseAt > -1 && englishAt > chineseAt);
});

test('missing emailVerified stays verified, and tokens are one-time', () => {
  assert.equal(isEmailVerified({ id: 'old' }), true);
  assert.equal(isEmailVerified({ emailVerified: true }), true);
  assert.equal(isEmailVerified({ emailVerified: false }), false);
  assert.equal(isEmailVerified(null), false);

  const user = { emailVerified: false };
  const token = issueEmailVerify(user, 1_000);
  assert.equal(user.emailVerified, false);
  assert.notEqual(user.emailVerify.hash, token);
  assert.equal(consumeEmailVerify(user, 'nope', 1_000).matched, false);
  assert.equal(consumeEmailVerify(user, token, 1_000 + VERIFY_TTL_MS + 1).ok, false);
  assert.equal(user.emailVerify, undefined);

  const again = issueEmailVerify(user, 5_000);
  assert.equal(consumeEmailVerify(user, again, 5_000).ok, true);
  assert.equal(user.emailVerified, true);
  assert.equal(user.emailVerify, undefined);
  assert.equal(consumeEmailVerify(user, again, 5_000).ok, false);
});

test('mail is skipped in tests and required in production', async () => {
  assert.equal(mailTransportKind({ RESEND_API_KEY: 're_x', SMTP_URL: 'smtp://localhost' }), 'resend');
  assert.equal(mailTransportKind({ SMTP_URL: 'smtp://localhost' }), 'smtp');
  assert.equal(mailTransportKind({}), '');
  assert.doesNotThrow(() => assertCanSendMail({ NODE_ENV: 'test' }));
  assert.doesNotThrow(() => assertCanSendMail({ NODE_ENV: 'development' }));
  assert.throws(() => assertCanSendMail({ NODE_ENV: 'production' }), /MAIL_NOT_CONFIGURED/);
  assert.doesNotThrow(() => assertCanSendMail({ NODE_ENV: 'production', SMTP_URL: 'smtp://localhost' }));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-mail-'));
  const file = path.join(dir, 'out.jsonl');
  const sent = await sendMail(
    { to: 'person@example.com', subject: 's', text: 't', html: '<p>t</p>' },
    {
      NODE_ENV: 'test',
      SMTP_URL: 'smtp://user:pass@example.com:587',
      RESEND_API_KEY: 're_should_not_send',
      MAIL_OUTBOX: file,
    }
  );
  assert.equal(sent.skipped, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).to, 'person@example.com');

  const dev = await sendMail(
    { to: 'person@example.com', subject: 's', text: 't', html: '<p>t</p>' },
    { NODE_ENV: 'development' }
  );
  assert.equal(dev.devLog, true);
});

function spawnApi(t, { port, dataDir, env }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      DATA_DIR: dataDir,
      UPLOADS_DIR: path.join(dataDir, 'uploads'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  t.after(() => child.kill());
  return {
    base: `http://127.0.0.1:${port}`,
    logs: () => logs,
  };
}

async function waitForHealth(base, logs) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
      last = `status ${res.status}`;
    } catch (err) {
      last = err?.message || String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`API did not start (${last})\n${logs()}`);
}

async function postJson(base, route, body) {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { res, data, text };
}

test('register cannot login until verify; resend rotates the link; old accounts stay in', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-email-verify-'));
  const dataDir = path.join(tmp, 'data');
  const outbox = path.join(tmp, 'mail.jsonl');
  fs.mkdirSync(dataDir, { recursive: true });
  const passwordHash = bcrypt.hashSync('secret1', 4);
  fs.writeFileSync(
    path.join(dataDir, 'aomai.json'),
    JSON.stringify({
      users: [
        {
          id: 'u-topman',
          name: 'Topman320',
          email: 'topman320@example.com',
          passwordHash,
          avatar: 'T',
          bio: '澳門街坊',
          verified: false,
          createdAt: 1,
        },
        {
          id: 'u-pending',
          name: '未認證',
          email: 'pending-old@example.com',
          passwordHash,
          emailVerified: false,
          avatar: '未',
          bio: '',
          createdAt: 1,
        },
      ],
    })
  );

  const port = 34000 + Math.floor(Math.random() * 8000);
  const api = spawnApi(t, {
    port,
    dataDir,
    env: testServerEnv({ JWT_SECRET: 'email-verify-test', MAIL_OUTBOX: outbox }),
  });
  await waitForHealth(api.base, api.logs);

  const guest = await fetch(`${api.base}/api/listings`);
  assert.equal(guest.status, 200);

  const grandfather = await postJson(api.base, '/api/auth/login', {
    email: 'topman320@example.com',
    password: 'secret1',
  });
  assert.equal(grandfather.res.status, 200, grandfather.text);
  assert.equal(typeof grandfather.data.token, 'string');

  const pendingWrong = await postJson(api.base, '/api/auth/login', {
    email: 'pending-old@example.com',
    password: 'nope',
  });
  assert.equal(pendingWrong.res.status, 401);
  assert.equal(pendingWrong.data.error, 'BAD_CREDENTIALS');

  const pending = await postJson(api.base, '/api/auth/login', {
    email: 'pending-old@example.com',
    password: 'secret1',
  });
  assert.equal(pending.res.status, 403);
  assert.equal(pending.data.error, 'EMAIL_NOT_VERIFIED');
  assert.equal(pending.data.message, '請先查收電郵完成認證');
  assert.equal(pending.data.token, undefined);

  const created = await postJson(api.base, '/api/auth/register', {
    name: '阿輝',
    email: 'new-user@example.com',
    password: 'secret1',
  });
  assert.equal(created.res.status, 201, created.text);
  assert.equal(created.data.token, undefined);
  assert.equal(created.data.emailVerified, false);
  assert.equal(created.data.message, '請先開啟認證電郵，完成後先可以登入');
  assert.equal(typeof created.data.verificationToken, 'string');

  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'aomai.json'), 'utf8'));
  const row = stored.users.find((user) => user.email === 'new-user@example.com');
  assert.equal(row.emailVerified, false);
  assert.notEqual(row.emailVerify.hash, created.data.verificationToken);
  assert.equal(Object.hasOwn(stored.users.find((user) => user.id === 'u-topman'), 'emailVerified'), false);

  const mailed = fs
    .readFileSync(outbox, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((message) => message.to === 'new-user@example.com');
  const link = `http://127.0.0.1:${port}/auth/verify?token=${encodeURIComponent(created.data.verificationToken)}`;
  assert.equal(mailed.subject, APPROVED_SUBJECT);
  assert.equal(mailed.text, `${APPROVED_ZH}\n${link}\n\n${APPROVED_EN}\n${link}`);

  const blocked = await postJson(api.base, '/api/auth/login', {
    email: 'new-user@example.com',
    password: 'secret1',
  });
  assert.equal(blocked.res.status, 403);
  assert.equal(blocked.data.message, '請先查收電郵完成認證');

  const badPage = await fetch(`${api.base}/auth/verify?token=nope`);
  assert.equal(badPage.status, 400);
  const badHtml = await badPage.text();
  assert.match(badHtml, /未能認證/);
  assert.ok(badHtml.includes('呢個認證連結無效或已過期。'));
  assert.ok(badHtml.includes('如果你已經完成認證，撳下面「返回登入」就可以。'));
  assert.ok(badHtml.includes('如果未完成，唔使淨係喺 App 操作；網站同 App 嘅登入頁都可以重寄：'));
  assert.ok(badHtml.includes('撳下面「返回登入」。'));
  assert.ok(badHtml.includes('喺登入頁填寫註冊電郵，再撳「重寄認證信」。'));
  assert.ok(badHtml.includes('打開新寄出嘅認證信，撳入面嘅連結。'));
  assert.match(badHtml, /<a href="\/#\/login">返回登入<\/a>/);
  assert.equal(badHtml.includes('App 入面'), false);

  const missing = await fetch(`${api.base}/auth/verify`);
  assert.equal(missing.status, 400);
  assert.match(await missing.text(), /重寄認證信/);

  const page = await fetch(`${api.base}/auth/verify?token=${encodeURIComponent(created.data.verificationToken)}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /電郵已認證/);
  assert.match(html, /澳賣GOT/);
  assert.match(html, /href="\/#\/login"/);

  const again = await fetch(`${api.base}/auth/verify?token=${encodeURIComponent(created.data.verificationToken)}`);
  assert.equal(again.status, 400);
  const usedHtml = await again.text();
  assert.ok(usedHtml.includes('喺登入頁填寫註冊電郵，再撳「重寄認證信」。'));
  assert.equal(usedHtml.includes('App 入面'), false);

  const session = await postJson(api.base, '/api/auth/login', {
    email: 'new-user@example.com',
    password: 'secret1',
  });
  assert.equal(session.res.status, 200, session.text);
  assert.equal(typeof session.data.token, 'string');

  const second = await postJson(api.base, '/api/auth/register', {
    name: '小美',
    email: 'second@example.com',
    password: 'secret1',
  });
  assert.equal(second.res.status, 201, second.text);
  const firstToken = second.data.verificationToken;
  const resent = await postJson(api.base, '/api/auth/resend-verification', { email: 'second@example.com' });
  assert.equal(resent.res.status, 200, resent.text);
  assert.equal(resent.data.message, '若此電郵已註冊且尚未認證，我們會再寄出認證信');
  assert.notEqual(resent.data.verificationToken, firstToken);
  const stale = await postJson(api.base, '/api/auth/verify', { token: firstToken });
  assert.equal(stale.res.status, 400);
  const fresh = await postJson(api.base, '/api/auth/verify', { token: resent.data.verificationToken });
  assert.equal(fresh.res.status, 200, fresh.text);
  const secondLogin = await postJson(api.base, '/api/auth/login', {
    email: 'second@example.com',
    password: 'secret1',
  });
  assert.equal(secondLogin.res.status, 200, secondLogin.text);

  const unknown = await postJson(api.base, '/api/auth/resend-verification', { email: 'nobody@example.com' });
  const already = await postJson(api.base, '/api/auth/resend-verification', { email: 'second@example.com' });
  assert.equal(unknown.res.status, 200);
  assert.equal(already.res.status, 200);
  assert.equal(unknown.data.message, already.data.message);
  assert.equal(unknown.data.verificationToken, undefined);
  assert.equal(already.data.verificationToken, undefined);

  const invalid = await postJson(api.base, '/api/auth/resend-verification', { email: 'not-an-email' });
  assert.equal(invalid.res.status, 400);

  for (let i = 0; i < RESEND_EMAIL_LIMIT; i += 1) {
    const ok = await postJson(api.base, '/api/auth/resend-verification', { email: 'flood@example.com' });
    assert.equal(ok.res.status, 200, ok.text);
  }
  const limited = await postJson(api.base, '/api/auth/resend-verification', { email: 'flood@example.com' });
  assert.equal(limited.res.status, 429);
  assert.equal(limited.data.error, 'RATE_LIMITED');

  const taken = await postJson(api.base, '/api/auth/register', {
    name: '阿輝',
    email: 'new-user@example.com',
    password: 'secret1',
  });
  assert.equal(taken.res.status, 409);
});

test('production register fails when mail is not configured', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-email-prod-'));
  const port = 42000 + Math.floor(Math.random() * 8000);
  const api = spawnApi(t, {
    port,
    dataDir: path.join(tmp, 'data'),
    env: {
      NODE_ENV: 'production',
      SMTP_URL: '',
      RESEND_API_KEY: '',
      MAIL_FROM: '',
      MAIL_OUTBOX: '',
      PUBLIC_BASE: '',
      RENDER_EXTERNAL_URL: '',
      JWT_SECRET: 'email-prod-test',
    },
  });
  await waitForHealth(api.base, api.logs);

  const guest = await fetch(`${api.base}/api/listings`);
  assert.equal(guest.status, 200);

  const created = await postJson(api.base, '/api/auth/register', {
    name: '阿輝',
    email: 'prod-user@example.com',
    password: 'secret1',
  });
  assert.equal(created.res.status, 503, created.text);
  assert.equal(created.data.error, 'MAIL_NOT_CONFIGURED');
  assert.equal(created.data.verificationToken, undefined);

  const login = await postJson(api.base, '/api/auth/login', {
    email: 'prod-user@example.com',
    password: 'secret1',
  });
  assert.equal(login.res.status, 401);

  const resend = await postJson(api.base, '/api/auth/resend-verification', { email: 'prod-user@example.com' });
  assert.equal(resend.res.status, 503);
  assert.equal(resend.data.error, 'MAIL_NOT_CONFIGURED');

  const forgot = await postJson(api.base, '/api/auth/forgot', { email: 'prod-user@example.com' });
  assert.equal(forgot.res.status, 200, forgot.text);
  assert.equal(forgot.data.ok, true);
  assert.equal(forgot.data.message, '若電郵已註冊，我們會寄出重設指引');
  assert.equal(forgot.data.token, undefined);
  assert.equal(forgot.data.resetToken, undefined);
});

function readOutbox(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

function resetTokenFromMail(message) {
  const match = String(message?.text || '').match(/#\/reset\?token=([^\s]+)/);
  assert.ok(match, message?.text);
  return decodeURIComponent(match[1]);
}

test('forgot with mail configured sends a reset link, and reset still works', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-reset-mail-'));
  const dataDir = path.join(tmp, 'data');
  const outbox = path.join(tmp, 'mail.jsonl');
  fs.mkdirSync(dataDir, { recursive: true });
  const passwordHash = bcrypt.hashSync('secret1', 4);
  fs.writeFileSync(
    path.join(dataDir, 'aomai.json'),
    JSON.stringify({
      users: [
        {
          id: 'u-reset',
          name: '重設',
          email: 'reset-user@example.com',
          passwordHash,
          avatar: '重',
          bio: '',
          createdAt: 1,
        },
      ],
    })
  );

  const port = 46000 + Math.floor(Math.random() * 8000);
  const api = spawnApi(t, {
    port,
    dataDir,
    env: testServerEnv({
      JWT_SECRET: 'reset-mail-test',
      MAIL_OUTBOX: outbox,
      RESEND_API_KEY: 're_test_mock',
      MAIL_FROM: '澳賣GOT <noreply@aomai-got.onrender.com>',
    }),
  });
  await waitForHealth(api.base, api.logs);

  const forgot = await postJson(api.base, '/api/auth/forgot', { email: 'Reset-User@example.com' });
  assert.equal(forgot.res.status, 200, forgot.text);
  assert.equal(forgot.data.ok, true);
  assert.equal(forgot.data.message, '若電郵已註冊，我們會寄出重設指引');
  assert.equal(forgot.data.token, undefined);
  assert.equal(forgot.data.resetToken, undefined);
  assert.equal(JSON.stringify(forgot.data).includes('eyJ'), false);

  const mailed = readOutbox(outbox).find((message) => message.to === 'reset-user@example.com');
  assert.ok(mailed);
  assert.equal(mailed.subject, RESET_SUBJECT);
  const token = resetTokenFromMail(mailed);
  const link = `http://127.0.0.1:${port}/#/reset?token=${encodeURIComponent(token)}`;
  assert.equal(mailed.text, `${RESET_ZH}\n${RESET_CTA_ZH}：${link}\n\n${RESET_EN}\n${RESET_CTA_EN}: ${link}`);
  assert.ok(mailed.html.includes(`href="${link}"`));
  assert.ok(mailed.html.includes(RESET_CTA_ZH));

  const unknown = await postJson(api.base, '/api/auth/forgot', { email: 'nobody@example.com' });
  assert.equal(unknown.res.status, 200, unknown.text);
  assert.deepEqual(unknown.data, forgot.data);
  assert.equal(
    readOutbox(outbox).some((message) => message.to === 'nobody@example.com'),
    false
  );

  const invalid = await postJson(api.base, '/api/auth/forgot', { email: 'not-an-email' });
  assert.equal(invalid.res.status, 400);

  const reset = await postJson(api.base, '/api/auth/reset', { token, password: 'newpass1' });
  assert.equal(reset.res.status, 200, reset.text);
  assert.equal(reset.data.message, '密碼已更新，請重新登入');

  const oldLogin = await postJson(api.base, '/api/auth/login', {
    email: 'reset-user@example.com',
    password: 'secret1',
  });
  assert.equal(oldLogin.res.status, 401);

  const session = await postJson(api.base, '/api/auth/login', {
    email: 'reset-user@example.com',
    password: 'newpass1',
  });
  assert.equal(session.res.status, 200, session.text);
  assert.equal(typeof session.data.token, 'string');

  const reused = await postJson(api.base, '/api/auth/reset', { token, password: 'another1' });
  assert.equal(reused.res.status, 400);
  assert.equal(reused.data.error, 'BAD_TOKEN');

  for (let i = 0; i < RESEND_EMAIL_LIMIT; i += 1) {
    const ok = await postJson(api.base, '/api/auth/forgot', { email: 'flood-reset@example.com' });
    assert.equal(ok.res.status, 200, ok.text);
    assert.deepEqual(ok.data, forgot.data);
  }
  const limited = await postJson(api.base, '/api/auth/forgot', { email: 'flood-reset@example.com' });
  assert.equal(limited.res.status, 429);
  assert.equal(limited.data.error, 'RATE_LIMITED');
});

test('forgot still answers ok when production mail is not configured', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-reset-nomail-'));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'aomai.json'),
    JSON.stringify({
      users: [
        {
          id: 'u-nomail',
          name: '無信',
          email: 'nomail@example.com',
          passwordHash: bcrypt.hashSync('secret1', 4),
          avatar: '無',
          bio: '',
          createdAt: 1,
        },
      ],
    })
  );
  const port = 47000 + Math.floor(Math.random() * 8000);
  const api = spawnApi(t, {
    port,
    dataDir,
    env: testServerEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'reset-nomail-test',
    }),
  });
  await waitForHealth(api.base, api.logs);

  const forgot = await postJson(api.base, '/api/auth/forgot', { email: 'nomail@example.com' });
  assert.equal(forgot.res.status, 200, forgot.text);
  assert.deepEqual(forgot.data, { ok: true, message: '若電郵已註冊，我們會寄出重設指引' });
  assert.match(api.logs(), /\[mail\] forgot send failed/);

  const unknown = await postJson(api.base, '/api/auth/forgot', { email: 'missing@example.com' });
  assert.equal(unknown.res.status, 200, unknown.text);
  assert.deepEqual(unknown.data, forgot.data);

  const login = await postJson(api.base, '/api/auth/login', {
    email: 'nomail@example.com',
    password: 'secret1',
  });
  assert.equal(login.res.status, 200, login.text);
});
