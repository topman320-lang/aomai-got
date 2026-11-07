import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-seed-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');

const { DATA_DIR, loadDb, persist } = await import('./db.js');
const { isSeedAccountEmail, listingDto, normalizeHandover, purgeSeedUsers, seedIfEmpty } = await import(
  './seed.js'
);

const ZEROS = {
  users: 0,
  listings: 0,
  offers: 0,
  threads: 0,
  messages: 0,
  reviews: 0,
  handoffs: 0,
  wants: 0,
  devices: 0,
  notices: 0,
};

test('seed account matcher ignores lookalike emails', () => {
  assert.equal(isSeedAccountEmail('demo@aomai.got'), true);
  assert.equal(isSeedAccountEmail('  Demo@Aomai.Got '), true);
  assert.equal(isSeedAccountEmail('xiaomei1@seed.aomai.got'), true);
  assert.equal(isSeedAccountEmail('Seller2@SEED.AOMAI.GOT'), true);
  assert.equal(isSeedAccountEmail('real@example.com'), false);
  assert.equal(isSeedAccountEmail('demo@aomai.got.example'), false);
  assert.equal(isSeedAccountEmail('notdemo@aomai.got'), false);
  assert.equal(isSeedAccountEmail('user@notseed.aomai.got'), false);
  assert.equal(isSeedAccountEmail('user@seed.aomai.got.evil'), false);
  assert.equal(isSeedAccountEmail('user@myseed.aomai.got'), false);
  assert.equal(isSeedAccountEmail(''), false);
  assert.equal(isSeedAccountEmail(null), false);
});

