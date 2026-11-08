import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  UPLOADS_DIR,
  id,
  loadDb,
  persist,
  isPhotoAvatar,
  migrateListingCategories,
  normalizeStoredUploads,
  pickEmoji,
  pickTone,
  presentAvatar,
  publicBaseFromRequest,
  publicUser,
  MAX_LISTING_PHOTOS,
  MAX_MESSAGE_PHOTOS,
  absolutePhotos,
  presentAudio,
  saveAvatarDataUrl,
  saveMessageAudio,
  savePhotos,
  uploadPath,
} from './db.js';
import { listingDto, normalizeHandover, purgeSeedUsers, seedIfEmpty } from './seed.js';
import {
  acceptedBuyerId,
  applyConfirmReceipt,
  backfillDeals,
  badgeCountsFor,
  isActiveReview,
  presentReview,
  priceHint,
  reviewAccess,
  trustSummary,
} from './trust.js';
import { buildProposal, confirmProposal, findHandoff, handoffAccess, presentHandoff } from './handoff.js';
import { addNotice, markNoticesRead, noticesFor, remotePushHook, unreadNotices } from './notices.js';
import { filterBrowseListings, pageWindow } from './paging.js';
import { privacyPage, supportPage } from './public-pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || 'aomai-got-dev-secret-change-me';

seedIfEmpty();
purgeSeedUsers();
{
  const seeded = loadDb();
  let changed = false;
  if (backfillDeals(seeded)) changed = true;
  if (migrateListingCategories(seeded)) changed = true;
  if (normalizeStoredUploads(seeded)) changed = true;
  if (changed) persist();
}

const app = express();
app.set('trust proxy', 1);

function publicBaseFor(req) {
  return publicBaseFromRequest(req);
}
const EXTRA_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://127.0.0.1:4173',
      'http://localhost:4173',
      'capacitor://localhost',
      'http://localhost',
      'ionic://localhost',
      ...EXTRA_ORIGINS,
    ],
    credentials: true,
  })
);
app.use(express.json({ limit: '8mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const db = loadDb();
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
}

function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const db = loadDb();
      req.user = db.users.find((u) => u.id === payload.sub) || null;
    } catch {
      req.user = null;
    }
  }
  next();
}

