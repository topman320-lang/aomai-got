import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiBase } from './api.js';

const PROD = 'https://aomai-got.onrender.com';
const DEV = 'http://127.0.0.1:8787';

test('local dev keeps the loopback API', () => {
  assert.equal(resolveApiBase({ prod: false, protocol: 'http:' }), DEV);
  assert.equal(resolveApiBase({ viteApiUrl: undefined, prod: false, protocol: 'http:' }), DEV);
  assert.equal(resolveApiBase({ viteApiUrl: '', prod: false, protocol: 'http:' }), DEV);
  assert.equal(resolveApiBase({ viteApiUrl: '   ', prod: false, protocol: 'http:' }), DEV);
});

test('production web keeps a relative API', () => {
  assert.equal(resolveApiBase({ prod: true, protocol: 'https:' }), '');
  assert.equal(resolveApiBase({ viteApiUrl: '', prod: true, protocol: 'https:' }), '');
  assert.equal(resolveApiBase({ viteApiUrl: undefined, prod: true, protocol: 'https:' }), '');
});

test('native WebView protocols call the public origin when VITE_API_URL is unset or empty', () => {
  for (const protocol of ['capacitor:', 'ionic:', 'file:', 'CAPACITOR:', 'capacitor']) {
    assert.equal(resolveApiBase({ prod: true, protocol }), PROD);
    assert.equal(resolveApiBase({ viteApiUrl: '', prod: true, protocol }), PROD);
    assert.equal(resolveApiBase({ viteApiUrl: undefined, prod: false, protocol }), PROD);
  }
});

test('a non-empty VITE_API_URL wins on the web and in the native shell', () => {
  assert.equal(
    resolveApiBase({ viteApiUrl: 'https://staging.example', prod: true, protocol: 'https:' }),
    'https://staging.example'
  );
  assert.equal(
    resolveApiBase({
      viteApiUrl: 'https://aomai-got.onrender.com/',
      prod: true,
      protocol: 'capacitor:',
    }),
    PROD
  );
  assert.equal(
    resolveApiBase({ viteApiUrl: 'http://127.0.0.1:8787/', prod: false, protocol: 'http:' }),
    DEV
  );
});
