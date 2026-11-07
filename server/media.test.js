import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-media-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');

const {
  absolutePhotos,
  migrateListingCategories,
  normalizeStoredUploads,
  presentAvatar,
  publicBaseFromRequest,
  MAX_LISTING_PHOTOS,
  MAX_MESSAGE_PHOTOS,
  savePhotos,
  uploadPath,
  usablePublicBase,
} = await import('./db.js');

const GODZILLA = 'http://127.0.0.1:10000/uploads/img-aee50efe2689.jpg';
const AVATAR = 'http://127.0.0.1:10000/uploads/img-72effe327be9.jpg';
const PUBLIC = 'https://aomai-got.onrender.com';

function reqWith(headers, protocol = 'http') {
  return {
    protocol,
    get(name) {
      return headers[name] || '';
    },
  };
}

test('upload paths drop the Render bind host', () => {
  assert.equal(uploadPath(GODZILLA), '/uploads/img-aee50efe2689.jpg');
  assert.equal(uploadPath('/uploads/img-aee50efe2689.jpg?v=1'), '/uploads/img-aee50efe2689.jpg');
  assert.equal(uploadPath('http://127.0.0.1:10000/uploads/../secret.jpg'), '');
  assert.equal(uploadPath('https://cdn.example/photo.jpg'), '');
  assert.equal(usablePublicBase('http://127.0.0.1:10000'), '');
  assert.equal(usablePublicBase(`${PUBLIC}/`), PUBLIC);
});

test('public base follows the request, not 127.0.0.1:$PORT', () => {
  const loopback = reqWith({ host: '127.0.0.1:8787' });
  assert.equal(
    publicBaseFromRequest(loopback, { RENDER_EXTERNAL_URL: `${PUBLIC}/` }),
    PUBLIC
  );
  assert.equal(
    publicBaseFromRequest(loopback, { PUBLIC_BASE: 'http://127.0.0.1:10000' }),
    'http://127.0.0.1:8787'
  );
  assert.equal(
    publicBaseFromRequest(reqWith({ host: 'aomai-got.onrender.com', 'x-forwarded-proto': 'https' }), {}),
    PUBLIC
  );
});

test('listing photos and avatars are rewritten for the client', () => {
  assert.deepEqual(absolutePhotos([GODZILLA, '/uploads/keep.jpg'], PUBLIC), [
    `${PUBLIC}/uploads/img-aee50efe2689.jpg`,
    `${PUBLIC}/uploads/keep.jpg`,
  ]);
  assert.deepEqual(absolutePhotos([GODZILLA], 'http://127.0.0.1:8787'), [
    'http://127.0.0.1:8787/uploads/img-aee50efe2689.jpg',
  ]);
  assert.equal(absolutePhotos(['https://cdn.example/a.jpg'], PUBLIC)[0], 'https://cdn.example/a.jpg');
  assert.equal(presentAvatar(AVATAR, PUBLIC), `${PUBLIC}/uploads/img-72effe327be9.jpg`);
  assert.equal(presentAvatar('哥', PUBLIC), '哥');
});

test('stored localhost upload URLs are migrated to relative paths', () => {
  const db = {
    users: [{ avatar: AVATAR }, { avatar: '哥' }],
    listings: [{ id: 'l-2ec58cb09cc1', photos: [GODZILLA, '/uploads/ok.jpg'] }],
    messages: [{ id: 'm-1', photos: [GODZILLA] }],
  };
  assert.equal(normalizeStoredUploads(db), true);
  assert.equal(db.users[0].avatar, '/uploads/img-72effe327be9.jpg');
  assert.equal(db.users[1].avatar, '哥');
  assert.deepEqual(db.listings[0].photos, ['/uploads/img-aee50efe2689.jpg', '/uploads/ok.jpg']);
  assert.deepEqual(db.messages[0].photos, ['/uploads/img-aee50efe2689.jpg']);
  assert.equal(normalizeStoredUploads(db), false);
});

test('new uploads are stored as relative /uploads paths', () => {
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const saved = savePhotos([png, GODZILLA]);
  assert.equal(saved.length, 2);
  assert.match(saved[0], /^\/uploads\/img-[a-f0-9]+\.png$/);
  assert.equal(saved[1], '/uploads/img-aee50efe2689.jpg');
  assert.equal(fs.existsSync(path.join(process.env.UPLOADS_DIR, path.basename(saved[0]))), true);
  assert.equal(saved.some((p) => p.includes('127.0.0.1')), false);
});

test('savePhotos keeps a single photo and caps a batch at 10', () => {
  assert.equal(MAX_LISTING_PHOTOS, 10);
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal(savePhotos([png]).length, 1);
  assert.equal(savePhotos(['', png, '']).length, 1);
  assert.equal(savePhotos(Array.from({ length: MAX_LISTING_PHOTOS }, () => png)).length, 10);
  assert.equal(savePhotos(Array.from({ length: MAX_LISTING_PHOTOS + 2 }, () => png)).length, 10);
  assert.equal(savePhotos(['', ...Array.from({ length: 12 }, () => png)]).length, 10);
});

test('removed category 潮流 is stored as 服飾', () => {
  const db = { listings: [{ category: '潮流' }, { category: '玩具' }, { category: '服飾' }] };
  assert.equal(migrateListingCategories(db), true);
  assert.deepEqual(
    db.listings.map((l) => l.category),
    ['服飾', '玩具', '服飾']
  );
  assert.equal(migrateListingCategories(db), false);
});

test('savePhotos caps chat images at 4 when asked', () => {
  assert.equal(MAX_MESSAGE_PHOTOS, 4);
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal(savePhotos([png], MAX_MESSAGE_PHOTOS).length, 1);
  assert.equal(savePhotos(Array.from({ length: 6 }, () => png), MAX_MESSAGE_PHOTOS).length, 4);
});
