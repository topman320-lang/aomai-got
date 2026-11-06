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
  pickEmoji,
  pickTone,
  publicUser,
  savePhotos,
} from './db.js';
import { listingDto, normalizeHandover, seedIfEmpty } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || 'aomai-got-dev-secret-change-me';
const PUBLIC_BASE = process.env.PUBLIC_BASE || `http://127.0.0.1:${PORT}`;

seedIfEmpty();

const app = express();
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
  const t = String(name).trim();
  return t ? t.slice(0, 1) : '用';
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

function threadDto(thread, userId, db) {
  const listing = db.listings.find((l) => l.id === thread.listingId);
  const peerId = thread.buyerId === userId ? thread.sellerId : thread.buyerId;
  const peer = db.users.find((u) => u.id === peerId);
  const msgs = db.messages
    .filter((m) => m.threadId === thread.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const unread =
    thread.buyerId === userId ? Boolean(thread.buyerUnread) : Boolean(thread.sellerUnread);
  return {
    id: thread.id,
    listingId: thread.listingId,
    peerId: peerId || '',
    peerName: peer?.name || '街坊',
    peerAvatar: peer?.avatar || '?',
    preview: thread.preview || (msgs.length ? msgs[msgs.length - 1].text.split('\n')[0] : ''),
    time: relativeTime(thread.updatedAt || thread.createdAt),
    unread,
    messages: msgs.map((m) => {
      const from = db.users.find((u) => u.id === m.fromId);
      return {
        id: m.id,
        fromId: m.fromId,
        fromName: from?.name || '',
        text: m.text,
        createdAt: m.createdAt,
      };
    }),
    listing: listing ? listingDto(listing, db, PUBLIC_BASE) : null,
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

function pushMessage(db, thread, fromId, text) {
  const msg = {
    id: id('m-'),
    threadId: thread.id,
    fromId,
    text: String(text || '').trim(),
    createdAt: Date.now(),
  };
  if (!msg.text) return null;
  db.messages.push(msg);
  thread.preview = msg.text.split('\n')[0];
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

/* ---------- Privacy (Traditional Chinese) ---------- */
app.get('/privacy', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>隱私政策 · 澳賣 GOT</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif;max-width:680px;margin:0 auto;padding:32px 20px 64px;line-height:1.7;color:#111;background:#fff}
  h1{font-size:22px;margin:0 0 8px}
  h2{font-size:16px;margin:28px 0 8px}
  p,li{font-size:14px;color:#333}
  .muted{color:#767676;font-size:13px}
</style>
</head>
<body>
  <h1>澳賣 GOT 隱私政策</h1>
  <p class="muted">適用於澳門特別行政區 · 最後更新：2026 年 11 月</p>
  <p>澳賣 GOT（下稱「本服務」）是一個以鄰里議價為主的二手物品交流平台。我們重視你的個人資料，並依本政策說明蒐集、使用與保存方式。</p>
  <h2>一、我們蒐集什麼</h2>
  <ul>
    <li>帳號資料：顯示名稱、電郵、密碼（加密儲存）。</li>
    <li>刊登與交易相關內容：商品說明、照片、出價、交收意願、聊天訊息。</li>
    <li>裝置與技術資料：基本日誌（例如 IP、瀏覽器類型），用於維運與防止濫用。</li>
  </ul>
  <h2>二、用途</h2>
  <ul>
    <li>提供註冊登入、刊登、議價、訊息等核心功能。</li>
    <li>維護平台安全、防詐騙與不當內容。</li>
    <li>依法律要求配合主管機關。</li>
  </ul>
  <h2>三、分享與披露</h2>
  <p>我們不會出售你的個人資料。僅在提供服務所必需（例如顯示賣家暱稱給買家）、經你同意、或法律要求時，才會披露相關資訊。交收請在安全公開場所進行，切勿分享敏感證件或銀行資料。</p>
  <h2>四、保存與安全</h2>
  <p>資料保存在我們的伺服器（目前為應用程式後端資料庫）。密碼以雜湊方式儲存。請妥善保管登入憑證；若懷疑帳號被盜用，請立即更改密碼並聯絡我們。</p>
  <h2>五、你的權利</h2>
  <p>你可要求查閱、更正或刪除帳號相關資料（法律另有規定者除外）。刪除帳號後，公開刊登與對話紀錄可能依法或營運需要在合理期間內保留備份。</p>
  <h2>六、兒童</h2>
  <p>本服務不針對 16 歲以下人士。若發現相關帳號，我們可能予以停用。</p>
  <h2>七、聯絡</h2>
  <p>關於隱私事宜，請電郵至 <strong>privacy@aomai.got</strong>（示範聯絡，上架前請改為真實信箱）。</p>
  <p class="muted">本政策可能不時更新；重大變更將於應用內或本頁公告。</p>
</body>
</html>`);
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
  };
  db.users.push(user);
  persist();
  const token = sign(user);
  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const db = loadDb();
  const user = db.users.find((u) => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '電郵或密碼不正確' });
  }
  res.json({ token: sign(user), user: publicUser(user) });
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
  res.json({ user: publicUser(req.user) });
});

/* ---------- Listings ---------- */
app.get('/api/listings', optionalAuth, (req, res) => {
  const db = loadDb();
  const q = String(req.query.q || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim();
  let list = [...db.listings].sort((a, b) => b.createdAt - a.createdAt);
  if (category && category !== '全部') {
    list = list.filter((l) => l.category === category);
  }
  if (q) {
    list = list.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.location.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q) ||
        (l.description || '').toLowerCase().includes(q)
    );
  }
  res.json({ listings: list.map((l) => listingDto(l, db, PUBLIC_BASE)) });
});

app.get('/api/listings/:id', optionalAuth, (req, res) => {
  const db = loadDb();
  const l = db.listings.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json({ listing: listingDto(l, db, PUBLIC_BASE) });
});

app.post('/api/listings', auth, (req, res) => {
  const title = String(req.body?.title || '').trim();
  const price = Number(req.body?.price);
  const category = String(req.body?.category || '其他').trim();
  const location = String(req.body?.location || '澳門 · 附近').trim();
  const condition = String(req.body?.condition || '良好').trim();
  const description = String(req.body?.description || '').trim();
  const negotiable = req.body?.negotiable !== false;
  if (!title || !price || price <= 0 || !description) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請填寫標題、價錢與描述' });
  }
  const photos = savePhotos(req.body?.photos || [], PUBLIC_BASE);
  const db = loadDb();
  const listing = {
    id: id('l-'),
    title,
    price,
    negotiable,
    category,
    location,
    condition,
    description,
    handover: normalizeHandover(req.body?.handover, description),
    sellerId: req.user.id,
    tone: pickTone(title),
    emoji: pickEmoji(category),
    photos: photos.map((p) => p.replace(PUBLIC_BASE, '') || p),
    sold: false,
    createdAt: Date.now(),
  };
  // store relative /uploads paths when possible
  listing.photos = photos.map((p) => {
    if (p.startsWith(PUBLIC_BASE)) return p.slice(PUBLIC_BASE.length);
    return p;
  });
  db.listings.unshift(listing);
  persist();
  res.status(201).json({ listing: listingDto(listing, db, PUBLIC_BASE) });
});

app.patch('/api/listings/:id/sold', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND' });
  if (listing.sellerId !== req.user.id) return res.status(403).json({ error: 'FORBIDDEN' });
  const sold = req.body?.sold;
  listing.sold = typeof sold === 'boolean' ? sold : !listing.sold;
  persist();
  res.json({ listing: listingDto(listing, db, PUBLIC_BASE) });
});

app.post('/api/listings/:id/want', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND' });
  const exists = db.wants.find((w) => w.userId === req.user.id && w.listingId === listing.id);
  if (!exists) {
    db.wants.unshift({ userId: req.user.id, listingId: listing.id, createdAt: Date.now() });
    persist();
  }
  res.json({ ok: true, wants: db.wants.filter((w) => w.userId === req.user.id).map((w) => w.listingId) });
});

app.delete('/api/listings/:id/want', auth, (req, res) => {
  const db = loadDb();
  db.wants = db.wants.filter((w) => !(w.userId === req.user.id && w.listingId === req.params.id));
  persist();
  res.json({ ok: true, wants: db.wants.filter((w) => w.userId === req.user.id).map((w) => w.listingId) });
});

app.get('/api/wants', auth, (req, res) => {
  const db = loadDb();
  const ids = db.wants.filter((w) => w.userId === req.user.id).map((w) => w.listingId);
  const listings = ids
    .map((lid) => db.listings.find((l) => l.id === lid))
    .filter(Boolean)
    .map((l) => listingDto(l, db, PUBLIC_BASE));
  res.json({ wants: ids, listings });
});

/* ---------- Offers ---------- */
app.post('/api/listings/:id/offers', auth, (req, res) => {
  const db = loadDb();
  const listing = db.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.status(404).json({ error: 'NOT_FOUND' });
  if (listing.sold) return res.status(400).json({ error: 'LISTING_SOLD', message: '此商品已售出' });
  if (listing.sellerId === req.user.id) {
    return res.status(400).json({ error: 'OWN_LISTING', message: '不能對自己的刊登議價' });
  }
  const amount = Number(req.body?.amount);
  const meetup = String(req.body?.meetup || '賣家地點').trim();
  const message = String(req.body?.message || '').trim();
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: '請輸入有效出價' });
  }
  const offer = {
    id: id('o-'),
    listingId: listing.id,
    fromId: req.user.id,
    amount,
    meetup,
    message,
    createdAt: Date.now(),
  };
  db.offers.unshift(offer);
  const thread = ensureThread(db, listing, req.user.id);
  const lines = [`出價 MOP ${offer.amount} · ${meetup}`];
  if (message) lines.push(message);
  pushMessage(db, thread, req.user.id, lines.join('\n'));
  persist();
  res.status(201).json({
    offer: {
      ...offer,
      fromName: req.user.name,
    },
    thread: threadDto(thread, req.user.id, db),
  });
});

app.get('/api/listings/:id/offers', optionalAuth, (req, res) => {
  const db = loadDb();
  const offers = db.offers
    .filter((o) => o.listingId === req.params.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => {
      const from = db.users.find((u) => u.id === o.fromId);
      return { ...o, fromName: from?.name || '' };
    });
  res.json({ offers });
});

app.get('/api/offers/mine', auth, (req, res) => {
  const db = loadDb();
  const offers = db.offers
    .filter((o) => o.fromId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => {
      const from = db.users.find((u) => u.id === o.fromId);
      return { ...o, fromName: from?.name || req.user.name };
    });
  res.json({ offers });
});

/* ---------- Threads ---------- */
app.get('/api/threads', auth, (req, res) => {
  const db = loadDb();
  const mine = db.threads
    .filter((t) => t.buyerId === req.user.id || t.sellerId === req.user.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((t) => threadDto(t, req.user.id, db));
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
  persist();
  res.json({ thread: threadDto(thread, req.user.id, db) });
});

app.post('/api/threads/:id/messages', auth, (req, res) => {
  const db = loadDb();
  const thread = db.threads.find((t) => t.id === req.params.id);
  if (!thread) return res.status(404).json({ error: 'NOT_FOUND' });
  if (thread.buyerId !== req.user.id && thread.sellerId !== req.user.id) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'INVALID_INPUT' });
  const msg = pushMessage(db, thread, req.user.id, text);
  persist();
  res.status(201).json({
    message: {
      id: msg.id,
      fromId: msg.fromId,
      fromName: req.user.name,
      text: msg.text,
      createdAt: msg.createdAt,
    },
    thread: threadDto(thread, req.user.id, db),
  });
});

app.get('/api/stats', auth, (req, res) => {
  const db = loadDb();
  const mine = db.listings.filter((l) => l.sellerId === req.user.id);
  const myOffers = db.offers.filter((o) => o.fromId === req.user.id);
  res.json({
    posts: mine.length,
    bargains: myOffers.length,
    deals: mine.filter((l) => l.sold).length,
  });
});

const DIST = path.resolve(__dirname, '../dist');
app.use(express.static(DIST));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path === '/privacy') {
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
  console.log(`澳賣 GOT API http://127.0.0.1:${PORT}`);
  console.log(`Privacy  http://127.0.0.1:${PORT}/privacy`);
  console.log(`Demo     demo@aomai.got / demo1234`);
});