function sign(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

const NAME_MAX = 20;
const BIO_MAX = 80;

function passwordFingerprint(passwordHash) {
  return crypto.createHash('sha256').update(String(passwordHash)).digest('hex').slice(0, 16);
}

function signReset(user) {
  return jwt.sign(
    { sub: user.id, purpose: 'reset', ph: passwordFingerprint(user.passwordHash) },
    JWT_SECRET,
    { expiresIn: '30m' }
  );
}

function isPlausibleEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

const FORGOT_MESSAGE = '若電郵已註冊，我們會寄出重設指引';

function avatarFromName(name = '') {
  const chars = Array.from(String(name).trim());
  return chars.length ? chars[0] : '用';
}

function presentUser(user, req) {
  const base = publicUser(user, publicBaseFor(req));
  if (!base) return base;
  return { ...base, trust: trustSummary(user.id, loadDb()) };
}

/** Bump last-active at most once a minute so profile hints stay honest. */
function touch(db, userId) {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return false;
  const nowTs = Date.now();
  if (user.lastActiveAt && nowTs - user.lastActiveAt < 60 * 1000) return false;
  user.lastActiveAt = nowTs;
  return true;
}

function storedUploadPath(value) {
  return uploadPath(value);
}

/** Persist a new data-URL avatar, or keep the caller's current upload. */
function storeAvatar(raw, current) {
  const value = String(raw || '').trim();
  if (value.startsWith('data:')) return saveAvatarDataUrl(value);
  const incoming = storedUploadPath(value);
  const existing = storedUploadPath(current);
  if (incoming && existing && incoming === existing) return existing;
  return null;
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時`;
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天';
  if (d < 7) return `${d} 天`;
  return new Date(ts).toLocaleDateString('zh-Hant', { timeZone: 'Asia/Macau' });
}

function offerStatusOf(offer) {
  const status = offer?.status;
  if (status === 'accepted' || status === 'rejected' || status === 'countered' || status === 'pending') {
    return status;
  }
  return 'pending';
}

function offerDto(o, db, viewerId = '') {
  const from = db.users.find((u) => u.id === o.fromId);
  const thread = db.threads.find((t) => t.listingId === o.listingId && t.buyerId === o.fromId);
  const listing = db.listings.find((l) => l.id === o.listingId);
  const status = offerStatusOf(o);
  const access = handoffAccess({ ...o, status }, listing, viewerId);
  return {
    id: o.id,
    listingId: o.listingId,
    fromId: o.fromId,
    fromName: from?.name || '',
    amount: o.amount,
    meetup: o.meetup || '',
    message: o.message || '',
    status,
    counterAmount: o.counterAmount ?? null,
    counterMessage: o.counterMessage || '',
    agreedAmount: o.agreedAmount ?? (status === 'accepted' ? o.amount : null),
    threadId: thread?.id || null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt || o.createdAt,
    canHandoff: access.canHandoff,
    handoff: access.canHandoff ? presentHandoff(findHandoff(db, o.id)) : null,
  };
}

function rememberHandoff(db, row) {
  if (!Array.isArray(db.handoffs)) db.handoffs = [];
  db.handoffs = [row, ...db.handoffs.filter((h) => h.offerId !== row.offerId && h.id !== row.id)];
}

function notifyUser(db, { userId, kind, title, body, href, refId }) {
  const row = addNotice(db, {
    id: id('n-'),
    userId,
    kind,
    title,
    body,
    href,
    refId,
    createdAt: Date.now(),
  });
  if (row) remotePushHook(db, userId);
  return row;
}

function latestOffer(db, listingId, buyerId) {
  return (
    db.offers
      .filter((o) => o.listingId === listingId && o.fromId === buyerId)
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))[0] || null
  );
}

function bumpOffer(db, offer) {
  db.offers = [offer, ...db.offers.filter((o) => o.id !== offer.id)];
}

function messagePreviewText(m) {
  if (!m) return '';
  const text = String(m.text || '').split('\n')[0];
  if (text) return text;
  if (m.audio && m.audio.url) return '語音訊息';
  if (Array.isArray(m.photos) && m.photos.length) return '相片';
  return '';
}

function messageDto(m, db, base, fromName) {
  const from = fromName != null ? { name: fromName } : db.users.find((u) => u.id === m.fromId);
  return {
    id: m.id,
    fromId: m.fromId,
    fromName: from?.name || '',
    text: m.text || '',
    photos: absolutePhotos(Array.isArray(m.photos) ? m.photos : [], base),
    audio: presentAudio(m.audio, base),
    createdAt: m.createdAt,
  };
}

function threadDto(thread, userId, db, req) {
  const base = publicBaseFor(req);
  const listing = db.listings.find((l) => l.id === thread.listingId);
  const peerId = thread.buyerId === userId ? thread.sellerId : thread.buyerId;
  const peer = db.users.find((u) => u.id === peerId);
  const msgs = db.messages
    .filter((m) => m.threadId === thread.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const unread =
    thread.buyerId === userId ? Boolean(thread.buyerUnread) : Boolean(thread.sellerUnread);
  const offer = latestOffer(db, thread.listingId, thread.buyerId);
  return {
    id: thread.id,
    listingId: thread.listingId,
    buyerId: thread.buyerId,
    sellerId: thread.sellerId,
    peerId: peerId || '',
    peerName: peer?.name || '街坊',
    peerAvatar: presentAvatar(peer?.avatar || '?', base),
    preview: thread.preview || messagePreviewText(msgs[msgs.length - 1]),
    time: relativeTime(thread.updatedAt || thread.createdAt),
    unread,
    messages: msgs.map((m) => messageDto(m, db, base)),
    listing: listing ? listingDto(listing, db, base, userId) : null,
    offer: offer ? offerDto(offer, db, userId) : null,
  };
}

function ensureThread(db, listing, buyerId) {
  let thread = db.threads.find(
    (t) => t.listingId === listing.id && t.buyerId === buyerId && t.sellerId === listing.sellerId
  );
  if (thread) return thread;
  thread = {
    id: id('t-'),
    listingId: listing.id,
    buyerId,
    sellerId: listing.sellerId,
    preview: '',
    buyerUnread: false,
    sellerUnread: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.threads.unshift(thread);
  return thread;
}

function pushMessage(db, thread, fromId, text, photos = [], audio = null) {
  const body = String(text || '').trim();
  const imgs = Array.isArray(photos) ? photos.filter((p) => typeof p === 'string' && p) : [];
  const voice = audio && audio.url ? { url: audio.url, duration: audio.duration } : null;
  if (!body && !imgs.length && !voice) return null;
  const msg = {
    id: id('m-'),
    threadId: thread.id,
    fromId,
    text: body,
    photos: imgs,
    createdAt: Date.now(),
  };
  if (voice) msg.audio = voice;
  db.messages.push(msg);
  thread.preview = body.split('\n')[0] || (voice ? '語音訊息' : '相片');
  thread.updatedAt = msg.createdAt;
  if (fromId === thread.buyerId) {
    thread.sellerUnread = true;
    thread.buyerUnread = false;
  } else {
    thread.buyerUnread = true;
    thread.sellerUnread = false;
  }
  // bump thread
  db.threads = [thread, ...db.threads.filter((t) => t.id !== thread.id)];
  return msg;
}

/* ---------- Public pages (Traditional Chinese) ---------- */
app.get('/privacy', (_req, res) => {
  res.type('html').send(privacyPage());
});

app.get('/support', (_req, res) => {
  res.type('html').send(supportPage());
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'aomai-got', time: Date.now() });
});

/* ---------- Auth ---------- */
app.post('/api/auth/register', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!name || !email || password.length < 6) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請填寫名稱、電郵，密碼至少 6 位' });
  }
  const db = loadDb();
  if (db.users.some((u) => u.email === email)) {
    return res.status(409).json({ error: 'EMAIL_TAKEN', message: '此電郵已被註冊' });
  }
  const user = {
    id: id('u-'),
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    avatar: avatarFromName(name),
    bio: '澳門街坊',
    verified: false,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  db.users.push(user);
  persist();
  const token = sign(user);
  res.status(201).json({ token, user: presentUser(user, req) });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const db = loadDb();
  const user = db.users.find((u) => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '電郵或密碼不正確' });
  }
  touch(db, user.id);
  persist();
  res.json({ token: sign(user), user: presentUser(user, req) });
});

app.post('/api/auth/forgot', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!isPlausibleEmail(email)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請輸入有效電郵' });
  }
  const db = loadDb();
  const user = db.users.find((u) => u.email === email);
  if (user) {
    // Ready for a mailer (`#/reset?token=...`, 30 minutes). This demo does not
    // send mail, and the token is not returned: a different body would reveal
    // which emails are registered, and returning the token would allow takeover.
    signReset(user);
  }
  res.json({ ok: true, message: FORGOT_MESSAGE });
});

