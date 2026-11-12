import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { privacyPage, supportPage, verifyResultPage, SUPPORT_EMAIL } from './public-pages.js';

const indexSource = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');

test('privacy page uses the real support mailbox', () => {
  const html = privacyPage();
  assert.equal(SUPPORT_EMAIL, 'mogot.app@gmail.com');
  assert.match(html, /mogot\.app@gmail\.com/);
  assert.match(html, /mailto:mogot\.app@gmail\.com/);
  assert.doesNotMatch(html, /privacy@aomai\.got/);
  assert.doesNotMatch(html, /示範/);
  assert.match(html, /href="\/support"/);
});

test('support page is a public contact path', () => {
  const html = supportPage();
  assert.match(html, /澳賣GOT 支援/);
  assert.match(html, /mailto:mogot\.app@gmail\.com/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /不在 App 內收款/);
  assert.doesNotMatch(html, /privacy@aomai\.got/);
  assert.doesNotMatch(html, /示範/);
});

test('failed verification page explains login and resend for website and app', () => {
  const html = verifyResultPage({ ok: false });
  assert.match(html, /<title>未能認證 · 澳賣GOT<\/title>/);
  assert.match(html, /<h1>未能認證<\/h1>/);
  assert.match(html, /認證連結無效或已過期。/);
  assert.match(html, /如果你已經完成認證，可以直接返回登入。/);
  assert.match(html, /如果未完成，網站同 App 都係咁做：/);
  assert.match(html, /撳下面「返回登入」。/);
  assert.match(html, /喺登入頁填寫註冊電郵，再撳「重寄認證信」。/);
  assert.match(html, /打開新寄出嘅認證信入面嘅連結。/);
  assert.match(html, /<a href="\/#\/login">返回登入<\/a>/);
  assert.doesNotMatch(html, /App 入面/);
  assert.doesNotMatch(html, /請喺 App/);
});

test('server exposes /privacy and /support', () => {
  assert.match(indexSource, /app\.get\('\/privacy'/);
  assert.match(indexSource, /privacyPage\(\)/);
  assert.match(indexSource, /app\.get\('\/support'/);
  assert.match(indexSource, /supportPage\(\)/);
  assert.match(indexSource, /\/support/);
  assert.doesNotMatch(indexSource, /privacy@aomai\.got/);
});
