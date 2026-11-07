import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { privacyPage, supportPage, SUPPORT_EMAIL } from './public-pages.js';

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

test('server exposes /privacy and /support', () => {
  assert.match(indexSource, /app\.get\('\/privacy'/);
  assert.match(indexSource, /privacyPage\(\)/);
  assert.match(indexSource, /app\.get\('\/support'/);
  assert.match(indexSource, /supportPage\(\)/);
  assert.match(indexSource, /\/support/);
  assert.doesNotMatch(indexSource, /privacy@aomai\.got/);
});