app.post('/api/auth/reset', (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < 6) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '密碼至少 6 位' });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return res.status(400).json({ error: 'BAD_TOKEN', message: '重設連結無效或已過期' });
  }
  if (!payload || payload.purpose !== 'reset' || !payload.sub) {
    return res.status(400).json({ error: 'BAD_TOKEN', message: '重設連結無效或已過期' });
  }
  const db = loadDb();
  const user = db.users.find((u) => u.id === payload.sub);
  if (!user || payload.ph !== passwordFingerprint(user.passwordHash)) {
    return res.status(400).json({ error: 'BAD_TOKEN', message: '重設連結無效或已過期' });
  }
  user.passwordHash = bcrypt.hashSync(password, 10);
  persist();
  res.json({ ok: true, message: '密碼已更新，請重新登入' });
});

app.get('/api/me', auth, (req, res) => {
  const db = loadDb();
  if (touch(db, req.user.id)) persist();
  res.json({ user: presentUser(req.user, req) });
});

app.patch('/api/me', auth, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
  const hasBio = Object.prototype.hasOwnProperty.call(body, 'bio');
  const hasAvatar = Object.prototype.hasOwnProperty.call(body, 'avatar');
  if (!hasName && !hasBio && !hasAvatar) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請提供要更新的資料' });
  }

  const name = (hasName ? String(body.name ?? '') : String(req.user.name || '')).replace(/[\r\n]+/g, ' ').trim();
  const bio = (hasBio ? String(body.bio ?? '') : String(req.user.bio || '')).trim();
  if (!name) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請填寫使用者名稱' });
  }
  if (Array.from(name).length > NAME_MAX) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: `使用者名稱最多 ${NAME_MAX} 字` });
  }
  if (Array.from(bio).length > BIO_MAX) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: `個人簡介最多 ${BIO_MAX} 字` });
  }

  const db = loadDb();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });

  let nextAvatar = user.avatar;
  if (hasAvatar) {
    const raw = body.avatar;
    if (raw == null || String(raw).trim() === '') {
      nextAvatar = avatarFromName(name);
    } else {
      const saved = storeAvatar(raw, user.avatar);
      if (!saved) {
        return res.status(400).json({ error: 'INVALID_INPUT', message: '無法使用這張頭像，請改選圖片' });
      }
      nextAvatar = saved;
    }
  } else if (!isPhotoAvatar(user.avatar)) {
    const previous = String(user.name || '').trim();
    if (!String(user.avatar || '').trim() || name !== previous) {
      nextAvatar = avatarFromName(name);
    }
  }

  user.name = name;
  user.bio = bio;
  user.avatar = nextAvatar;
  touch(db, user.id);
  persist();
  res.json({ user: presentUser(user, req) });
});

function priceBound(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/* ---------- Listings ---------- */
app.get('/api/listings', optionalAuth, (req, res) => {
  const db = loadDb();
  const mine = req.query.mine === '1' || req.query.mine === 'true';
  if (mine && !req.user) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: '請先登入' });
  }
  const list = filterBrowseListings(db.listings, {
    q: req.query.q,
    category: req.query.category,
    min: priceBound(req.query.min),
    max: priceBound(req.query.max),
    sellerId: mine ? req.user.id : '',
    includeSold: mine,
  });
  const viewerId = req.user?.id || '';
  const paged = pageWindow(list, req.query);
  if (paged.error) return res.status(400).json({ error: 'INVALID_INPUT', message: '頁數不正確' });
  res.json({
    listings: paged.items.map((l) => listingDto(l, db, publicBaseFor(req), viewerId)),
    total: paged.total,
    offset: paged.offset,
    limit: paged.limit,
    hasMore: paged.hasMore,
    nextOffset: paged.nextOffset,
  });
});

