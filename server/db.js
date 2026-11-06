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

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    bio: u.bio || '',
    verified: Boolean(u.verified),
  };
}

export function pickTone(title = '') {
  const tones = ['#eceae6', '#d8d4cc', '#e4e4e4', '#ddd6c8', '#cfcfcf', '#f0eeea'];
  let n = 0;
  for (let i = 0; i < title.length; i++) n += title.charCodeAt(i);
  return tones[n % tones.length];
}

export function pickEmoji(category) {
  const map = {
    潮流: '✨',
    服飾: '👕',
    美妝: '💄',
    數碼: '📱',
    家電: '🧊',
    家居: '🪑',
    運動: '🏀',
    母嬰: '🍼',
    其他: '📦',
  };
  return map[category] || '📦';
}

/** Save data URL photos to disk; return public URL paths. */
export function savePhotos(photos = [], publicBase) {
  const out = [];
  for (const p of (photos || []).slice(0, 3)) {
    if (typeof p !== 'string' || !p) continue;
    if (p.startsWith('/uploads/') || p.startsWith('http://') || p.startsWith('https://')) {
      out.push(p.startsWith('http') ? p : `${publicBase}${p}`);
      continue;
    }
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(p);
    if (!m) continue;
    let buf = Buffer.from(m[2], 'base64');
    // Cap ~1.5MB per image for MVP
    if (buf.length > 1.5 * 1024 * 1024) {
      buf = buf.subarray(0, Math.floor(1.5 * 1024 * 1024));
    }
    const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
    const name = `${id('img-')}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
    out.push(`${publicBase}/uploads/${name}`);
  }
  return out;
}

export function absolutePhotos(photos, publicBase) {
  return (photos || []).map((p) => {
    if (!p) return p;
    if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) return p;
    if (p.startsWith('/')) return `${publicBase}${p}`;
    return p;
  });
}