test('purge removes robot accounts, keeps humans, and a second run is a no-op', () => {
  seedIfEmpty();
  assert.deepEqual(loadDb().users, []);
  assert.deepEqual(loadDb().listings, []);
  assert.deepEqual(purgeSeedUsers(), ZEROS);

  const db = loadDb();
  db.users.push(
    { id: 'human', name: '真人', email: 'real@example.com', passwordHash: 'kept' },
    { id: 'demo', name: '阿輝', email: 'Demo@Aomai.Got', passwordHash: 'secret' },
    { id: 'bot', name: '小美', email: 'xiaomei1@seed.aomai.got', passwordHash: 'secret' },
    { id: 'lookalike', name: '不是機械人', email: 'demo@aomai.got.example', passwordHash: 'kept' },
    { id: 'other', name: '也不是', email: 'user@notseed.aomai.got', passwordHash: 'kept' }
  );
  db.listings.push(
    { id: 'l-human', sellerId: 'human', buyerId: 'demo', title: '真人商品', sold: true },
    { id: 'l-bot', sellerId: 'bot', title: '機械人商品', sold: false },
    { id: 'l-demo', sellerId: 'demo', title: '示範商品', sold: false }
  );
  db.offers.push(
    { id: 'o-human', listingId: 'l-human', fromId: 'lookalike', amount: 10 },
    { id: 'o-on-bot', listingId: 'l-bot', fromId: 'human', amount: 5 },
    { id: 'o-from-demo', listingId: 'l-human', fromId: 'demo', amount: 3 }
  );
  db.threads.push(
    { id: 't-real', listingId: 'l-human', buyerId: 'lookalike', sellerId: 'human' },
    { id: 't-bot', listingId: 'l-bot', buyerId: 'human', sellerId: 'bot' },
    { id: 't-demo', listingId: 'l-demo', buyerId: 'human', sellerId: 'demo' }
  );
  db.messages.push(
    { id: 'm-real', threadId: 't-real', fromId: 'human', text: '還在' },
    { id: 'm-bot', threadId: 't-bot', fromId: 'human', text: '想要' },
    { id: 'm-demo', threadId: 't-real', fromId: 'demo', text: '插話' }
  );
  db.reviews.push(
    { id: 'r-real', listingId: 'l-human', fromId: 'lookalike', toId: 'human', stars: 5 },
    { id: 'r-bot', listingId: 'l-bot', fromId: 'human', toId: 'bot', stars: 4 },
    { id: 'r-from-demo', listingId: 'l-human', fromId: 'demo', toId: 'human', stars: 5 }
  );
  db.handoffs.push(
    { id: 'h-real', offerId: 'o-human', listingId: 'l-human', proposedBy: 'human' },
    { id: 'h-bot', offerId: 'o-on-bot', listingId: 'l-bot', proposedBy: 'human' }
  );
  db.wants.push(
    { userId: 'human', listingId: 'l-human' },
    { userId: 'human', listingId: 'l-bot' },
    { userId: 'demo', listingId: 'l-human' }
  );
  db.devices.push(
    { userId: 'human', token: 'real-token' },
    { userId: 'demo', token: 'demo-token' },
    { userId: 'bot', token: 'bot-token' }
  );
  db.notices.push(
    { id: 'n-real', userId: 'human', refId: 'o-human', body: '真人通知' },
    { id: 'n-about-bot', userId: 'human', refId: 'o-on-bot', body: '關於機械人' },
    { id: 'n-demo', userId: 'demo', refId: 'l-human', body: '示範通知' },
    { id: 'n-msg', userId: 'human', refId: 'm-demo', body: '關於示範訊息' }
  );
  persist();

  const counts = purgeSeedUsers();
  assert.deepEqual(counts, {
    users: 2,
    listings: 2,
    offers: 2,
    threads: 2,
    messages: 2,
    reviews: 2,
    handoffs: 1,
    wants: 2,
    devices: 2,
    notices: 3,
  });

  const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'aomai.json'), 'utf8'));
  assert.deepEqual(
    saved.users.map((user) => user.email).sort(),
    ['demo@aomai.got.example', 'real@example.com', 'user@notseed.aomai.got']
  );
  assert.equal(saved.users.find((user) => user.id === 'human').passwordHash, 'kept');
  assert.deepEqual(saved.listings.map((listing) => listing.id), ['l-human']);
  assert.equal(saved.listings[0].sold, true);
  assert.equal(saved.listings[0].buyerId, undefined);
  assert.deepEqual(saved.offers.map((offer) => offer.id), ['o-human']);
  assert.deepEqual(saved.threads.map((thread) => thread.id), ['t-real']);
  assert.deepEqual(saved.messages.map((message) => message.id), ['m-real']);
  assert.deepEqual(saved.reviews.map((review) => review.id), ['r-real']);
  assert.deepEqual(saved.handoffs.map((handoff) => handoff.id), ['h-real']);
  assert.deepEqual(saved.wants, [{ userId: 'human', listingId: 'l-human' }]);
  assert.deepEqual(saved.devices, [{ userId: 'human', token: 'real-token' }]);
  assert.deepEqual(saved.notices.map((notice) => notice.id), ['n-real']);

  assert.deepEqual(purgeSeedUsers(), ZEROS);
  seedIfEmpty();
  assert.equal(loadDb().users.some((user) => isSeedAccountEmail(user.email)), false);
  assert.equal(loadDb().listings.length, 1);

  const before = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'aomai.json'), 'utf8'));
  const snapshot = {
    users: [
      { id: 'keep', email: 'person@example.com' },
      { id: 'bot', email: 'ada2@seed.aomai.got' },
    ],
    listings: [{ id: 'l-bot', sellerId: 'bot', title: '機械人' }],
    offers: [],
    threads: [],
    messages: [],
    reviews: [],
    handoffs: [],
    wants: [],
    devices: [],
    notices: [],
  };
  const snapshotCounts = purgeSeedUsers(snapshot);
  assert.equal(snapshotCounts.users, 1);
  assert.equal(snapshotCounts.listings, 1);
  assert.deepEqual(snapshot.users.map((user) => user.id), ['keep']);
  assert.deepEqual(snapshot.listings, []);
  const after = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'aomai.json'), 'utf8'));
  assert.deepEqual(after.users.map((user) => user.id), before.users.map((user) => user.id));
  assert.deepEqual(after.listings.map((listing) => listing.id), before.listings.map((listing) => listing.id));
});

test('listing helpers stay available without demo rows', () => {
  assert.equal(normalizeHandover('面交'), '面交');
  assert.equal(normalizeHandover('', '請自取'), '自取');
  assert.equal(normalizeHandover('warehouse'), '面交');
  const dto = listingDto(
    {
      id: 'l1',
      title: '椅',
      price: 10,
      negotiable: true,
      category: '家居',
      location: '氹仔',
      condition: '良好',
      description: '可自取',
      handover: '自取',
      sellerId: 'human',
      tone: '#fff',
      emoji: '🪑',
      photos: [],
      sold: false,
      createdAt: 1,
    },
    {
      users: [{ id: 'human', name: '真人', avatar: '真', bio: '', verified: false }],
      listings: [],
      offers: [],
      threads: [],
      messages: [],
      reviews: [],
    },
    ''
  );
  assert.equal(dto.sellerName, '真人');
  assert.equal(dto.handover, '自取');
  assert.equal(dto.sold, false);
});

test('login screen and server boot do not advertise a demo password', () => {
  const indexSource = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(indexSource, /purgeSeedUsers\(\)/);
  assert.match(indexSource, /seedIfEmpty\(\)/);
  assert.doesNotMatch(indexSource, /demo@aomai\.got/);
  assert.doesNotMatch(indexSource, /demo1234/);
  assert.doesNotMatch(mainSource, /demo@aomai\.got/);
  assert.doesNotMatch(mainSource, /demo1234/);
  assert.doesNotMatch(mainSource, /示範帳號/);
});