app.get('/api/listings/:id', optionalAuth, (req, res) => {
  const db = loadDb();
  const l = db.listings.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ listing: listingDto(l, db, publicBaseFor(req), req.user?.id || '') });
});

function readListingFields(body) {
  const title = String(body?.title || '').trim();
  const price = Number(body?.price);
  const category = String(body?.category || '其他').trim();
  const location = String(body?.location || '澳門 · 附近').trim();
  const condition = String(body?.condition || '良好').trim();
  const description = String(body?.description || '').trim();
  const negotiable = body?.negotiable !== false;
  if (!title || !price || price <= 0 || !description) {
    return { error: { status: 400, error: 'INVALID_INPUT', message: '請填寫標題、價錢與描述' } };
  }
  const incomingPhotos = body?.photos;
  if (Array.isArray(incomingPhotos)) {
    const photoCount = incomingPhotos.filter((p) => typeof p === 'string' && p).length;
    if (photoCount > MAX_LISTING_PHOTOS) {
      return {
        error: { status: 400, error: 'TOO_MANY_PHOTOS', message: `最多 ${MAX_LISTING_PHOTOS} 張相片` },
      };
    }
  }
  const photos = savePhotos(incomingPhotos || []);
  if (!photos.length) {
    return { error: { status: 400, error: 'PHOTO_REQUIRED', message: '請至少上傳一張相片' } };
  }
  return {
    value: {
      title,
      price,
      negotiable,
      category,
      location,
      condition,
      description,
      handover: normalizeHandover(body?.handover, description),
      photos,
    },
  };
}

function sendListingWriteError(res, error) {
  return res.status(error.status).json({ error: error.error, message: error.message });
}

app.post('/api/listings', auth, (req, res) => {
  const parsed = readListingFields(req.body);
  if (parsed.error) return sendListingWriteError(res, parsed.error);
  const db = loadDb();
  const fields = parsed.value;
  const listing = {
    id: id('l-'),
    ...fields,
    sellerId: req.user.id,
    tone: pickTone(fields.title),
    emoji: pickEmoji(fields.category),
    sold: false,
    createdAt: Date.now(),
  };
  db.listings.unshift(listing);
  touch(db, req.user.id);
  persist();
  res.status(201).json({ listing: listingDto(listing, db, publicBaseFor(req), req.user.id) });
});

app.patch('/api/listings/:id', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到商品' });
  if (listing.sellerId !== req.user.id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: '只有刊登者可以修改' });
  }
  const parsed = readListingFields(req.body);
  if (parsed.error) return sendListingWriteError(res, parsed.error);
  const fields = parsed.value;
  listing.title = fields.title;
  listing.price = fields.price;
  listing.negotiable = fields.negotiable;
  listing.category = fields.category;
  listing.location = fields.location;
  listing.condition = fields.condition;
  listing.description = fields.description;
  listing.handover = fields.handover;
  listing.photos = fields.photos;
  listing.tone = pickTone(fields.title);
  listing.emoji = pickEmoji(fields.category);
  listing.updatedAt = Date.now();
  touch(db, req.user.id);
  persist();
  res.json({ listing: listingDto(listing, db, publicBaseFor(req), req.user.id) });
});

app.patch('/api/listings/:id/sold', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到商品' });
  if (listing.sellerId !== req.user.id) {
    return res.status(403).json({ error: 'FORBIDDEN', message: '只有賣家可以標示已售出' });
  }
  const sold = req.body?.sold;
  listing.sold = typeof sold === 'boolean' ? sold : !listing.sold;
  if (listing.sold) listing.buyerId = acceptedBuyerId(listing, db);
  else delete listing.buyerId;
  touch(db, req.user.id);
  persist();
  res.json({ listing: listingDto(listing, db, publicBaseFor(req), req.user.id) });
});

app.post('/api/listings/:id/confirm-receipt', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  const result = applyConfirmReceipt(listing, db, req.user.id);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, message: result.message });
  }
  if (!result.already) {
    const thread = ensureThread(db, listing, req.user.id);
    pushMessage(db, thread, req.user.id, '已確認收貨');
    notifyUser(db, {
      userId: listing.sellerId,
      kind: 'offer',
      title: '買家已確認收貨',
      body: `${req.user.name} 已確認收貨`,
      href: `detail/${listing.id}`,
      refId: listing.id,
    });
  }
  touch(db, req.user.id);
  persist();
  res.json({ listing: listingDto(listing, db, publicBaseFor(req), req.user.id) });
});

