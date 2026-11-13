import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('./store.js', import.meta.url), 'utf8');

function renderRegisterSource() {
  const start = main.indexOf('const REGISTER_CONSENT_ERROR');
  const end = main.indexOf('function renderVerifySent()');
  assert.ok(start > 0 && end > start);
  return main.slice(start, end);
}

test('register form blocks submit until privacy and age 16 are accepted', () => {
  const form = renderRegisterSource();
  assert.match(form, /id="register-consent"/);
  assert.match(form, /aria-required="true"/);
  assert.match(form, /我已閱讀並同意<a class="consent-link" href="#\/privacy" data-go="privacy">隱私政策<\/a>，並確認本人已年滿 16 歲。/);
  assert.match(form, /id="register-submit" disabled/);
  assert.match(form, /請先同意隱私政策，並確認已年滿 16 歲/);
  assert.match(form, /if \(!agreed\)/);
  assert.match(form, /register\(name, email, password, true\)/);
  assert.doesNotMatch(form, /使用條款/);
  assert.match(store, /consent: consent === true/);
});

test('privacy link stays above the register checkbox hit target', () => {
  assert.match(css, /\.field label\.check-row\.consent-row \.check-text \{[^}]*z-index: 3;/s);
  assert.match(css, /\.consent-link \{[^}]*pointer-events: auto;/s);
  assert.match(css, /\.consent-link \{[^}]*text-decoration: underline;/s);
});
