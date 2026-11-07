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
    if (!message) continue;
    if (Array.isArray(message.photos)) {
      message.photos = message.photos.map((photo) => rewrite(photo));
    }
    if (message.audio && typeof message.audio === 'object' && typeof message.audio.url === 'string') {
      message.audio.url = rewrite(message.audio.url);
    }
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

/** One voice note per message. 16 kHz mono WAV for 60s is about 1.9MB. */
export const MAX_VOICE_SECONDS = 60;
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;

const AUDIO_EXT = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/m4a': 'mp4',
  'audio/x-m4a': 'mp4',
  'audio/aac': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/vnd.wave': 'wav',
};

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

function parseAudioDataUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const comma = trimmed.indexOf(',');
  if (!trimmed.startsWith('data:') || comma < 0) return null;
  const parts = trimmed
    .slice(5, comma)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length || !parts.some((part) => part.toLowerCase() === 'base64')) return null;
  return { mime: parts[0].toLowerCase(), b64: trimmed.slice(comma + 1) };
}

function normalizeVoiceDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.4 || n > MAX_VOICE_SECONDS + 1) return null;
  return Math.max(1, Math.min(MAX_VOICE_SECONDS, Math.round(n)));
}

function sniffedAudioExt(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (buf.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  return '';
}

/** Container sniff so a renamed image or text file is not stored as a voice note. */
function audioMagicOk(buf, ext) {
  if (!buf || buf.length < 12) return false;
  if (ext === 'webm') {
    return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  }
  if (ext === 'ogg') {
    return buf.toString('ascii', 0, 4) === 'OggS';
  }
  if (ext === 'mp3') {
    if (buf.toString('ascii', 0, 3) === 'ID3') return true;
    return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  }
  if (ext === 'mp4') {
    return buf.toString('ascii', 4, 8) === 'ftyp';
  }
  if (ext === 'wav') {
    return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
  }
  return false;
}

/**
 * Persist one chat voice note. `input` is `{ data, duration }` where `data`
 * is a base64 audio data URL. Returns `{ audio }` or `{ error, message }`.
 * Pass `{ maxBytes }` only from tests.
 */
export function saveMessageAudio(input, { maxBytes = MAX_VOICE_BYTES } = {}) {
  if (input == null || input === false || input === '') return { audio: null };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'INVALID_AUDIO', message: '語音格式不正確' };
  }
  const duration = normalizeVoiceDuration(input.duration);
  if (duration == null) {
    const n = Number(input.duration);
    if (Number.isFinite(n) && n > MAX_VOICE_SECONDS) {
      return { error: 'AUDIO_TOO_LONG', message: `錄音最長 ${MAX_VOICE_SECONDS} 秒` };
    }
    if (Number.isFinite(n) && n >= 0 && n < 0.4) {
      return { error: 'AUDIO_TOO_SHORT', message: '錄音太短' };
    }
    return { error: 'INVALID_AUDIO', message: '語音格式不正確' };
  }
  const parsed = parseAudioDataUrl(input.data);
  if (!parsed) return { error: 'INVALID_AUDIO', message: '語音格式不正確' };
  let buf;
  try {
    buf = Buffer.from(String(parsed.b64).replace(/\s/g, ''), 'base64');
  } catch {
    return { error: 'INVALID_AUDIO', message: '語音格式不正確' };
  }
  if (!buf.length || buf.length < 16) return { error: 'INVALID_AUDIO', message: '語音檔無效' };
  if (buf.length > maxBytes) return { error: 'AUDIO_TOO_LARGE', message: '語音檔太大' };
  const declared = AUDIO_EXT[parsed.mime];
  const sniffed = sniffedAudioExt(buf);
  // Phones often label a real recording as octet-stream or video/webm.
  const ext = declared || sniffed;
  if (!ext) return { error: 'INVALID_AUDIO', message: '只接受 webm、mp4、mp3、ogg 或 wav 音訊' };
  if (declared && sniffed && declared !== sniffed) return { error: 'INVALID_AUDIO', message: '只接受音訊檔' };
  if (!audioMagicOk(buf, ext)) return { error: 'INVALID_AUDIO', message: '只接受音訊檔' };
  ensureDirs();
  const name = `${id('aud-')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  return { audio: { url: `/uploads/${name}`, duration } };
}

/** Client URL for a stored voice note. External and non-audio values are dropped. */
export function presentAudio(audio, publicBase = '') {
  if (!audio || typeof audio !== 'object' || Array.isArray(audio)) return null;
  const path = uploadPath(audio.url);
  if (!path || !/\.(webm|mp4|mp3|ogg|wav)$/i.test(path)) return null;
  const duration = Number(audio.duration);
  if (!Number.isFinite(duration)) return null;
  return {
    url: presentUpload(path, publicBase),
    duration: Math.max(0, Math.min(MAX_VOICE_SECONDS, Math.round(duration))),
  };
}