app.post('/api/listings/:id/want', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND' });
  const exists = db.wants.find((w) => w.userId === req.user.id && w.listingId === listing.id);
  if (!exists) {
    db.wants.unshift({ userId: req.user.id, listingId: listing.id, createdAt: Date.now() });
    touch(db, req.user.id);
    persist();
  }
  res.json({ ok: true, wants: db.wants.filter((w) => w.userId === req.user.id).map((w) => w.listingId) });
});

app.delete('/api/listings/:id/want', auth, (req, res) => {
  const db = loadDb();
  db.wants = db.wants.filter((w) => !(w.userId === req.user.id && w.listingId === req.params.id));
  touch(db, req.user.id);
  persist();
  res.json({ ok: true, wants: db.wants.filter((w) => w.userId === req.user.id).map((w) => w.listingId) });
});

app.get('/api/wants', auth, (req, res) => {
  const db = loadDb();
  const ids = db.wants.filter((w) => w.userId === req.user.id).map((w) => w.listingId);
  const listings = ids
    .map((lid) => db.listings.find((l) => l.id === lid))
    .filter(Boolean)
    .map((l) => listingDto(l, db, publicBaseFor(req), req.user.id));
  res.json({ wants: ids, listings });
});

/* ---------- Offers ---------- */
app.post('/api/listings/:id/offers', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到商品' });
  if (listing.sold) return res.status(400).json({ error: 'LISTING_SOLD', message: '此商品已售出' });
  if (listing.sellerId === req.user.id) {
    return res.status(400).json({ error: 'OWN_LISTING', message: '不能對自己的刊登議價' });
  }
  const amount = Number(req.body?.amount);
  const meetup = String(req.body?.meetup || '賣家地點').trim();
  const message = String(req.body?.message || '').trim().slice(0, 200);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請輸入有效出價' });
  }

  const nowTs = Date.now();
  let offer = latestOffer(db, listing.id, req.user.id);
  let lead = '出價';
  if (offer && offerStatusOf(offer) === 'accepted') {
    return res.status(400).json({
      error: 'OFFER_ACCEPTED',
      message: '賣家已接受出價，請在訊息確認交收',
    });
  }
  if (offer) {
    const prev = offerStatusOf(offer);
    lead = prev === 'pending' ? '更新出價' : '再出價';
    offer.amount = amount;
    offer.meetup = meetup;
    offer.message = message;
    offer.status = 'pending';
    offer.counterAmount = null;
    offer.counterMessage = '';
    offer.agreedAmount = null;
    offer.updatedAt = nowTs;
    bumpOffer(db, offer);
  } else {
    offer = {
      id: id('o-'),
      listingId: listing.id,
      fromId: req.user.id,
      amount,
      meetup,
      message,
      status: 'pending',
      counterAmount: null,
      counterMessage: '',
      agreedAmount: null,
      createdAt: nowTs,
      updatedAt: nowTs,
    };
    db.offers.unshift(offer);
  }

  const thread = ensureThread(db, listing, req.user.id);
  const lines = [`${lead} MOP ${offer.amount} · ${meetup}`];
  if (message) lines.push(message);
  pushMessage(db, thread, req.user.id, lines.join('\n'));
  notifyUser(db, {
    userId: listing.sellerId,
    kind: 'offer',
    title: '新出價',
    body: `${req.user.name} ${lead} MOP ${offer.amount}`,
    href: `chat/${thread.id}`,
    refId: offer.id,
  });
  touch(db, req.user.id);
  persist();
  res.status(201).json({
    offer: offerDto(offer, db, req.user.id),
    thread: threadDto(thread, req.user.id, db, req),
    updated: lead !== '出價',
  });
});

/** Seller sees every offer. Any other signed-in user sees only their own. */
app.get('/api/listings/:id/offers', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到商品' });
  const isSeller = listing.sellerId === req.user.id;
  const offers = db.offers
    .filter((o) => o.listingId === listing.id && (isSeller || o.fromId === req.user.id))
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .map((o) => offerDto(o, db, req.user.id));
  res.json({ offers });
});

app.get('/api/offers/mine', auth, (req, res) => {
  const db = loadDb();
  const offers = db.offers
    .filter((o) => o.fromId === req.user.id)
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .map((o) => offerDto(o, db, req.user.id));
  res.json({ offers });
});

app.get('/api/offers/incoming', auth, (req, res) => {
  const db = loadDb();
  const mine = new Set(db.listings.filter((l) => l.sellerId === req.user.id).map((l) => l.id));
  const offers = db.offers
    .filter((o) => mine.has(o.listingId))
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .map((o) => offerDto(o, db, req.user.id));
  res.json({ offers });
});

