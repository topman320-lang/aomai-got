import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_SITE, listingPageUrl, listingSharePayload } from './share.js';

const PUBLIC = { protocol: 'https:', hostname: 'aomai-got.onrender.com', origin: 'https://aomai-got.onrender.com' };

test('listing links use the live site off localhost and Capacitor', () => {
  assert.equal(listingPageUrl('l-1', PUBLIC), `${PUBLIC_SITE}/#/detail/l-1`);
  assert.equal(
    listingPageUrl('l-1', { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:5173' }),
    `${PUBLIC_SITE}/#/detail/l-1`
  );
  assert.equal(
    listingPageUrl('l-1', { protocol: 'capacitor:', hostname: 'localhost', origin: 'capacitor://localhost' }),
    `${PUBLIC_SITE}/#/detail/l-1`
  );
  assert.equal(
    listingPageUrl('a b', PUBLIC),
    `${PUBLIC_SITE}/#/detail/a%20b`
  );
});

test('share payload includes the title, MOP price, and listing link', () => {
  const payload = listingSharePayload(
    { id: 'l-9', title: '風扇', price: 1500, negotiable: true },
    PUBLIC
  );
  assert.equal(payload.title, '風扇');
  assert.match(payload.preview, /風扇/);
  assert.match(payload.preview, /MOP/);
  assert.match(payload.preview, /1,?500/);
  assert.match(payload.preview, /可議/);
  assert.equal(payload.url, `${PUBLIC_SITE}/#/detail/l-9`);
  assert.ok(payload.text.endsWith(payload.url));
  const sold = listingSharePayload({ id: 'l-2', title: '燈', price: 40, sold: true }, PUBLIC);
  assert.match(sold.preview, /已售/);
});
