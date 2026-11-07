import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'aomai.json');

const EMPTY = () => ({
  users: [],
  listings: [],
  offers: [],
  threads: [],
  messages: [],
  wants: [],
  reviews: [],
  handoffs: [],
  notices: [],
  devices: [],
});

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let cache = null;

export function loadDb() {
  ensureDirs();
  if (cache) return cache;
  if (!fs.existsSync(DB_PATH)) {
    cache = EMPTY();
    persist();
    return cache;
  }
  try {
    cache = { ...EMPTY(), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } catch {
    cache = EMPTY();
  }
  return cache;
}

export function persist() {
  ensureDirs();
  fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

export function id(prefix = '') {
  return `${prefix}${uuid().replace(/-/g, '').slice(0, 12)}`;
}

export function isPhotoAvatar(avatar) {
  const a = String(avatar || '').trim();
  return Boolean(uploadPath(a)) || /^https?:\/\//i.test(a) || a.startsWith('data:');
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function isLoopbackHost(hostname) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(host);
}

/** `/uploads/<file>` from a relative path or any absolute URL. Empty if it is not our file. */
export function uploadPath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:')) return '';
  let pathname = '';
  if (raw.startsWith('/uploads/')) pathname = raw.split('?')[0].split('#')[0];
  else if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return '';
    }
  } else return '';
  if (!pathname.startsWith('/uploads/')) return '';
  const name = pathname.slice('/uploads/'.length);
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || !/^[A-Za-z0-9._-]+$/.test(name)) {
    return '';
  }
  return `/uploads/${name}`;
}

function originOf(base) {
  const raw = String(base || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** A configured origin phones can reach. Loopback (Render's bind address) is ignored. */
export function usablePublicBase(base) {
  const origin = originOf(base);
  if (!origin) return '';
  try {
    if (isLoopbackHost(new URL(origin).hostname)) return '';
  } catch {
    return '';
  }
  return origin;
}

function headerValue(req, name) {
  if (!req) return '';
  if (typeof req.get === 'function') {
    const value = req.get(name);
    return value == null ? '' : String(value);
  }
  const headers = req.headers || {};
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return String(value[0] || '');
  return value == null ? '' : String(value);
}

/**
 * Origin to prefix onto /uploads paths for this response.
 * Public env wins. Otherwise use the request host. Loopback requests keep
 * their own origin so local Vite can still load images; they never inherit
 * Render's internal 127.0.0.1:$PORT bind address.
 */
export function publicBaseFromRequest(req, env = process.env) {
  const configured = usablePublicBase(env.PUBLIC_BASE) || usablePublicBase(env.RENDER_EXTERNAL_URL);
  if (configured) return configured;
  const host = String(headerValue(req, 'host')).split(',')[0].trim();
  if (!host) return '';
  let hostname = host;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    hostname = host.split(':')[0];
  }
  if (isLoopbackHost(hostname)) {
    const proto = req?.protocol === 'https' ? 'https' : 'http';
    return `${proto}://${host}`;
  }
  const forwarded = headerValue(req, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : req?.protocol === 'http' ? 'http' : 'https';
  return `${proto}://${host}`;
}

/** Rewrite a stored upload to a client-reachable URL. Letters and external URLs pass through. */
export function presentUpload(value, publicBase = '') {
  const path = uploadPath(value);
  if (!path) return String(value ?? '');
  const base = originOf(publicBase);
  return base ? `${base}${path}` : path;
}

/** Turn a stored /uploads path into an absolute URL. Letters pass through. */
export function presentAvatar(avatar, publicBase = '') {
  return presentUpload(avatar, publicBase);
}

/** Persist relative /uploads paths so a later deploy cannot keep a dead host. */
export function normalizeStoredUploads(db) {
  if (!db) return false;
  let changed = false;
  const rewrite = (value) => {
    const path = uploadPath(value);
    if (!path || path === value) return value;
    changed = true;
    return path;
  };
  for (const user of db.users || []) {
    if (user && typeof user.avatar === 'string') user.avatar = rewrite(user.avatar);
  }
  for (const listing of db.listings || []) {
    if (!listing || !Array.isArray(listing.photos)) continue;
    listing.photos = listing.photos.map((photo) => rewrite(photo));
  }
  for (const message of db.messages || []) {
    if (!message || !Array.isArray(message.photos)) continue;
    message.photos = message.photos.map((photo) => rewrite(photo));
  }
  return changed;
}

export function publicUser(u, publicBase = '') {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: presentAvatar(u.avatar, publicBase),
    bio: u.bio || '',
    verified: Boolean(u.verified),
  };
}

const AVATAR_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Save one data-URL avatar. Returns a relative /uploads path, or null. */
export function saveAvatarDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  const ext = AVATAR_TYPES[m[1].toLowerCase()];
  if (!ext) return null;
  let buf;
  try {
    buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  } catch {
    return null;
  }
  if (!buf.length || buf.length > 1.5 * 1024 * 1024) return null;
  ensureDirs();
  const name = `${id('img-')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  return `/uploads/${name}`;
}

/** Dropped picker labels. Stored listings move to the closest category that remains. */
const CATEGORY_MOVES = { 潮流: '服飾' };

export function migrateListingCategories(db) {
  if (!db) return false;
  let changed = false;
  for (const listing of db.listings || []) {
    const next = listing && CATEGORY_MOVES[listing.category];
    if (!next) continue;
    listing.category = next;
    changed = true;
  }
  return changed;
}

export function pickTone(title = '') {
  const tones = ['#eceae6', '#d8d4cc', '#e4e4e4', '#ddd6c8', '#cfcfcf', '#f0eeea'];
  let n = 0;
  for (let i = 0; i < title.length; i++) n += title.charCodeAt(i);
  return tones[n % tones.length];
}

export function pickEmoji(category) {
  const map = {
    服飾: '👕',
    美妝: '💄',
    數碼: '📱',
    家電: '🧊',
    家居: '🪑',
    運動: '🏀',
    母嬰: '🍼',
    玩具: '🧸',
    遊戲: '🎮',
    卡牌: '🃏',
    寵物用品: '🐾',
    '票券／會籍': '🎫',
    書本: '📚',
    其他: '📦',
  };
  return map[category] || '📦';
}

/** Listing photo cap. The sell form and POST /api/listings use the same number. */
export const MAX_LISTING_PHOTOS = 10;

/** Images attached to one chat message. */
export const MAX_MESSAGE_PHOTOS = 4;

/** Save data URL photos to disk. Always returns relative /uploads paths (or an external URL). */
export function savePhotos(photos = [], max = MAX_LISTING_PHOTOS) {
  const limit = Number.isInteger(max) && max > 0 ? max : MAX_LISTING_PHOTOS;
  const out = [];
  for (const p of photos || []) {
    if (out.length >= limit) break;
    if (typeof p !== 'string' || !p) continue;
    const existing = uploadPath(p);
    if (existing) {
      out.push(existing);
      continue;
    }
    if (/^https?:\/\//i.test(p)) {
      out.push(p);
      continue;
    }
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(p);
    if (!m) continue;
    let buf;
    try {
      buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
    } catch {
      continue;
    }
    // Skip oversized files instead of truncating them into a broken image.
    if (!buf.length || buf.length > 1.5 * 1024 * 1024) continue;
    const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
    const name = `${id('img-')}.${ext}`;
    ensureDirs();
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
    out.push(`/uploads/${name}`);
  }
  return out;
}

export function absolutePhotos(photos, publicBase) {
  return (photos || []).map((p) => (p ? presentUpload(p, publicBase) : p));
}