app.patch('/api/offers/:id', auth, (req, res) => {
  const action = String(req.body?.action || '').trim();
  const db = loadDb();
  const offer = db.offers.find((o) => o.id === req.params.id);
  if (!offer) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到這筆出價' });
  const listing = db.listings.find((l) => l.id === offer.listingId);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到商品' });
  if (listing.sold) return res.status(400).json({ error: 'LISTING_SOLD', message: '此商品已售出' });

  const isSeller = listing.sellerId === req.user.id;
  const isBuyer = offer.fromId === req.user.id;
  if (!isSeller && !isBuyer) return res.status(403).json({ error: 'FORBIDDEN' });

  const status = offerStatusOf(offer);
  if (status === 'accepted' || status === 'rejected') {
    return res.status(400).json({ error: 'OFFER_CLOSED', message: '這筆出價已有結果' });
  }

  const thread = ensureThread(db, listing, offer.fromId);
  const nowTs = Date.now();

  if (action === 'accept') {
    if (status === 'pending') {
      if (!isSeller) return res.status(403).json({ error: 'FORBIDDEN', message: '等賣家回覆' });
      offer.status = 'accepted';
      offer.agreedAmount = offer.amount;
      pushMessage(db, thread, req.user.id, `接受出價 MOP ${offer.amount}`);
    } else if (isBuyer) {
      offer.status = 'accepted';
      offer.agreedAmount = offer.counterAmount;
      pushMessage(db, thread, req.user.id, `接受回價 MOP ${offer.counterAmount}`);
    } else {
      offer.status = 'accepted';
      offer.agreedAmount = offer.amount;
      pushMessage(db, thread, req.user.id, `接受出價 MOP ${offer.amount}`);
    }
  } else if (action === 'reject') {
    if (status === 'pending' && !isSeller) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '等賣家回覆' });
    }
    offer.status = 'rejected';
    offer.agreedAmount = null;
    pushMessage(db, thread, req.user.id, isBuyer && status === 'countered' ? '未接受回價' : '未接受這筆出價');
  } else if (action === 'counter') {
    if (!isSeller) return res.status(403).json({ error: 'FORBIDDEN', message: '只有賣家可以回價' });
    const counterAmount = Number(req.body?.counterAmount);
    const counterMessage = String(req.body?.counterMessage || '').trim().slice(0, 120);
    if (!counterAmount || counterAmount <= 0) {
      return res.status(400).json({ error: 'INVALID_INPUT', message: '請輸入有效回價' });
    }
    offer.status = 'countered';
    offer.counterAmount = counterAmount;
    offer.counterMessage = counterMessage;
    offer.agreedAmount = null;
    const lines = [`回價 MOP ${counterAmount}`];
    if (counterMessage) lines.push(counterMessage);
    pushMessage(db, thread, req.user.id, lines.join('\n'));
  } else {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '無法更新這筆出價' });
  }

  offer.updatedAt = nowTs;
  bumpOffer(db, offer);
  const peerId = req.user.id === offer.fromId ? listing.sellerId : offer.fromId;
  const noticeBody =
    action === 'accept'
      ? `${req.user.name} 接受了出價`
      : action === 'reject'
        ? `${req.user.name} 未接受這筆出價`
        : `${req.user.name} 回價 MOP ${offer.counterAmount}`;
  notifyUser(db, {
    userId: peerId,
    kind: 'offer',
    title: '議價有更新',
    body: noticeBody,
    href: `chat/${thread.id}`,
    refId: offer.id,
  });
  touch(db, req.user.id);
  persist();
  res.json({
    offer: offerDto(offer, db, req.user.id),
    thread: threadDto(thread, req.user.id, db, req),
  });
});

function handoffParties(offer, listing) {
  return { buyerId: offer.fromId, sellerId: listing.sellerId };
}

app.put('/api/offers/:id/handoff', auth, (req, res) => {
  const db = loadDb();
  const offer = db.offers.find((o) => o.id === req.params.id);
  if (!offer) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到這筆出價' });
  const listing = db.listings.find((l) => l.id === offer.listingId);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到商品' });
  const nowTs = Date.now();
  const result = buildProposal({
    existing: findHandoff(db, offer.id),
    offer,
    listing,
    userId: req.user.id,
    placeId: req.body?.placeId,
    customPlace: req.body?.customPlace,
    when: req.body?.when,
    note: req.body?.note,
    now: nowTs,
    id: id('h-'),
  });
  if (result.error) return res.status(400).json({ error: 'INVALID_INPUT', message: result.error });
  rememberHandoff(db, result.handoff);
  const thread = ensureThread(db, listing, offer.fromId);
  const verb = result.changed ? '提議見面' : '更新見面';
  pushMessage(db, thread, req.user.id, `${verb}：${result.summary}`);
  const parties = handoffParties(offer, listing);
  const peerId = req.user.id === parties.sellerId ? parties.buyerId : parties.sellerId;
  notifyUser(db, {
    userId: peerId,
    kind: 'handoff',
    title: '見面安排',
    body: `${req.user.name} ${verb}：${result.summary}`,
    href: `chat/${thread.id}`,
    refId: offer.id,
  });
  touch(db, req.user.id);
  persist();
  res.json({
    handoff: presentHandoff(result.handoff),
    offer: offerDto(offer, db, req.user.id),
    thread: threadDto(thread, req.user.id, db, req),
  });
});

app.post('/api/offers/:id/handoff/confirm', auth, (req, res) => {
  const db = loadDb();
  const offer = db.offers.find((o) => o.id === req.params.id);
  if (!offer) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到這筆出價' });
  const listing = db.listings.find((l) => l.id === offer.listingId);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到商品' });
  const nowTs = Date.now();
  const result = confirmProposal(findHandoff(db, offer.id), offer, listing, req.user.id, nowTs);
  if (result.error) return res.status(400).json({ error: 'INVALID_INPUT', message: result.error });
  rememberHandoff(db, result.handoff);
  const thread = ensureThread(db, listing, offer.fromId);
  if (result.became) {
    const summary = presentHandoff(result.handoff);
    const line = `已確認見面：${summary.whenLabel} · ${summary.place}`;
    pushMessage(db, thread, req.user.id, line);
    const parties = handoffParties(offer, listing);
    const peerId = req.user.id === parties.sellerId ? parties.buyerId : parties.sellerId;
    notifyUser(db, {
      userId: peerId,
      kind: 'handoff',
      title: '見面已確認',
      body: line,
      href: `chat/${thread.id}`,
      refId: offer.id,
    });
  }
  touch(db, req.user.id);
  persist();
  res.json({
    handoff: presentHandoff(result.handoff),
    offer: offerDto(offer, db, req.user.id),
    thread: threadDto(thread, req.user.id, db, req),
  });
});

/* ---------- Threads ---------- */
app.get('/api/threads', auth, (req, res) => {
  const db = loadDb();
  const mine = db.threads
    .filter((t) => t.buyerId === req.user.id || t.sellerId === req.user.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((t) => threadDto(t, req.user.id, db, req));
  res.json({ threads: mine });
});

app.get('/api/threads/:id', auth, (req, res) => {
  const db = loadDb();
  const thread = db.threads.find((t) => t.id === req.params.id);
  if (!thread) return res.status(404).json({ error: 'NOT_FOUND' });
  if (thread.buyerId !== req.user.id && thread.sellerId !== req.user.id) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  if (thread.buyerId === req.user.id) thread.buyerUnread = false;
  else thread.sellerUnread = false;
  touch(db, req.user.id);
  persist();
  res.json({ thread: threadDto(thread, req.user.id, db, req) });
});

app.post('/api/threads/:id/messages', auth, (req, res) => {
  const db = loadDb();
  const thread = db.threads.find((t) => t.id === req.params.id);
  if (!thread) return res.status(404).json({ error: 'NOT_FOUND' });
  if (thread.buyerId !== req.user.id && thread.sellerId !== req.user.id) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const text = String(req.body?.text || '').trim();
  const incomingPhotos = req.body?.photos;
  if (Array.isArray(incomingPhotos)) {
    const photoCount = incomingPhotos.filter((p) => typeof p === 'string' && p).length;
    if (photoCount > MAX_MESSAGE_PHOTOS) {
      return res.status(400).json({
        error: 'TOO_MANY_PHOTOS',
        message: `每則訊息最多 ${MAX_MESSAGE_PHOTOS} 張相片`,
      });
    }
  }
  const audioResult = saveMessageAudio(req.body?.audio);
  if (audioResult.error) {
    return res.status(400).json({ error: audioResult.error, message: audioResult.message });
  }
  let photos = [];
  if (Array.isArray(incomingPhotos)) {
    photos = savePhotos(incomingPhotos, MAX_MESSAGE_PHOTOS);
  }
  if (!text && !photos.length && !audioResult.audio) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請輸入訊息、加上相片或錄音' });
  }
  const msg = pushMessage(db, thread, req.user.id, text, photos, audioResult.audio);
  if (!msg) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請輸入訊息、加上相片或錄音' });
  }
  const peerId = req.user.id === thread.buyerId ? thread.sellerId : thread.buyerId;
  notifyUser(db, {
    userId: peerId,
    kind: 'message',
    title: req.user.name || '新訊息',
    body: (msg.text || (msg.audio ? '語音訊息' : '相片')).split('\n')[0],
    href: `chat/${thread.id}`,
    refId: msg.id,
  });
  touch(db, req.user.id);
  persist();
  const base = publicBaseFor(req);
  res.status(201).json({
    message: messageDto(msg, db, base, req.user.name),
    thread: threadDto(thread, req.user.id, db, req),
  });
});

app.get('/api/badges', auth, (req, res) => {
  const db = loadDb();
  res.json({ ...badgeCountsFor(db, req.user.id), notices: unreadNotices(db, req.user.id) });
});

app.get('/api/notifications', auth, (req, res) => {
  const db = loadDb();
  res.json({ notices: noticesFor(db, req.user.id), unread: unreadNotices(db, req.user.id) });
});

app.post('/api/notifications/read', auth, (req, res) => {
  const db = loadDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  markNoticesRead(db, req.user.id, ids);
  persist();
  res.json({ notices: noticesFor(db, req.user.id), unread: unreadNotices(db, req.user.id) });
});

app.get('/api/push/status', auth, (req, res) => {
  const db = loadDb();
  const devices = (db.devices || []).filter((d) => d.userId === req.user.id).length;
  res.json({
    remotePush: false,
    devices,
    reason: '需要 Apple APNs 與 Google FCM 憑證。未設定時只用應用內紅點同本機通知。',
  });
});

app.post('/api/devices', auth, (req, res) => {
  const token = String(req.body?.token || '').trim();
  const platform = String(req.body?.platform || '').trim();
  if (!token || token.length > 4096) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '裝置權杖不正確' });
  }
  if (!['ios', 'android', 'web'].includes(platform)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '平台不正確' });
  }
  const db = loadDb();
  if (!Array.isArray(db.devices)) db.devices = [];
  const nowTs = Date.now();
  const existing = db.devices.find((d) => d.userId === req.user.id && d.token === token);
  if (existing) {
    existing.platform = platform;
    existing.updatedAt = nowTs;
  } else {
    db.devices.push({
      id: id('d-'),
      userId: req.user.id,
      token,
      platform,
      createdAt: nowTs,
      updatedAt: nowTs,
    });
  }
  touch(db, req.user.id);
  persist();
  res.json({ ok: true, stored: true, remotePush: false });
});

app.get('/api/price-hint', (req, res) => {
  const category = String(req.query.category || '其他').trim();
  const condition = String(req.query.condition || '良好').trim();
  res.json(priceHint(loadDb(), category, condition));
});

app.get('/api/users/:id', optionalAuth, (req, res) => {
  const db = loadDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到這位街坊' });
  const profile = presentUser(user, req);
  delete profile.email;
  const listings = db.listings
    .filter((l) => l.sellerId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((l) => listingDto(l, db, publicBaseFor(req), req.user?.id || ''));
  const reviews = (db.reviews || [])
    .filter((r) => r.toId === user.id && isActiveReview(r, db))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
    .map((r) => presentReview(r, db));
  res.json({ user: profile, listings, reviews });
});

app.post('/api/listings/:id/reviews', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND', message: '找不到商品' });
  const access = reviewAccess(listing, db, req.user.id);
  if (!access.canReview) {
    return res.status(400).json({
      error: 'CANNOT_REVIEW',
      message: access.myReview ? '你已經留過這筆評價' : '這筆暫時不能評價',
    });
  }
  const stars = Number(req.body?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請選 1 至 5 顆星' });
  }
  const text = String(req.body?.text || '').replace(/[\r\n]+/g, ' ').trim();
  if (Array.from(text).length > 80) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '評價最多 80 字' });
  }
  const toId = req.user.id === listing.sellerId ? listing.buyerId : listing.sellerId;
  const review = {
    id: id('r-'),
    listingId: listing.id,
    fromId: req.user.id,
    toId,
    stars,
    text,
    createdAt: Date.now(),
  };
  if (!Array.isArray(db.reviews)) db.reviews = [];
  db.reviews.unshift(review);
  touch(db, req.user.id);
  persist();
  res.status(201).json({
    review: presentReview(review, db),
    listing: listingDto(listing, db, publicBaseFor(req), req.user.id),
  });
});

app.get('/api/stats', auth, (req, res) => {
  const db = loadDb();
  const mine = db.listings.filter((l) => l.sellerId === req.user.id);
  const myOffers = db.offers.filter((o) => o.fromId === req.user.id);
  const sold = mine.filter((l) => l.sold).length;
  const trust = trustSummary(req.user.id, db, { recentLimit: 3 });
  res.json({
    posts: mine.length,
    bargains: myOffers.length,
    deals: sold,
    sold,
    active: mine.length - sold,
    saved: db.wants.filter((w) => w.userId === req.user.id).length,
    bought: trust.bought,
    trust,
  });
});

const DIST = path.resolve(__dirname, '../dist');
app.use(express.static(DIST));
app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/uploads') ||
    req.path === '/privacy' ||
    req.path === '/support'
  ) {
    return next();
  }
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'SERVER_ERROR', message: '伺服器錯誤' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`澳賣GOT API http://127.0.0.1:${PORT}`);
  console.log(`Privacy  http://127.0.0.1:${PORT}/privacy`);
  console.log(`Support  http://127.0.0.1:${PORT}/support`);
});
