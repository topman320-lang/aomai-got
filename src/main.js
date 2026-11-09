import { API_BASE, privacyUrl, supportUrl } from './api.js';
import { listingSharePayload } from './share.js';
import {
  MAX_VOICE_SECONDS,
  coerceAudioDataUrl,
  encodeVoiceWav,
  formatVoiceDuration,
  mixToMono,
  playableAudioSrc,
  preferredRecorderMime,
  resampleMono,
  voiceErrorMessage,
} from './voice.js';
import {
  loadMessageAlertPref,
  messageAlertNote,
  messageAlertsEnabled,
  resumeMessageAlerts,
  setMessageAlerts,
  watchNotices,
} from './notify.js';
import {
  CATEGORIES,
  CONDITION_OPTIONS,
  HANDOVERS,
  LOCATIONS,
  MEET_PLACES,
  MEETUPS,
  addListing,
  addOffer,
  addReview,
  addWant,
  bootstrap,
  confirmHandoff,
  confirmReceipt,
  deleteListing,
  deleteMessage,
  hideOffer,
  hideThread,
  fetchHomeListings,
  fetchUser,
  getBadges,
  getListing,
  getOffersForListing,
  getState,
  getThread,
  getThreadByListing,
  isLoggedIn,
  listingMatches,
  login,
  logout,
  markNoticesRead,
  markThreadRead,
  priceHint,
  refreshBadges,
  refreshNotices,
  removeWant,
  updateProfile,
  refreshIncomingOffers,
  refreshListing,
  refreshListings,
  refreshMyOffers,
  refreshThreads,
  refreshWants,
  openListingThread,
  register,
  resendVerification,
  respondToOffer,
  updateListing,
  requestPasswordReset,
  resetPassword,
  saveHandoff,
  sendMessage,
  setSold,
  stats,
} from './store.js';

const app = document.getElementById('app');

let viewToken = 0;

function nextView() {
  viewToken += 1;
  return viewToken;
}

function isView(token) {
  return token === viewToken;
}

function parseHash() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  return { parts, params };
}

let navGeneration = 0;

function go(path) {
  const next = `#/${String(path || '').replace(/^\//, '')}`;
  if (location.hash === next) return;
  navGeneration += 1;
  location.hash = next;
}

function money(n) {
  return `MOP ${Number(n).toLocaleString('zh-Hant')}`;
}

function isSold(l) {
  return Boolean(l?.sold);
}

function negotiateBadge(negotiable) {
  if (!negotiable) return '';
  return `<span class="badge negotiate yes" data-negotiable="yes" aria-label="可議價" title="可議價"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 6.2 4.6 8.8 10 3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter"/></svg><span>可議價</span></span>`;
}

function listingBadges(l) {
  if (isSold(l)) return '<span class="badge sold">已售</span>';
  return negotiateBadge(Boolean(l?.negotiable));
}

function priceHtml(n, sold = false) {
  const num = Number(n).toLocaleString('zh-Hant');
  return `<div class="price ${sold ? 'price-sold' : ''}"><span class="cur">MOP</span> ${num}</div>`;
}

function handoverOf(l) {
  return HANDOVERS.includes(l?.handover) ? l.handover : '面交';
}

function trustItems(l) {
  const items = [];
  if (l?.condition) items.push({ key: 'condition', label: `成色 ${l.condition}` });
  items.push({ key: 'handover', label: handoverOf(l) });
  if (!isSold(l)) {
    items.push(l?.negotiable ? { key: 'offer', label: '可議價' } : { key: 'fixed', label: '不議價' });
  }
  return items;
}

function trustHtml(l) {
  return trustItems(l)
    .map((item) => `<span class="trust-badge trust-${item.key}">${escapeHtml(item.label)}</span>`)
    .join('');
}

function firstPhoto(l) {
  return Array.isArray(l?.photos) && l.photos[0] ? l.photos[0] : '';
}

function isPhotoAvatar(avatar) {
  const a = String(avatar || '').trim();
  return a.startsWith('/uploads/') || a.startsWith('http://') || a.startsWith('https://') || a.startsWith('data:');
}

/** Listing files live on the API. Relative paths and dead loopback hosts both resolve there. */
function mediaSrc(value) {
  const a = String(value || '').trim();
  if (!a) return '';
  if (a.startsWith('/uploads/')) return `${API_BASE}${a}`;
  if (a.startsWith('data:')) return a;
  try {
    const url = new URL(a);
    if (url.pathname.startsWith('/uploads/')) return `${API_BASE}${url.pathname}`;
  } catch {
    /* leave non-URL values alone */
  }
  return a;
}

function thumbInner(l, { emojiClass = 'emoji' } = {}) {
  const photo = firstPhoto(l);
  if (photo) {
    return `<img class="thumb-img" src="${escapeAttr(mediaSrc(photo))}" alt="" />`;
  }
  return `<span class="${emojiClass}">${l?.emoji || '📦'}</span>`;
}

function letterFromName(name = '') {
  const chars = Array.from(String(name).trim());
  return chars.length ? chars[0] : '用';
}

function avatarSrc(avatar) {
  return mediaSrc(avatar);
}

function avatarHtml(avatar, size = '') {
  const photo = isPhotoAvatar(avatar);
  const cls = ['avatar', size, photo ? 'has-photo' : ''].filter(Boolean).join(' ');
  const inner = photo
    ? `<img src="${escapeAttr(avatarSrc(avatar))}" alt="" />`
    : escapeHtml(String(avatar || '').trim() ? Array.from(String(avatar).trim())[0] : '用');
  return `<div class="${cls}">${inner}</div>`;
}

function listingCard(l, { go: dest = `detail/${l.id}` } = {}) {
  const sold = isSold(l);
  const chips = [
    l.location ? `<span class="mini-chip">${escapeHtml(l.location)}</span>` : '',
    l.condition ? `<span class="mini-chip">${escapeHtml(l.condition)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  return `
        <button class="card ${sold ? 'sold' : ''}" type="button" data-go="${dest}">
          <div class="thumb" style="background:${escapeAttr(l.tone || '')}">
            ${thumbInner(l)}
            ${listingBadges(l)}
          </div>
          <div class="card-body">
            <div class="card-title">${escapeHtml(l.title)}</div>
            ${priceHtml(l.price, sold)}
            ${chips ? `<div class="card-chips">${chips}</div>` : ''}
          </div>
        </button>`;
}

let toastEpoch = 0;

function dismissToast() {
  toastEpoch += 1;
  clearTimeout(toast._t);
  toast._t = 0;
  toast._nav = -1;
  const el = document.querySelector('.toast');
  if (!el) return;
  el.classList.remove('show');
  el.textContent = '';
}

function toast(msg, ms = 2200) {
  const epoch = toastEpoch;
  const nav = navGeneration;
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._nav = nav;
  toast._t = setTimeout(() => {
    if (epoch !== toastEpoch) return;
    el.classList.remove('show');
    el.textContent = '';
    if (toast._nav === nav) toast._nav = -1;
  }, ms);
}

/** Drop a toast from an earlier screen. One shown for this navigation stays. */
function dismissStaleToast() {
  if (toast._nav !== navGeneration) dismissToast();
}

function errToast(err, fallback = '操作失敗') {
  toast(err?.message || fallback);
}

function requireAuth(nextPath) {
  if (isLoggedIn()) return true;
  sessionStorage.setItem('aomai-after-login', nextPath || parseHash().parts.join('/') || 'home');
  go('login');
  toast('請先登入');
  return false;
}

/** Where to go after login. Edit-profile is not a landing screen. */
function consumeAfterLogin(fallback = 'home') {
  const stored = sessionStorage.getItem('aomai-after-login');
  sessionStorage.removeItem('aomai-after-login');
  const next = String(stored || fallback || 'home').replace(/^\//, '');
  const head = next.split('?')[0];
  if (!head || head === 'profile' || head === 'login' || head === 'register' || head === 'forgot' || head === 'reset' || head === 'verify-sent') {
    return 'me';
  }
  return next;
}

function isLikelyImageFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type.startsWith('video/') || type.startsWith('audio/')) return false;
  const name = String(file.name || '');
  if (/\.(jpe?g|png|gif|webp|heic|heif|bmp|avif|jfif)$/i.test(name)) return true;
  if (/\.(pdf|txt|zip|docx?|xlsx?|pptx?|mp4|mov|avi|mkv|webm|mp3|wav|m4a)$/i.test(name)) {
    return false;
  }
  // iOS/Android gallery picks often have a blank type or application/octet-stream.
  return !type || type === 'application/octet-stream';
}

/** Which slots a new batch should fill. The tapped slot is first (replace). */
function planPhotoTargets(existing, start, count) {
  const n = Math.max(0, count | 0);
  const len = Array.isArray(existing) ? existing.length : 0;
  if (!n || !len) return [];
  const startNum = Number(start);
  let startIdx = Number.isInteger(startNum) ? startNum : -1;
  if (startIdx < 0 || startIdx >= len) {
    startIdx = existing.findIndex((p) => !p);
  }
  if (startIdx < 0) return [];
  const targets = [startIdx];
  for (let step = 1; step < len && targets.length < n; step += 1) {
    const idx = (startIdx + step) % len;
    if (!existing[idx]) targets.push(idx);
  }
  return targets;
}

function compressImageFile(file, maxEdge = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!isLikelyImageFile(file)) {
      reject(new Error('NOT_IMAGE'));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      reject(new Error('TOO_LARGE'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const encode = (edge, q) => {
        let { width, height } = img;
        const scale = Math.min(1, edge / Math.max(width, height, 1));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('NO_CANVAS');
        ctx.drawImage(img, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', q);
      };
      try {
        let edge = maxEdge;
        let q = quality;
        let data = encode(edge, q);
        // data URLs are about 4/3 of the JPEG. Keep uploads under ~450KB each.
        for (let pass = 0; pass < 4 && data.length > 450000 * 1.37; pass += 1) {
          q = Math.max(0.46, q - 0.1);
          edge = Math.max(720, Math.round(edge * 0.85));
          data = encode(edge, q);
        }
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('LOAD_FAIL'));
    };
    img.src = url;
  });
}

const THEME_KEY = 'aomai-got-theme';

function getTheme() {
  const t = localStorage.getItem(THEME_KEY);
  return t === 'dark' ? 'dark' : 'light';
}

function brandLogoSrc(variant = 'auto') {
  const theme = variant === 'auto' ? getTheme() : variant;
  return theme === 'dark' ? '/brand/logo-dark.jpg?v=3' : '/brand/logo-light.jpg?v=3';
}

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#111111' : '#ffffff');
  document.querySelectorAll('[data-brand-logo]').forEach((img) => {
    const force = img.getAttribute('data-brand-logo');
    if (force === 'dark' || force === 'light') {
      img.src = brandLogoSrc(force);
    } else {
      img.src = brandLogoSrc('auto');
    }
  });
}

function toggleTheme() {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

function tabIcon(name) {
  const svg = (body) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  const icons = {
    home: svg(
      `<path d="M3.15 11 12 3.25 20.85 11V20.85H3.15Z"/>`
    ),
    messages: svg(
      `<path d="M3.15 5h17.7v9.15H15.8L12 19.2 8.2 14.15H3.15Z"/>`
    ),
    post: svg(`<path d="M12 4.25v15.5M4.25 12h15.5"/>`),
    bargains: svg(
      `<path d="M3.2 7.55H17.55"/><path d="M13.7 4.15 17.55 7.55 13.7 10.95"/><path d="M20.8 16.45H6.45"/><path d="M10.3 13.05 6.45 16.45 10.3 19.85"/>`
    ),
    me: svg(
      `<circle cx="12" cy="8.05" r="3.3"/><path d="M20.15 20.75v-1.55a4.2 4.2 0 0 0-4.2-4.2H8.05a4.2 4.2 0 0 0-4.2 4.2v1.55"/>`
    ),
  };
  return icons[name] || '';
}

function tabBadge(count, label) {
  const n = Number(count) || 0;
  if (n <= 0) return '';
  const text = n > 9 ? '9+' : String(n);
  return `<span class="tab-badge" aria-label="${escapeAttr(label)}">${text}</span>`;
}

function tabbar(active) {
  const badges = getBadges();
  const tabs = [
    { id: 'home', label: '首頁' },
    { id: 'messages', label: '訊息', badge: badges.messages, badgeLabel: `${badges.messages} 則未讀訊息` },
    { id: 'post', label: '刊登', post: true },
    { id: 'bargains', label: '議價', badge: badges.offers, badgeLabel: `${badges.offers} 筆待處理議價` },
    { id: 'me', label: '我的', badge: badges.notices, badgeLabel: `${badges.notices} 則新提醒` },
  ];
  return `
    <nav class="tabbar" aria-label="主導覽">
      ${tabs
        .map(
          (t) => `
        <button class="tab ${t.post ? 'post' : ''} ${active === t.id ? 'active' : ''}" data-go="${t.id}" type="button">
          <span class="ico">${tabIcon(t.id)}${tabBadge(t.badge, t.badgeLabel || '')}</span>
          <span>${t.label}</span>
        </button>`
        )
        .join('')}
    </nav>`;
}

const MAX_LISTING_PHOTOS = 10;
const MAX_MESSAGE_PHOTOS = 4;
const chatPhotoDrafts = new Map();
const chatVoiceDrafts = new Map();
let activeCapture = null;
let voiceGeneration = 0;
let voiceArming = false;
let currentVoice = null;
const TRUST_FOOTNOTE = '街坊之間的成交與評價，平台不鑑定、不代收款。';
const SCAM_TIP = '建議面交，當面睇清楚先付款，唔好預先轉帳。平台唔託管貨款，亦唔鑑定真偽。';

function scamTipHtml(extraClass = '') {
  return `<p class="scam-tip ${extraClass}">${escapeHtml(SCAM_TIP)}</p>`;
}

function defaultMeetWhen() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const next = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1, 15, 0));
  const p = (n) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${p(next.getUTCMonth() + 1)}-${p(next.getUTCDate())}T15:00`;
}

function trustLines(trust, { quote = true } = {}) {
  if (!trust) return '';
  const sold = Number(trust.sold) || 0;
  const bought = Number(trust.bought) || 0;
  const rating = trust.ratingCount
    ? `${Number(trust.ratingAvg).toFixed(1)} 星 · ${trust.ratingCount} 則`
    : '未有評價';
  const recent = quote && trust.recent?.[0]?.text ? trust.recent[0] : null;
  const hints = [trust.replyHint, trust.lastActiveHint].filter(Boolean).join(' · ');
  return `
    <div class="seller-trust">
      <div class="trust-row">
        <span class="trust-badge">售出 ${sold}</span>
        <span class="trust-badge">買入 ${bought}</span>
        <span class="trust-badge">${escapeHtml(rating)}</span>
      </div>
      ${hints ? `<div class="meta">${escapeHtml(hints)}</div>` : ''}
      ${
        recent
          ? `<div class="trust-quote">「${escapeHtml(recent.text)}」<span class="meta"> ${escapeHtml(recent.fromName || '')}</span></div>`
          : ''
      }
    </div>`;
}

function skeletonCards(n = 6) {
  return Array.from(
    { length: n },
    () => `
        <div class="card skeleton-card">
          <div class="thumb sk"></div>
          <div class="card-body">
            <div class="sk sk-line"></div>
            <div class="sk sk-line short"></div>
          </div>
        </div>`
  ).join('');
}

function skeletonGrid(n = 6) {
  return `<div class="grid" aria-busy="true" aria-label="載入中">${skeletonCards(n)}</div>`;
}

function paintTabBadges() {
  const badges = getBadges();
  const spec = [
    ['messages', badges.messages, `${badges.messages} 則未讀訊息`],
    ['bargains', badges.offers, `${badges.offers} 筆待處理議價`],
    ['me', badges.notices, `${badges.notices} 則新提醒`],
  ];
  for (const [id, count, label] of spec) {
    const tab = document.querySelector(`.tab[data-go="${id}"] .ico`);
    if (!tab) continue;
    tab.querySelector('.tab-badge')?.remove();
    const html = tabBadge(count, label);
    if (html) tab.insertAdjacentHTML('beforeend', html);
  }
}

function skeletonThreads(n = 5) {
  return `<div aria-busy="true" aria-label="載入中">${Array.from({ length: n }, () => `
        <div class="thread skeleton-thread">
          <div class="avatar sk"></div>
          <div class="body">
            <div class="sk sk-line"></div>
            <div class="sk sk-line short"></div>
          </div>
        </div>`).join('')}
    </div>`;
}

function listErrorHtml(message) {
  return `<div class="empty">
      <div>${escapeHtml(message || '載入失敗')}</div>
      <div>網路不穩，請再試一次</div>
      <button class="btn ghost retry-btn" type="button" id="retry-load">再試一次</button>
    </div>`;
}

function listRetryBar() {
  return `<div class="list-retry"><span>網路不穩，顯示先前的內容</span><button type="button" class="text-link" id="retry-load">再試一次</button></div>`;
}

function subHeader(title, back) {
  return `<header class="topbar">
      <button class="back" type="button" data-go="${escapeAttr(back)}" aria-label="返回">←</button>
      <h1>${escapeHtml(title)}</h1>
    </header>`;
}

function shell(content, { tab = null, noTab = false, screenClass = '' } = {}) {
  return `
    <div class="phone">
      <div class="screen ${noTab ? 'no-tab' : ''} ${screenClass}">${content}</div>
      ${tab ? tabbar(tab) : ''}
    </div>`;
}

function offlineBanner() {
  if (getState().online) return '';
  return `<div class="offline-banner">無法連接伺服器（${escapeHtml(API_BASE)}）。請先啟動後端再重新整理。</div>`;
}

/* ---------- Auth screens ---------- */

async function resendVerificationEmail(email, button) {
  const value = String(email || '').trim();
  if (!value) {
    toast('請先填寫電郵');
    return;
  }
  if (button) button.disabled = true;
  try {
    const data = await resendVerification(value);
    toast(data?.message || '若此電郵已註冊且尚未認證，我們會再寄出認證信', 3600);
  } catch (err) {
    errToast(err, '未能重寄');
  } finally {
    if (button) button.disabled = false;
  }
}

function renderLogin() {
  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="home" aria-label="返回">←</button>
      <h1>登入</h1>
    </header>
    <div class="brand brand-home" style="padding:4px 16px 8px">
      <p style="margin:0;font-weight:700;letter-spacing:0.02em">澳賣GOT</p>
      <span class="muted tiny brand-tagline">MoGOT</span>
    </div>
    ${offlineBanner()}
    <form class="form" id="login-form">
      <div class="field">
        <label for="email">電郵</label>
        <input id="email" name="email" type="email" autocomplete="username" required placeholder="you@example.com" />
      </div>
      <div class="field">
        <label for="password">密碼</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="至少 6 位" />
      </div>
      <p class="auth-note">新帳號要先完成電郵認證，先可以登入。</p>
      <div class="actionbar" style="position:static;transform:none;max-width:none;padding:8px 0 0;border:0">
        <button class="btn ghost" type="button" data-go="register">註冊</button>
        <button class="btn primary" type="submit">登入</button>
      </div>
      <p class="form-links">
        <button class="text-link" type="button" data-go="forgot">忘記密碼</button>
        <button class="text-link" type="button" id="resend-verify">重寄認證信</button>
      </p>
    </form>`;
  app.innerHTML = shell(content, { noTab: true });
  app.querySelector('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      dismissToast();
      await login(String(fd.get('email')).trim(), String(fd.get('password')));
      go(consumeAfterLogin());
      toast('登入成功');
    } catch (err) {
      errToast(err, '登入失敗');
    }
  });
  app.querySelector('#resend-verify')?.addEventListener('click', () => {
    const email = app.querySelector('#email')?.value;
    resendVerificationEmail(email, app.querySelector('#resend-verify'));
  });
}

function renderRegister() {
  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="login" aria-label="返回">←</button>
      <h1>註冊</h1>
    </header>
    ${offlineBanner()}
    <form class="form" id="register-form">
      <div class="field">
        <label for="name">顯示名稱</label>
        <input id="name" name="name" lang="zh-Hant" required maxlength="20" placeholder="例如：阿輝" />
      </div>
      <div class="field">
        <label for="email">電郵</label>
        <input id="email" name="email" type="email" autocomplete="username" required placeholder="you@example.com" />
      </div>
      <div class="field">
        <label for="password">密碼</label>
        <input id="password" name="password" type="password" autocomplete="new-password" required minlength="6" placeholder="至少 6 位" />
      </div>
      <p class="auth-note">建立帳號後，請先打開認證電郵，完成後先可以登入。</p>
      <div class="actionbar" style="position:static;transform:none;max-width:none;padding:8px 0 0;border:0">
        <button class="btn ghost" type="button" data-go="login">已有帳號</button>
        <button class="btn primary" type="submit">建立帳號</button>
      </div>
    </form>`;
  app.innerHTML = shell(content, { noTab: true });
  app.querySelector('#register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      dismissToast();
      const email = String(fd.get('email')).trim();
      await register(String(fd.get('name')).trim(), email, String(fd.get('password')));
      go(`verify-sent?email=${encodeURIComponent(email)}`);
    } catch (err) {
      errToast(err, '註冊失敗');
      if (submit) submit.disabled = false;
    }
  });
}

function renderVerifySent() {
  const { params } = parseHash();
  const email = String(params.email || '').trim();
  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="login" aria-label="返回">←</button>
      <h1>請查收電郵</h1>
    </header>
    ${offlineBanner()}
    <div class="form">
      <p class="auth-note">${
        email
          ? `認證信已寄去 ${escapeHtml(email)}。請打開信入面嘅連結，啟用帳戶，然後再登入。搵唔到就睇下垃圾郵件。`
          : '請打開認證信入面嘅連結，啟用帳戶，然後再登入。'
      }</p>
      <div class="actionbar" style="position:static;transform:none;max-width:none;padding:8px 0 0;border:0">
        ${
          email
            ? '<button class="btn ghost" type="button" id="resend-verify">重寄認證信</button>'
            : '<button class="btn ghost" type="button" data-go="register">返回註冊</button>'
        }
        <button class="btn primary" type="button" data-go="login">去登入</button>
      </div>
    </div>`;
  app.innerHTML = shell(content, { noTab: true });
  app.querySelector('#resend-verify')?.addEventListener('click', () => {
    resendVerificationEmail(email, app.querySelector('#resend-verify'));
  });
}

function renderForgot() {
  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="login" aria-label="返回">←</button>
      <h1>忘記密碼</h1>
    </header>
    ${offlineBanner()}
    <form class="form" id="forgot-form">
      <div class="field">
        <label for="email">電郵</label>
        <input id="email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" />
      </div>
      <p class="meta" id="forgot-note" style="padding:0 4px">輸入註冊電郵。若帳戶存在，我們會寄出重設連結，30 分鐘內有效。搵唔到就睇下垃圾郵件。</p>
      <div class="actionbar" style="position:static;transform:none;max-width:none;padding:8px 0 0;border:0">
        <button class="btn ghost" type="button" data-go="login">返回登入</button>
        <button class="btn primary" type="submit">送出</button>
      </div>
    </form>`;
  app.innerHTML = shell(content, { noTab: true });
  app.querySelector('#forgot-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const data = await requestPasswordReset(String(fd.get('email')).trim());
      const message = data?.message || '若電郵已註冊，我們會寄出重設指引';
      const note = app.querySelector('#forgot-note');
      if (note) {
        note.textContent = message;
        note.classList.add('forgot-ack');
      }
      toast(message, 3600);
    } catch (err) {
      errToast(err, '送出失敗');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

function renderReset() {
  const { params } = parseHash();
  const token = String(params.token || '').trim();
  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="login" aria-label="返回">←</button>
      <h1>重設密碼</h1>
    </header>
    ${offlineBanner()}
    ${
      token
        ? `<form class="form" id="reset-form">
      <div class="field">
        <label for="password">新密碼</label>
        <input id="password" name="password" type="password" autocomplete="new-password" required minlength="6" placeholder="至少 6 位" />
      </div>
      <div class="field">
        <label for="password2">再輸入一次</label>
        <input id="password2" name="password2" type="password" autocomplete="new-password" required minlength="6" placeholder="至少 6 位" />
      </div>
      <p class="meta" style="padding:0 4px">重設連結 30 分鐘內有效，且只能使用一次。</p>
      <div class="actionbar" style="position:static;transform:none;max-width:none;padding:8px 0 0;border:0">
        <button class="btn ghost" type="button" data-go="login">返回登入</button>
        <button class="btn primary" type="submit">更新密碼</button>
      </div>
    </form>`
        : `<div class="empty">
      <p>重設連結無效或已過期。</p>
      <p class="form-links" style="justify-content:center;margin-top:16px">
        <button class="text-link" type="button" data-go="forgot">重新申請</button>
      </p>
    </div>`
    }`;
  app.innerHTML = shell(content, { noTab: true });
  app.querySelector('#reset-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const password = String(fd.get('password') || '');
    const password2 = String(fd.get('password2') || '');
    if (password.length < 6) {
      toast('密碼至少 6 位');
      return;
    }
    if (password !== password2) {
      toast('兩次密碼不一致');
      return;
    }
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const data = await resetPassword(token, password);
      go('login');
      toast(data?.message || '密碼已更新，請重新登入', 2800);
    } catch (err) {
      errToast(err, '重設失敗');
      if (submit) submit.disabled = false;
    }
  });
}

function renderHostedPage({ title, src }) {
  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="me" aria-label="返回">←</button>
      <h1>${escapeHtml(title)}</h1>
    </header>
    <div class="privacy-box">
      <p class="meta">載入中…</p>
      <iframe class="privacy-frame" title="${escapeAttr(title)}" src="${escapeAttr(src)}"></iframe>
      <p class="meta" style="padding:12px 0">若無法顯示，請開啟：<a href="${escapeAttr(src)}" target="_blank" rel="noopener">${escapeHtml(src)}</a></p>
    </div>`;
  app.innerHTML = shell(content, { noTab: true });
}

function renderPrivacy() {
  renderHostedPage({ title: '隱私政策', src: privacyUrl() });
}

function renderSupport() {
  renderHostedPage({ title: '支援', src: supportUrl() });
}

/* ---------- Screens ---------- */

function readPriceDraft(key) {
  const raw = sessionStorage.getItem(key);
  if (raw == null) return '';
  return String(raw).trim();
}

function priceDraftNumber(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function readHomeQuery() {
  const q = (sessionStorage.getItem('aomai-q') || '').trim();
  let cat = sessionStorage.getItem('aomai-cat') || '全部';
  if (!CATEGORIES.includes(cat)) {
    cat = '全部';
    sessionStorage.setItem('aomai-cat', cat);
  }
  const minRaw = readPriceDraft('aomai-min');
  const maxRaw = readPriceDraft('aomai-max');
  const min = priceDraftNumber(minRaw);
  const max = priceDraftNumber(maxRaw);
  return {
    q,
    cat,
    minRaw,
    maxRaw,
    min,
    max,
    rangeInvalid: min != null && max != null && min > max,
    filtering: Boolean(q || (cat && cat !== '全部') || minRaw || maxRaw),
  };
}

async function renderHome(token = nextView(), options = {}) {
  const ctx = readHomeQuery();
  const emptyCopy = !getState().online
    ? '伺服器未連線<br/>啟動後端後重新整理'
    : ctx.rangeInvalid
      ? '最低價錢高過最高<br/>改一改範圍再試'
      : ctx.filtering
        ? '沒有符合的刊登<br/>換個關鍵字、分類或價錢試試'
        : '暫時沒有刊登';

  const header = `
    <div class="home-head">
      <header class="topbar topbar-brand">
        <div class="brand brand-home">
          <img class="brand-logo brand-logo-home" data-brand-logo="auto" src="${brandLogoSrc()}" alt="澳賣GOT" />
        </div>
      </header>
      <div class="search">
        <span aria-hidden="true">⌕</span>
        <input id="search" type="search" lang="zh-Hant" inputmode="search" enterkeyhint="search" placeholder="搜尋標題或描述…" value="${escapeAttr(ctx.q)}" />
      </div>
      <div class="chips" id="cats">
        ${CATEGORIES.map(
          (c) => `<button type="button" class="chip ${c === ctx.cat ? 'active' : ''}" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</button>`
        ).join('')}
      </div>
      <div class="price-filter">
        <span class="price-filter-label">價錢</span>
        <input id="price-min" type="number" inputmode="numeric" min="0" step="1" placeholder="最低" aria-label="最低價錢" value="${escapeAttr(ctx.minRaw)}" />
        <span class="price-filter-dash" aria-hidden="true">–</span>
        <input id="price-max" type="number" inputmode="numeric" min="0" step="1" placeholder="最高" aria-label="最高價錢" value="${escapeAttr(ctx.maxRaw)}" />
        <button type="button" class="price-filter-clear" id="price-clear" ${ctx.minRaw || ctx.maxRaw ? '' : 'hidden'}>清除</button>
      </div>
    </div>`;

  const HOME_PAGE = 12;
  let feed = [];
  let hasMore = false;
  let total = 0;
  let nextOffset = 0;
  let loadingMore = false;

  const feedHtml = () => {
    if (!feed.length) return `<div class="empty">${emptyCopy}</div>`;
    const more = hasMore
      ? `<div class="home-more"><button class="btn ghost" type="button" id="home-more">載入更多</button></div>`
      : '';
    return `<div class="grid" id="home-grid">${feed.map((l) => listingCard(l)).join('')}</div>
      <div class="grid home-pending" id="home-pending" hidden>${skeletonCards(2)}</div>
      ${more}`;
  };

  const paint = (view) => {
    let main = skeletonGrid();
    if (!view.loading) {
      if (view.error && !feed.length) {
        main = listErrorHtml('刊登載入失敗');
      } else {
        const shown = Number.isFinite(view.total) ? view.total : feed.length;
        const meta = ctx.filtering
          ? `<div class="filter-meta">${ctx.rangeInvalid ? '價錢範圍未成立' : `${shown} 件符合`}</div>`
          : '';
        const retry = view.error && feed.length ? listRetryBar() : '';
        main = `${meta}${retry}${feedHtml()}`;
      }
    }
    const focusId = document.activeElement?.id;
    const keepFocus = focusId === 'search' || focusId === 'price-min' || focusId === 'price-max';
    const selStart = keepFocus ? document.activeElement.selectionStart : null;
    const selEnd = keepFocus ? document.activeElement.selectionEnd : null;
    app.innerHTML = shell(`${header}${offlineBanner()}${main}`, { tab: 'home', screenClass: 'home-screen' });
    const focused = keepFocus ? app.querySelector(`#${focusId}`) : null;
    if (focused) {
      focused.focus();
      try {
        focused.setSelectionRange(selStart ?? focused.value.length, selEnd ?? focused.value.length);
      } catch (_) {}
    }
    bindHomeChrome();
    if (!view.loading) bindFeed();
  };

  const scheduleHome = () => {
    clearTimeout(renderHome._t);
    renderHome._t = setTimeout(() => {
      const routeName = parseHash().parts[0] || 'home';
      if (routeName !== 'home') return;
      renderHome();
    }, 180);
  };

  function bindHomeChrome() {
    const search = app.querySelector('#search');
    search?.addEventListener('compositionstart', () => {
      search.dataset.composing = '1';
    });
    search?.addEventListener('compositionend', (e) => {
      search.dataset.composing = '0';
      sessionStorage.setItem('aomai-q', e.target.value);
      scheduleHome();
    });
    search?.addEventListener('input', (e) => {
      sessionStorage.setItem('aomai-q', e.target.value);
      if (search.dataset.composing === '1' || e.isComposing) return;
      scheduleHome();
    });
    const bindPrice = (id, key) => {
      const input = app.querySelector(`#${id}`);
      input?.addEventListener('input', () => {
        sessionStorage.setItem(key, input.value);
        scheduleHome();
      });
    };
    bindPrice('price-min', 'aomai-min');
    bindPrice('price-max', 'aomai-max');
    app.querySelector('#price-clear')?.addEventListener('click', () => {
      sessionStorage.removeItem('aomai-min');
      sessionStorage.removeItem('aomai-max');
      renderHome();
    });
    app.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sessionStorage.setItem('aomai-cat', btn.dataset.cat);
        renderHome();
      });
    });
    app.querySelector('#retry-load')?.addEventListener('click', () => {
      renderHome(nextView(), { forceSkeleton: true });
    });
    app.querySelector('#cats .chip.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  const sameQuery = () => {
    const latest = readHomeQuery();
    return (
      latest.q === ctx.q &&
      latest.cat === ctx.cat &&
      latest.minRaw === ctx.minRaw &&
      latest.maxRaw === ctx.maxRaw
    );
  };

  async function loadMore() {
    if (!hasMore || loadingMore || !isView(token) || !sameQuery()) return;
    loadingMore = true;
    const pending = app.querySelector('#home-pending');
    const moreBtn = app.querySelector('#home-more');
    if (pending) pending.hidden = false;
    if (moreBtn) moreBtn.disabled = true;
    try {
      const page = await fetchHomeListings({
        q: ctx.q,
        category: ctx.cat,
        min: ctx.min,
        max: ctx.max,
        limit: HOME_PAGE,
        offset: nextOffset,
      });
      if (!isView(token) || !sameQuery()) return;
      const grid = app.querySelector('#home-grid');
      if (!grid) return;
      const known = new Set(feed.map((l) => l.id));
      const fresh = page.listings.filter((l) => !known.has(l.id));
      feed = feed.concat(fresh);
      total = page.total;
      nextOffset = page.nextOffset;
      hasMore = page.hasMore && fresh.length > 0;
      if (fresh.length) grid.insertAdjacentHTML('beforeend', fresh.map((l) => listingCard(l)).join(''));
      if (!hasMore) moreBtn?.parentElement?.remove();
    } catch (err) {
      errToast(err, '載入更多失敗');
    } finally {
      loadingMore = false;
      if (pending) pending.hidden = true;
      if (moreBtn?.isConnected) moreBtn.disabled = false;
    }
  }

  function bindFeed() {
    app.querySelector('#home-more')?.addEventListener('click', () => {
      loadMore();
    });
    const screen = app.querySelector('.screen');
    screen?.addEventListener(
      'scroll',
      () => {
        if (screen.scrollTop + screen.clientHeight >= screen.scrollHeight - 280) loadMore();
      },
      { passive: true }
    );
  }

  const willFetch = getState().online && !ctx.rangeInvalid;
  const interactive = !options.forceSkeleton && Boolean(document.querySelector('.home-screen #search'));
  if (!interactive && willFetch && isView(token)) {
    paint({ loading: true, list: [], error: false });
  }

  let error = false;
  if (willFetch) {
    try {
      const page = await fetchHomeListings({
        q: ctx.q,
        category: ctx.cat,
        min: ctx.min,
        max: ctx.max,
        limit: HOME_PAGE,
        offset: 0,
      });
      feed = page.listings;
      total = page.total;
      hasMore = page.hasMore;
      nextOffset = page.nextOffset;
    } catch (err) {
      error = true;
      errToast(err, '載入刊登失敗');
      feed = getState().listings.filter((l) =>
        listingMatches(l, { q: ctx.q, category: ctx.cat, min: ctx.min, max: ctx.max })
      );
      total = feed.length;
      hasMore = false;
      nextOffset = feed.length;
    }
  }
  if (!isView(token)) return;
  if (!sameQuery()) return;
  paint({ loading: false, error, total });
}

const uiGallery = { id: '', index: 0 };
let offerSheetKeyHandler = null;
let rateSellerKeyHandler = null;
let rateSellerOnClose = null;

function offerSuggestions(price) {
  const ask = Number(price) || 0;
  if (ask <= 1) return [];
  const round = (n) => Math.max(1, Math.round(n));
  const rows = [
    { label: '九折', amount: round(ask * 0.9) },
    { label: '八五折', amount: round(ask * 0.85) },
    { label: '八折', amount: round(ask * 0.8) },
  ];
  const seen = new Set();
  return rows.filter((row) => {
    if (row.amount >= ask || seen.has(row.amount)) return false;
    seen.add(row.amount);
    return true;
  });
}

function offerDeltaText(ask, bid) {
  const offer = Number(bid);
  const price = Number(ask);
  if (!offer || offer <= 0) return '';
  const diff = price - offer;
  if (diff === 0) return '與標價相同';
  if (diff > 0) return `較標價低 ${money(diff)}`;
  return `高於標價 ${money(Math.abs(diff))}`;
}

function offerComposerHtml(l, { formId, submitInForm = false } = {}) {
  const suggestions = offerSuggestions(l.price);
  return `
    <form class="form offer-form" id="${formId}">
      <div class="field">
        <label for="${formId}-amount">你的出價（MOP）</label>
        <input id="${formId}-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" required placeholder="例如 ${Math.max(1, Math.round(Number(l.price) * 0.85))}" />
        <div class="offer-delta" data-offer-delta hidden></div>
        ${
          suggestions.length
            ? `<div class="suggest-row" role="group" aria-label="建議出價">
          ${suggestions
            .map(
              (s) =>
                `<button type="button" class="chip" data-suggest="${s.amount}">${escapeHtml(s.label)} · ${money(s.amount)}</button>`
            )
            .join('')}
        </div>`
            : ''
        }
      </div>
      <div class="field">
        <label>交收方式</label>
        <div class="chips tight">
          ${MEETUPS.map(
            (m, i) =>
              `<button type="button" class="chip ${i === 0 ? 'active' : ''}" data-meetup="${escapeAttr(m)}">${escapeHtml(m)}</button>`
          ).join('')}
        </div>
        <input type="hidden" name="meetup" value="${escapeAttr(MEETUPS[0])}" />
      </div>
      <div class="field">
        <label for="${formId}-message">留言（選填）</label>
        <textarea id="${formId}-message" name="message" lang="zh-Hant" inputmode="text" autocomplete="off" placeholder="什麼時候方便碰面？"></textarea>
      </div>
      ${submitInForm ? `<button class="btn primary" type="submit">送出出價</button>` : ''}
    </form>`;
}

function bindOfferForm(form, listing, { onSuccess } = {}) {
  if (!form) return;
  const amount = form.querySelector('[name="amount"]');
  const delta = form.querySelector('[data-offer-delta]');
  const meetupInput = form.querySelector('[name="meetup"]');
  const paintDelta = () => {
    if (!delta || !amount) return;
    const text = offerDeltaText(listing.price, amount.value);
    delta.hidden = !text;
    delta.textContent = text;
  };
  amount?.addEventListener('input', () => {
    form.querySelectorAll('[data-suggest]').forEach((btn) => {
      btn.classList.toggle('active', String(btn.dataset.suggest) === String(amount.value));
    });
    paintDelta();
  });
  form.querySelectorAll('[data-suggest]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!amount) return;
      amount.value = btn.dataset.suggest;
      form.querySelectorAll('[data-suggest]').forEach((b) => b.classList.toggle('active', b === btn));
      paintDelta();
      amount.focus();
    });
  });
  form.querySelectorAll('[data-meetup]').forEach((btn) => {
    btn.addEventListener('click', () => {
      form.querySelectorAll('[data-meetup]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (meetupInput) meetupInput.value = btn.dataset.meetup;
    });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const bid = Number(fd.get('amount'));
    if (!bid || bid <= 0) {
      toast('請輸入有效出價');
      return;
    }
    const buttons = [
      form.querySelector('[type="submit"]'),
      document.querySelector(`[type="submit"][form="${form.id}"]`),
    ].filter(Boolean);
    buttons.forEach((btn) => {
      btn.disabled = true;
    });
    try {
      const { thread, updated } = await addOffer({
        listingId: listing.id,
        amount: bid,
        meetup: String(fd.get('meetup') || MEETUPS[0]),
        message: String(fd.get('message') || '').trim(),
      });
      if (onSuccess) onSuccess(thread, { updated });
    } catch (err) {
      buttons.forEach((btn) => {
        btn.disabled = false;
      });
      if (err?.code === 'OFFER_ACCEPTED') {
        closeOfferSheet();
        go(`detail/${listing.id}`);
        toast(err.message || '賣家已接受出價');
        return;
      }
      if (err?.code === 'LISTING_SOLD') {
        closeOfferSheet();
        go(`detail/${listing.id}`);
        toast('此商品已售出');
        return;
      }
      errToast(err, '送出失敗，請再試');
    }
  });
}

function confirmAction({ title, message, confirmLabel = '確定', cancelLabel = '取消' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'offer-overlay';
    overlay.innerHTML = `
      <div class="offer-sheet confirm-sheet" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
        <div class="offer-sheet-head">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" class="offer-close" data-confirm="cancel" aria-label="關閉">×</button>
        </div>
        <p class="offer-ask">${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="btn ghost" type="button" data-confirm="cancel">${escapeHtml(cancelLabel)}</button>
          <button class="btn primary" type="button" data-confirm="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      document.body.classList.remove('offer-open');
      resolve(ok);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
    };
    document.body.appendChild(overlay);
    document.body.classList.add('offer-open');
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        finish(false);
        return;
      }
      const kind = e.target.closest('[data-confirm]')?.dataset.confirm;
      if (kind === 'cancel') finish(false);
      if (kind === 'ok') finish(true);
    });
    overlay.querySelector('[data-confirm="ok"]')?.focus();
  });
}

function closeOfferSheet() {
  document.querySelector('.offer-overlay')?.remove();
  document.body.classList.remove('offer-open');
  if (offerSheetKeyHandler) {
    document.removeEventListener('keydown', offerSheetKeyHandler);
    offerSheetKeyHandler = null;
  }
}

function openOfferSheet(l) {
  if (isSold(l) || l?.removed) return;
  if (!requireAuth(`detail/${l.id}`)) return;
  closeOfferSheet();
  const overlay = document.createElement('div');
  overlay.className = 'offer-overlay';
  overlay.innerHTML = `
    <div class="offer-sheet" role="dialog" aria-modal="true" aria-label="出價">
      <div class="offer-sheet-head">
        <h2>出價</h2>
        <button type="button" class="offer-close" aria-label="關閉">×</button>
      </div>
      <div class="product-strip">
        <div class="mini" style="background:${escapeAttr(l.tone || '')}">${thumbInner(l)}</div>
        <div class="info">
          <div class="title">${escapeHtml(l.title)}</div>
          <div class="meta">標價 ${money(l.price)}${l.negotiable ? ' · 可議' : ''}</div>
        </div>
      </div>
      <p class="offer-ask">標價 <strong>${money(l.price)}</strong> · 輸入你願意付的價錢</p>
      ${offerComposerHtml(l, { formId: 'offer-sheet-form', submitInForm: true })}
      <button type="button" class="offer-footnote" id="offer-history">查看出價紀錄</button>
      <p class="trust-note offer-trust-note">送出後先顯示待回覆，等賣家接受、拒絕或回價。平台不代收款、不代鑑定。</p>
      ${scamTipHtml('offer-scam-tip')}
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('offer-open');
  offerSheetKeyHandler = (e) => {
    if (e.key === 'Escape') closeOfferSheet();
  };
  document.addEventListener('keydown', offerSheetKeyHandler);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOfferSheet();
  });
  overlay.querySelector('.offer-close')?.addEventListener('click', closeOfferSheet);
  overlay.querySelector('#offer-history')?.addEventListener('click', () => {
    closeOfferSheet();
    go(`bargain/${l.id}`);
  });
  bindOfferForm(overlay.querySelector('#offer-sheet-form'), l, {
    onSuccess: (thread, { updated } = {}) => {
      closeOfferSheet();
      if (thread) go(`chat/${thread.id}`);
      else renderDetail(l.id);
      toast(updated ? '已更新出價，待賣家回覆' : '出價已送出，待賣家回覆');
    },
  });
  overlay.querySelector('[name="amount"]')?.focus();
}

function galleryHtml(l, photos) {
  const sold = isSold(l);
  const index = photos.length ? Math.min(uiGallery.index, photos.length - 1) : 0;
  if (!photos.length) {
    return `<div class="gallery ${sold ? 'sold' : ''}">
      <div class="gallery-stage" style="background:${escapeAttr(l.tone || '')}">
        <span class="emoji">${l.emoji || '📦'}</span>
        ${sold ? '<span class="sold-banner">已售</span>' : ''}
      </div>
    </div>`;
  }
  const src = mediaSrc(photos[index]);
  return `<div class="gallery ${sold ? 'sold' : ''}" id="gallery">
    <div class="gallery-stage" style="background:${escapeAttr(l.tone || '')}">
      <img class="hero-img" src="${escapeAttr(src)}" alt="" />
      ${sold ? '<span class="sold-banner">已售</span>' : ''}
      ${
        photos.length > 1
          ? `<button type="button" class="gallery-nav prev" data-photo-step="-1" aria-label="上一張">‹</button>
        <button type="button" class="gallery-nav next" data-photo-step="1" aria-label="下一張">›</button>
        <span class="gallery-count">${index + 1} / ${photos.length}</span>`
          : ''
      }
    </div>
    ${
      photos.length > 1
        ? `<div class="gallery-thumbs">
        ${photos
          .map(
            (p, i) =>
              `<button type="button" class="gallery-thumb ${i === index ? 'on' : ''}" data-photo="${i}" aria-label="第 ${i + 1} 張"><img src="${escapeAttr(mediaSrc(p))}" alt="" /></button>`
          )
          .join('')}
      </div>`
        : ''
    }
  </div>`;
}

function bindGallery(photos) {
  if (photos.length < 2) return;
  const root = app.querySelector('#gallery');
  if (!root) return;
  const show = (next) => {
    const len = photos.length;
    uiGallery.index = ((next % len) + len) % len;
    const img = root.querySelector('.hero-img');
    if (img) img.src = mediaSrc(photos[uiGallery.index]);
    const count = root.querySelector('.gallery-count');
    if (count) count.textContent = `${uiGallery.index + 1} / ${len}`;
    root.querySelectorAll('.gallery-thumb').forEach((btn, i) => {
      btn.classList.toggle('on', i === uiGallery.index);
    });
  };
  root.querySelectorAll('[data-photo-step]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      show(uiGallery.index + Number(btn.dataset.photoStep));
    });
  });
  root.querySelectorAll('[data-photo]').forEach((btn) => {
    btn.addEventListener('click', () => show(Number(btn.dataset.photo)));
  });
  const stage = root.querySelector('.gallery-stage');
  let startX = null;
  stage?.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.gallery-nav')) return;
    startX = e.clientX;
  });
  stage?.addEventListener('pointerup', (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) < 36) return;
    show(uiGallery.index + (dx < 0 ? 1 : -1));
  });
  stage?.addEventListener('pointercancel', () => {
    startX = null;
  });
}

function offerStatusView(offer, role) {
  const status = offer?.status || 'pending';
  const amount = Number(offer?.amount);
  const counter = offer?.counterAmount != null && offer.counterAmount !== '' ? Number(offer.counterAmount) : null;
  const agreed =
    offer?.agreedAmount != null && offer.agreedAmount !== ''
      ? Number(offer.agreedAmount)
      : status === 'accepted'
        ? amount
        : null;
  if (status === 'accepted') {
    return { status, label: '已接受', detail: `議定 ${money(agreed)}`, sub: '見面安排在下面 · 平台不代收款' };
  }
  if (status === 'cancelled') {
    const detail =
      role === 'buyer' ? '你已取消這筆出價' : role === 'seller' ? '買家已取消這筆出價' : '這筆出價已取消';
    return { status, label: '已取消', detail, sub: `出價 ${money(amount)}` };
  }
  if (status === 'rejected') {
    return { status, label: '已拒絕', detail: '這筆未談成', sub: `出價 ${money(amount)}` };
  }
  if (status === 'countered' && counter) {
    return {
      status,
      label: '回價',
      detail: `賣家回價 ${money(counter)}`,
      sub: role === 'seller' ? `買家出價 ${money(amount)}` : role === 'buyer' ? `你的出價 ${money(amount)}` : `出價 ${money(amount)}`,
    };
  }
  if (role === 'buyer') {
    return { status: 'pending', label: '待回覆', detail: `你的出價 ${money(amount)}`, sub: '等賣家回覆' };
  }
  if (role === 'seller') {
    return { status: 'pending', label: '待回覆', detail: `買家出價 ${money(amount)}`, sub: '等你回覆' };
  }
  return { status: 'pending', label: '待回覆', detail: `出價 ${money(amount)}`, sub: '' };
}

function statusPill(offer) {
  const view = offerStatusView(offer, 'other');
  return `<span class="pill status-${view.status}">${view.label}</span>`;
}

function offerPartyRole(offer, listing, meId) {
  if (!offer || !meId) return 'other';
  if (listing?.sellerId === meId) return 'seller';
  if (offer.fromId === meId) return 'buyer';
  return 'other';
}

function offerBarHtml(offer, role) {
  if (!offer) return '';
  const status = offer.status || 'pending';
  const attrs = `data-offer-id="${escapeAttr(offer.id)}" data-offer-role="${escapeAttr(role)}"`;
  if (role === 'seller' && status === 'pending') {
    return `
      <button class="btn primary" type="button" data-offer-action="accept" ${attrs}>接受出價</button>
      <button class="btn ghost" type="button" data-offer-action="reject" ${attrs}>拒絕</button>
      <button class="btn ghost" type="button" data-offer-action="counter-toggle" ${attrs}>回價</button>`;
  }
  if (role === 'seller' && status === 'countered') {
    return `
      <button class="btn primary" type="button" data-offer-action="accept" ${attrs}>接受原出價</button>
      <button class="btn ghost" type="button" data-offer-action="reject" ${attrs}>拒絕</button>
      <button class="btn ghost" type="button" data-offer-action="counter-toggle" ${attrs}>改回價</button>`;
  }
  if (role === 'buyer' && status === 'countered') {
    return `
      <button class="btn primary" type="button" data-offer-action="accept" ${attrs}>接受回價</button>
      <button class="btn ghost" type="button" data-offer-action="reject" ${attrs}>不接受</button>`;
  }
  return '';
}

function offerStatusHtml(offer, { role, showThreadLink = true, showButtons = true } = {}) {
  if (!offer) return '';
  const view = offerStatusView(offer, role);
  const open = view.status === 'pending' || view.status === 'countered';
  const actions = [];
  if (showButtons && role === 'seller' && view.status === 'pending') {
    actions.push('<button type="button" class="btn primary" data-offer-action="accept">接受出價</button>');
    actions.push('<button type="button" class="btn ghost" data-offer-action="reject">拒絕</button>');
    actions.push('<button type="button" class="btn ghost" data-offer-action="counter-toggle">回價</button>');
  } else if (showButtons && role === 'seller' && view.status === 'countered') {
    actions.push('<button type="button" class="btn primary" data-offer-action="accept">接受原出價</button>');
    actions.push('<button type="button" class="btn ghost" data-offer-action="reject">拒絕</button>');
    actions.push('<button type="button" class="btn ghost" data-offer-action="counter-toggle">改回價</button>');
  } else if (showButtons && role === 'buyer' && view.status === 'countered') {
    actions.push('<button type="button" class="btn primary" data-offer-action="accept">接受回價</button>');
    actions.push('<button type="button" class="btn ghost" data-offer-action="reject">不接受</button>');
  } else if (showButtons && role === 'buyer' && view.status === 'pending') {
    actions.push('<button type="button" class="btn ghost" data-offer-action="cancel">取消出價</button>');
  }
  const counterForm =
    role === 'seller' && open
      ? `<form class="offer-counter-form" hidden>
          <input name="counterAmount" type="number" min="1" step="1" inputmode="numeric" placeholder="回價（MOP）" aria-label="回價" required />
          <input name="counterMessage" type="text" maxlength="120" placeholder="一句話（選填）" aria-label="回價留言" />
          <button class="btn primary" type="submit">送出回價</button>
        </form>`
      : '';
  const link =
    showThreadLink && offer.threadId
      ? `<button type="button" class="text-link" data-go="chat/${escapeAttr(offer.threadId)}">查看對話</button>`
      : '';
  const who = role === 'seller' && offer.fromName ? `<div class="offer-status-name">${escapeHtml(offer.fromName)}</div>` : '';
  const extra =
    offer.counterMessage && view.status === 'countered'
      ? `<div class="meta">${escapeHtml(offer.counterMessage)}</div>`
      : '';
  const place = offer.meetup
    ? `<div class="meta">${escapeHtml(offer.meetup)}${offer.message ? ` · ${escapeHtml(offer.message)}` : ''}</div>`
    : '';
  return `
    <div class="offer-status" data-offer-id="${escapeAttr(offer.id)}" data-offer-role="${escapeAttr(role)}">
      <div class="offer-status-top">
        <span class="pill status-${view.status}">${view.label}</span>
        ${link}
      </div>
      ${who}
      <div class="offer-status-detail">${escapeHtml(view.detail)}</div>
      ${view.sub ? `<div class="meta">${escapeHtml(view.sub)}</div>` : ''}
      ${extra}
      ${place}
      ${actions.length ? `<div class="offer-actions">${actions.join('')}</div>` : ''}
      ${counterForm}
      ${handoffCardHtml(offer, role)}
    </div>`;
}

function handoffCardHtml(offer, role) {
  if (!offer?.canHandoff || (role !== 'buyer' && role !== 'seller')) return '';
  const h = offer.handoff;
  const meId = getState().me?.id || '';
  const mineOk = h ? (role === 'buyer' ? h.buyerOk : h.sellerOk) : false;
  const placeId = h?.placeId || 'senado';
  const whenValue = h?.when || defaultMeetWhen();
  let statusLine = '尚未約定。選一個公眾地標，或填自訂地點。對方確認後才算數。';
  if (h?.status === 'confirmed') statusLine = '雙方已確認。若要更改，對方需要再確認一次。';
  else if (h && h.proposedBy === meId) statusLine = '你已提議，等對方確認。';
  else if (h) statusLine = '對方提議了這個時間地點。你可以確認，或改一個。';
  const summary = h
    ? `<div class="handoff-summary"><strong>${escapeHtml(h.whenLabel || h.when || '')}</strong><span>${escapeHtml(h.place || '')}</span>${
        h.note ? `<span class="meta">${escapeHtml(h.note)}</span>` : ''
      }</div>`
    : '';
  const confirmBtn =
    h && !mineOk
      ? `<button class="btn ghost" type="button" data-handoff-confirm>確認這個安排</button>`
      : '';
  return `
    <form class="handoff-card" data-handoff-offer="${escapeAttr(offer.id)}">
      <div class="handoff-kicker">見面時間／地點</div>
      <p class="handoff-status">${escapeHtml(statusLine)}</p>
      ${summary}
      <div class="chips tight handoff-places">
        ${MEET_PLACES.map(
          (p) =>
            `<button type="button" class="chip ${p.id === placeId ? 'active' : ''}" data-place="${escapeAttr(p.id)}">${escapeHtml(p.label)}</button>`
        ).join('')}
      </div>
      <input type="hidden" name="placeId" value="${escapeAttr(placeId)}" />
      <div class="field handoff-custom" ${placeId === 'custom' ? '' : 'hidden'}>
        <label>自訂地點</label>
        <input name="customPlace" maxlength="40" lang="zh-Hant" autocomplete="off" placeholder="公眾地方，例如某個路口" value="${escapeAttr(h?.customPlace || '')}" />
        <p class="photo-hint">請選公眾地方，唔好約在住所。</p>
      </div>
      <div class="field">
        <label for="handoff-when-${escapeAttr(offer.id)}">見面時間（澳門）</label>
        <input id="handoff-when-${escapeAttr(offer.id)}" name="when" type="datetime-local" required value="${escapeAttr(whenValue)}" />
      </div>
      <div class="field">
        <label>一句補充（選填）</label>
        <input name="note" maxlength="80" lang="zh-Hant" autocomplete="off" placeholder="例如：我會穿黑衫" value="${escapeAttr(h?.note || '')}" />
      </div>
      <div class="handoff-actions">
        <button class="btn primary" type="submit">${h ? '更新見面安排' : '提議這個安排'}</button>
        ${confirmBtn}
      </div>
      ${scamTipHtml()}
    </form>`;
}

function offerActionToast(role, action) {
  if (action === 'cancel') return '已取消出價';
  if (action === 'counter') return '回價已送出';
  if (action === 'accept') return role === 'buyer' ? '已接受回價' : '已接受出價';
  return role === 'buyer' ? '未接受回價' : '已拒絕這筆出價';
}

function bindOfferStatus(root, { onDone } = {}) {
  if (!root) return;

  const run = async (source, payload) => {
    const offerId = source?.dataset.offerId;
    const role = source?.dataset.offerRole || 'other';
    if (!offerId) return;
    const scope = source.classList?.contains('offer-status') ? source : source.closest('.actionbar') || source;
    const buttons = scope.querySelectorAll('button');
    buttons.forEach((btn) => {
      btn.disabled = true;
    });
    try {
      await respondToOffer(offerId, payload);
      toast(offerActionToast(role, payload.action));
      if (onDone) await onDone();
    } catch (err) {
      buttons.forEach((btn) => {
        btn.disabled = false;
      });
      errToast(err, '更新失敗');
    }
  };

  const toggleCounter = (btn) => {
    const host = btn.closest('.offer-status');
    const offerId = host?.dataset.offerId || btn.dataset.offerId;
    const card = host || root.querySelector(`.offer-status[data-offer-id="${offerId}"]`);
    const form = card?.querySelector('.offer-counter-form');
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) {
      form.scrollIntoView({ block: 'center' });
      form.querySelector('[name="counterAmount"]')?.focus();
    }
  };

  root.querySelectorAll('[data-offer-action="counter-toggle"]').forEach((btn) => {
    btn.addEventListener('click', () => toggleCounter(btn));
  });

  root.querySelectorAll('.offer-status').forEach((card) => {
    card.querySelectorAll(
      '[data-offer-action="accept"], [data-offer-action="reject"], [data-offer-action="cancel"]'
    ).forEach((btn) => {
      btn.addEventListener('click', () => run(card, { action: btn.dataset.offerAction }));
    });
    card.querySelector('.offer-counter-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const counterAmount = Number(fd.get('counterAmount'));
      if (!counterAmount || counterAmount <= 0) {
        toast('請輸入有效回價');
        return;
      }
      run(card, {
        action: 'counter',
        counterAmount,
        counterMessage: String(fd.get('counterMessage') || '').trim(),
      });
    });
  });

  root
    .querySelectorAll(
      '.actionbar [data-offer-action="accept"], .actionbar [data-offer-action="reject"], .actionbar [data-offer-action="cancel"]'
    )
    .forEach((btn) => {
      btn.addEventListener('click', () => run(btn, { action: btn.dataset.offerAction }));
    });

  root.querySelectorAll('.handoff-card').forEach((form) => {
    const placeInput = form.querySelector('[name="placeId"]');
    const customWrap = form.querySelector('.handoff-custom');
    const customInput = form.querySelector('[name="customPlace"]');
    const syncPlace = () => {
      const customOn = placeInput?.value === 'custom';
      if (customWrap) customWrap.hidden = !customOn;
      if (customInput) customInput.required = customOn;
    };
    form.querySelectorAll('[data-place]').forEach((btn) => {
      btn.addEventListener('click', () => {
        form.querySelectorAll('[data-place]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (placeInput) placeInput.value = btn.dataset.place;
        syncPlace();
      });
    });
    syncPlace();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const offerId = form.dataset.handoffOffer;
      const fd = new FormData(form);
      const buttons = form.querySelectorAll('button');
      buttons.forEach((btn) => {
        btn.disabled = true;
      });
      try {
        await saveHandoff(offerId, {
          placeId: String(fd.get('placeId') || ''),
          customPlace: String(fd.get('customPlace') || '').trim(),
          when: String(fd.get('when') || ''),
          note: String(fd.get('note') || '').trim(),
        });
        toast('已送出見面提議');
        if (onDone) await onDone();
      } catch (err) {
        buttons.forEach((btn) => {
          btn.disabled = false;
        });
        errToast(err, '未能送出見面安排');
      }
    });
    form.querySelector('[data-handoff-confirm]')?.addEventListener('click', async () => {
      const offerId = form.dataset.handoffOffer;
      const button = form.querySelector('[data-handoff-confirm]');
      if (button) button.disabled = true;
      try {
        await confirmHandoff(offerId);
        toast('已確認見面安排');
        if (onDone) await onDone();
      } catch (err) {
        if (button) button.disabled = false;
        errToast(err, '未能確認');
      }
    });
  });
}

function starMarks(count) {
  const n = Math.max(0, Math.min(5, Math.round(Number(count) || 0)));
  return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
}

function starPickerHtml() {
  return `<div class="star-row" role="radiogroup" aria-label="星數">
    ${[1, 2, 3, 4, 5]
      .map((n) => `<button type="button" class="star" data-star="${n}" aria-label="${n} 星">☆</button>`)
      .join('')}
  </div>`;
}

function reviewCommentField(id) {
  return `<label class="review-comment" for="${id}">留言（可留空）</label>
    <textarea id="${id}" lang="zh-Hant" maxlength="80" placeholder="交收順利嗎？一句就好，最多 80 字"></textarea>`;
}

function reviewBlock(listing) {
  if (!listing?.sold) return '';
  const reviews = Array.isArray(listing.reviews) ? listing.reviews : [];
  const list = reviews.length
    ? reviews
        .map(
          (r) => `
        <div class="review">
          <div class="review-top">
            <span>${starMarks(r.stars)}</span>
            <span class="meta">${escapeHtml(r.fromName || '街坊')}${r.time ? ` · ${escapeHtml(r.time)}` : ''}</span>
          </div>
          ${r.text ? `<p>${escapeHtml(r.text)}</p>` : ''}
        </div>`
        )
        .join('')
    : '<p class="meta">這筆還沒有街坊評價</p>';
  const form = listing.canReview
    ? `<div class="review-box" id="review-box">
        <div class="section-label">${listing.reviewRole === 'seller' ? '為這位買家留一句評價' : '為這位賣家留一句評價'}</div>
        ${starPickerHtml()}
        ${reviewCommentField('review-text')}
        <button class="btn primary" type="button" id="review-submit">送出評價</button>
        <p class="trust-footnote">這是你與對方的一句話，不是平台鑑定。</p>
      </div>`
    : listing.myReview
      ? '<p class="meta">你已留過評價</p>'
      : '';
  return `<div class="offer-block">
      <div class="section-label">這筆交收</div>
      ${list}
      ${form}
    </div>`;
}

function bindStarForm(root, { textSelector, submitSelector, onSubmit }) {
  let picked = 0;
  const stars = [...root.querySelectorAll('[data-star]')];
  stars.forEach((btn) => {
    btn.addEventListener('click', () => {
      picked = Number(btn.dataset.star);
      stars.forEach((star) => {
        const on = Number(star.dataset.star) <= picked;
        star.classList.toggle('on', on);
        star.textContent = on ? '★' : '☆';
      });
    });
  });
  const button = root.querySelector(submitSelector);
  button?.addEventListener('click', async () => {
    if (!picked) {
      toast('請先選星數');
      return;
    }
    const text = String(root.querySelector(textSelector)?.value || '').trim();
    if (Array.from(text).length > 80) {
      toast('評價最多 80 字');
      return;
    }
    if (button) button.disabled = true;
    try {
      await onSubmit({ stars: picked, text });
    } catch (err) {
      if (button) button.disabled = false;
      errToast(err, '評價送出失敗');
    }
  });
}

function bindReviewForm(listing, onDone) {
  const box = app.querySelector('#review-box');
  if (!box) return;
  bindStarForm(box, {
    textSelector: '#review-text',
    submitSelector: '#review-submit',
    onSubmit: async ({ stars, text }) => {
      await addReview(listing.id, { stars, text });
      toast('已送出評價');
      if (onDone) onDone();
    },
  });
}

function closeRateSellerModal({ notify = false, reviewed = false } = {}) {
  document.querySelector('.rate-seller-overlay')?.remove();
  if (!document.querySelector('.offer-overlay')) document.body.classList.remove('offer-open');
  if (rateSellerKeyHandler) {
    document.removeEventListener('keydown', rateSellerKeyHandler);
    rateSellerKeyHandler = null;
  }
  const done = rateSellerOnClose;
  rateSellerOnClose = null;
  if (notify && done) done({ reviewed });
}

function openRateSellerModal(listing, { onClose } = {}) {
  closeOfferSheet();
  closeRateSellerModal();
  rateSellerOnClose = onClose || null;
  const sellerName = listing?.sellerName || '賣家';
  const overlay = document.createElement('div');
  overlay.className = 'rate-seller-overlay';
  overlay.innerHTML = `
    <div class="offer-sheet rate-seller-sheet" role="dialog" aria-modal="true" aria-labelledby="rate-seller-title">
      <div class="offer-sheet-head">
        <h2 id="rate-seller-title">交易完成！想為賣家留下好評嗎？</h2>
        <button type="button" class="offer-close" aria-label="關閉">×</button>
      </div>
      <div class="rate-seller-body">
        <p class="meta">賣家 ${escapeHtml(sellerName)} · 星數必填，留言可留空</p>
        <div class="section-label">星數</div>
        ${starPickerHtml()}
        ${reviewCommentField('rate-text')}
        <button class="btn primary" type="button" id="rate-submit">送出評價</button>
        <button class="btn ghost" type="button" id="rate-later">稍後再說</button>
        <p class="trust-footnote">這是你與賣家的一句話，不是平台鑑定。</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('offer-open');
  const dismiss = () => closeRateSellerModal({ notify: true, reviewed: false });
  rateSellerKeyHandler = (e) => {
    if (e.key === 'Escape') dismiss();
  };
  document.addEventListener('keydown', rateSellerKeyHandler);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
  overlay.querySelector('.offer-close')?.addEventListener('click', dismiss);
  overlay.querySelector('#rate-later')?.addEventListener('click', dismiss);
  bindStarForm(overlay, {
    textSelector: '#rate-text',
    submitSelector: '#rate-submit',
    onSubmit: async ({ stars, text }) => {
      await addReview(listing.id, { stars, text });
      toast('已送出評價');
      closeRateSellerModal({ notify: true, reviewed: true });
    },
  });
  overlay.querySelector('.star')?.focus();
}

function shareCancelled(err) {
  const name = String(err?.name || '');
  const message = String(err?.message || err || '');
  return name === 'AbortError' || /cancel/i.test(message);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function openShareFallback(root, payload) {
  const sheet = root.querySelector('#share-fallback');
  if (!sheet) return;
  const lead = sheet.querySelector('[data-share-lead]');
  const urlEl = sheet.querySelector('[data-share-url]');
  if (lead) lead.textContent = payload.preview;
  if (urlEl) urlEl.textContent = payload.url;
  sheet.hidden = false;
}

function bindListingShare(root, listing) {
  const payload = listingSharePayload(listing, window.location);
  root.querySelector('#share-listing')?.addEventListener('click', async () => {
    try {
      const { Share } = await import('@capacitor/share');
      const can = await Share.canShare();
      if (can?.value) {
        await Share.share({
          title: payload.title,
          text: payload.text,
          url: payload.url,
          dialogTitle: payload.dialogTitle,
        });
        return;
      }
    } catch (err) {
      if (shareCancelled(err)) return;
    }
    openShareFallback(root, payload);
  });

  const sheet = root.querySelector('#share-fallback');
  sheet?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-share]');
    if (!btn) {
      if (e.target === sheet) sheet.hidden = true;
      return;
    }
    const kind = btn.dataset.share;
    if (kind === 'close') {
      sheet.hidden = true;
      return;
    }
    if (kind === 'copy') {
      const ok = await copyText(payload.url);
      toast(ok ? '已複製連結' : '無法複製，請長按連結');
      return;
    }
    const href =
      kind === 'whatsapp'
        ? `https://wa.me/?text=${encodeURIComponent(payload.text)}`
        : kind === 'facebook'
          ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(payload.url)}`
          : '';
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  });
}

async function renderDetail(id, token = nextView()) {
  const state = getState();
  let l = getListing(id);
  if (state.online) {
    try {
      l = await refreshListing(id);
    } catch {
      /* use cache */
    }
  }
  if (!isView(token)) return;
  if (!l) {
    go('home');
    return;
  }
  if (l.removed) {
    const thread = getThreadByListing(l.id);
    const content = `
      <header class="topbar">
        <button class="back" type="button" data-go="home" aria-label="返回">←</button>
        <h1>商品詳情</h1>
      </header>
      <section class="price-block">
        <h2>${escapeHtml(l.title || '商品')}</h2>
        <p class="desc">這件刊登已移除，不再公開。之前的對話仍然保留。</p>
      </section>
      ${
        thread?.id
          ? `<div class="actionbar"><button class="btn primary" type="button" data-go="chat/${escapeAttr(thread.id)}">查看對話</button></div>`
          : ''
      }`;
    app.innerHTML = shell(content, { noTab: true, screenClass: thread?.id ? 'docked' : '' });
    return;
  }
  if (uiGallery.id !== id) {
    uiGallery.id = id;
    uiGallery.index = 0;
  }
  const sold = isSold(l);
  const isSeller = isLoggedIn() && l.sellerId === state.me.id;
  const wanted = state.wants.includes(l.id);
  const photos = Array.isArray(l.photos) ? l.photos.filter(Boolean) : [];
  const offers = getOffersForListing(l.id);
  const myOffer = isLoggedIn() ? offers.find((o) => o.fromId === state.me.id) : null;
  const thread = myOffer?.threadId ? { id: myOffer.threadId } : getThreadByListing(l.id);
  const isOpenOffer = (o) => o && (o.status === 'pending' || o.status === 'countered' || !o.status);
  const sellerBarOffer = isSeller ? offers.find(isOpenOffer) : null;
  const buyerBar = !isSeller && !sold && myOffer?.status === 'countered';
  const buyerWaiting = !isSeller && !sold && myOffer && (myOffer.status === 'pending' || !myOffer.status);
  const responseBar = sellerBarOffer
    ? offerBarHtml(sellerBarOffer, 'seller')
    : buyerBar
      ? offerBarHtml(myOffer, 'buyer')
      : '';
  const meId = isLoggedIn() ? state.me.id : '';
  const acceptedMine = Boolean(myOffer && myOffer.fromId === meId && myOffer.status === 'accepted');
  const canRateSeller = Boolean(sold && meId && l.buyerId === meId && l.canReview && l.reviewRole === 'buyer');
  const showReceipt = Boolean(meId && !isSeller && !l.myReview && ((!sold && acceptedMine) || canRateSeller));
  const receiptSecondary = thread?.id
    ? `<button class="btn ghost" type="button" id="go-thread">查看對話</button>`
    : !sold
      ? `<button class="btn ghost" type="button" id="want">${wanted ? '已收藏' : '收藏'}</button>`
      : '';

  const dmButton = isSeller
    ? ''
    : `<button class="btn ghost" type="button" id="dm-seller">私訊</button>`;

  const actionButtons = responseBar
    ? `${responseBar}${dmButton}`
    : isSeller
      ? `
      <button class="btn ${sold ? 'ghost' : 'primary'}" type="button" id="toggle-sold">
        ${sold ? '取消已售出' : '標示為已售出'}
      </button>
      <button class="btn ghost" type="button" data-go="mine">我的刊登</button>`
      : showReceipt
        ? `
      <button class="btn primary" type="button" id="confirm-receipt">${sold ? '為賣家評分' : '確認收貨'}</button>
      ${dmButton}
      ${receiptSecondary}`
        : sold
          ? `
      <button class="btn primary" type="button" disabled aria-disabled="true">已售出</button>
      ${dmButton}
      <button class="btn ghost" type="button" disabled aria-disabled="true">收藏</button>`
          : myOffer?.status === 'accepted'
            ? `
      <button class="btn primary" type="button" id="go-thread">查看對話</button>
      ${dmButton}
      <button class="btn ghost" type="button" id="want">${wanted ? '已收藏' : '收藏'}</button>`
            : `
      ${
        buyerWaiting
          ? `<button class="btn ghost" type="button" data-offer-action="cancel" data-offer-id="${escapeAttr(myOffer.id)}" data-offer-role="buyer">取消出價</button>`
          : ''
      }
      <button class="btn primary" type="button" id="go-bargain">${
        !myOffer ? '議價' : myOffer.status === 'pending' || !myOffer.status ? '更新出價' : '再出價'
      }</button>
      ${dmButton}
      <button class="btn ghost" type="button" id="want">${wanted ? '已收藏' : '收藏'}</button>`;

  const offerNote = myOffer
    ? `<div class="offer-block">
        <div class="section-label">我的議價</div>
        ${offerStatusHtml(myOffer, { role: 'buyer', showButtons: !buyerBar && !buyerWaiting })}
        ${
          (myOffer.status === 'rejected' || myOffer.status === 'cancelled') && !sold
            ? `<button type="button" class="text-link offer-again" id="my-offer-link">再出價</button>`
            : ''
        }
      </div>`
    : '';
  const sellerOffers = isSeller
    ? `<div class="offer-block" id="seller-offers">
        <div class="section-label">收到的出價</div>
        ${
          sellerBarOffer
            ? `<button type="button" class="text-link offer-again" id="toggle-sold">${sold ? '取消已售出' : '標示為已售出'}</button>`
            : ''
        }
        ${
          offers.length
            ? offers
                .map((o) =>
                  offerStatusHtml(o, {
                    role: 'seller',
                    showButtons: !sellerBarOffer || o.id !== sellerBarOffer.id,
                  })
                )
                .join('')
            : '<div class="empty offer-empty">尚未收到出價</div>'
        }
      </div>`
    : '';

  const content = `
    <div class="dock-scroll">
    <header class="topbar">
      <button class="back" type="button" data-go="home" aria-label="返回">←</button>
      <h1>商品詳情</h1>
      <button class="topbar-share" type="button" id="share-listing">分享</button>
    </header>
    ${galleryHtml(l, photos)}
    <section class="price-block">
      <div class="price-row">
        ${priceHtml(l.price, sold)}
        ${sold ? '<span class="pill sold">已售</span>' : ''}
      </div>
      <h2>${escapeHtml(l.title)}</h2>
      ${isSeller ? `<button class="text-link listing-edit" type="button" data-go="edit/${escapeAttr(l.id)}">編輯刊登</button>` : ''}
      <div class="trust-row">${trustHtml(l)}</div>
      <p class="trust-note">鄰里二手 · 成色由賣家自行標示。平台不提供鑑定，也不代為寄倉。</p>
    </section>
    ${offerNote}
    ${sellerOffers}
    <section class="detail-body">
      <div class="meta">${escapeHtml(l.location)} · ${escapeHtml(l.category)}</div>
      <div class="section-label">說明</div>
      <p class="desc">${escapeHtml(l.description)}</p>
      <div class="section-label">賣家</div>
      <button class="seller-card" type="button" data-go="user/${escapeAttr(l.sellerId)}">
        ${avatarHtml(l.sellerAvatar)}
        <div class="seller-card-body">
          <div class="name-row">
            <span class="name">${escapeHtml(l.sellerName)}</span>
          </div>
          <div class="meta">${escapeHtml(l.sellerBio || '街坊賣家')}</div>
          ${trustLines(l.sellerTrust)}
        </div>
      </button>
      <p class="trust-footnote">${TRUST_FOOTNOTE}</p>
      ${reviewBlock(l)}
    </section>
    </div>
    <div class="actionbar">
      ${actionButtons}
    </div>
    <div class="share-fallback" id="share-fallback" hidden>
      <div class="share-fallback-card" role="dialog" aria-label="分享">
        <p class="share-fallback-lead" data-share-lead></p>
        <p class="share-fallback-url" data-share-url></p>
        <button class="btn ghost" type="button" data-share="copy">複製連結</button>
        <button class="btn ghost" type="button" data-share="whatsapp">WhatsApp</button>
        <button class="btn ghost" type="button" data-share="facebook">Facebook</button>
        <button class="btn primary" type="button" data-share="close">取消</button>
      </div>
    </div>`;

  app.innerHTML = shell(content, { noTab: true, screenClass: 'docked' });
  bindGallery(photos);
  bindListingShare(app, l);
  bindOfferStatus(app, { onDone: () => renderDetail(id) });
  app.querySelector('#go-bargain')?.addEventListener('click', () => openOfferSheet(l));
  app.querySelector('#dm-seller')?.addEventListener('click', async () => {
    if (!requireAuth(`detail/${l.id}`)) return;
    const button = app.querySelector('#dm-seller');
    if (button) button.disabled = true;
    try {
      const thread = await openListingThread(l.id);
      if (!thread?.id) {
        if (button) button.disabled = false;
        toast('無法開啟私訊');
        return;
      }
      go(`chat/${thread.id}`);
    } catch (err) {
      if (button) button.disabled = false;
      errToast(err, '無法開啟私訊');
    }
  });
  app.querySelector('#go-thread')?.addEventListener('click', () => {
    if (thread?.id) go(`chat/${thread.id}`);
    else go('bargains');
  });
  app.querySelector('#my-offer-link')?.addEventListener('click', () => {
    if (thread && myOffer?.status !== 'rejected' && myOffer?.status !== 'cancelled') go(`chat/${thread.id}`);
    else openOfferSheet(l);
  });
  app.querySelector('#want')?.addEventListener('click', async () => {
    if (isSold(l)) return;
    if (!requireAuth(`detail/${l.id}`)) return;
    try {
      if (getState().wants.includes(l.id)) {
        await removeWant(l.id);
        toast('已從收藏移除');
      } else {
        await addWant(l.id);
        toast('已加入收藏');
      }
      renderDetail(id);
    } catch (err) {
      errToast(err);
    }
  });
  bindReviewForm(l, () => renderDetail(id));
  app.querySelector('#confirm-receipt')?.addEventListener('click', async () => {
    if (!requireAuth(`detail/${l.id}`)) return;
    const button = app.querySelector('#confirm-receipt');
    if (button) button.disabled = true;
    const wasSold = isSold(l);
    try {
      if (!wasSold) await confirmReceipt(l.id);
      const fresh = getListing(l.id) || l;
      if (!fresh.canReview || fresh.reviewRole !== 'buyer') {
        toast(wasSold ? '這筆暫時不能評價' : '已確認收貨');
        renderDetail(id);
        return;
      }
      openRateSellerModal(fresh, {
        onClose: ({ reviewed } = {}) => {
          if (!wasSold && !reviewed) toast('已確認收貨，評價可以稍後再留');
          renderDetail(id);
        },
      });
    } catch (err) {
      if (button) button.disabled = false;
      errToast(err, '確認收貨失敗');
    }
  });
  app.querySelector('#toggle-sold')?.addEventListener('click', async () => {
    try {
      await setSold(l.id, !isSold(l));
      toast(isSold(getListing(l.id)) ? '已標示為已售出' : '已取消已售出');
      renderDetail(id);
    } catch (err) {
      errToast(err);
    }
  });
}

async function renderBargain(id, token = nextView()) {
  if (!requireAuth(`bargain/${id}`)) return;
  let l = getListing(id);
  try {
    l = await refreshListing(id);
  } catch (err) {
    errToast(err);
  }
  if (!isView(token)) return;
  if (!l) {
    go('home');
    return;
  }
  if (isSold(l) || l.removed) {
    go(`detail/${l.id}`);
    if (l.removed) toast('這件刊登已移除');
    else toast('此商品已售出');
    return;
  }
  if (isLoggedIn() && l.sellerId === getState().me.id) {
    go(`detail/${l.id}`);
    toast('這是你的刊登');
    return;
  }
  const offers = getOffersForListing(id);
  const content = `
    <div class="dock-scroll">
    <header class="topbar">
      <button class="back" type="button" data-go="detail/${l.id}" aria-label="返回">←</button>
      <h1>出價</h1>
    </header>
    <div class="product-strip">
      <div class="mini" style="background:${escapeAttr(l.tone || '')}">${thumbInner(l)}</div>
      <div class="info">
        <div class="title">${escapeHtml(l.title)}</div>
        <div class="meta">標價 ${money(l.price)}${l.negotiable ? ' · 可議' : ''}</div>
      </div>
    </div>
    <div class="bargain-trust">${trustHtml(l)}</div>
    ${scamTipHtml('bargain-tip')}
    ${offerComposerHtml(l, { formId: 'offer-form', submitInForm: false })}
    <div class="offer-list">
      <h3>出價紀錄</h3>
      ${
        offers.length
          ? offers
              .map(
                (o) => `
        <div class="offer">
          <div class="row">
            <span>${escapeHtml(o.fromName)}</span>
            <span class="amount">${money(o.status === 'countered' && o.counterAmount ? o.counterAmount : o.agreedAmount || o.amount)}</span>
          </div>
          <div class="offer-row-status">${statusPill(o)}${o.status === 'countered' ? `<span class="meta">回價 · 原出價 ${money(o.amount)}</span>` : ''}</div>
          <div class="meta">${escapeHtml(o.meetup)}${o.message ? ` · ${escapeHtml(o.message)}` : ''}</div>
        </div>`
              )
              .join('')
          : `<div class="empty" style="padding:16px 0">還沒有出價，輸入金額做第一個</div>`
      }
    </div>
    </div>
    <div class="actionbar">
      <button class="btn ghost" type="button" data-go="detail/${l.id}">取消</button>
      <button class="btn primary" type="submit" form="offer-form">送出出價</button>
    </div>`;

  app.innerHTML = shell(content, { noTab: true, screenClass: 'docked' });
  bindOfferForm(app.querySelector('#offer-form'), l, {
    onSuccess: (thread, { updated } = {}) => {
      if (thread) go(`chat/${thread.id}`);
      else renderBargain(id);
      toast(updated ? '已更新出價，待賣家回覆' : '出價已送出，待賣家回覆');
    },
  });
}

async function renderPost(token = nextView(), listingId = '') {
  const editing = Boolean(listingId);
  if (!requireAuth(editing ? `edit/${listingId}` : 'post')) return;
  let existing = null;
  if (editing) {
    app.innerHTML = shell(`<header class="topbar"><h1>編輯刊登</h1></header>${skeletonGrid()}`, { tab: 'me' });
    try {
      existing = await refreshListing(listingId);
    } catch (err) {
      existing = getListing(listingId) || null;
      if (!existing) {
        if (!isView(token)) return;
        go('mine');
        errToast(err, '載入刊登失敗');
        return;
      }
    }
    if (!isView(token)) return;
    if (!existing) {
      go('mine');
      toast('找不到這筆刊登');
      return;
    }
    if (!isLoggedIn() || existing.sellerId !== getState().me.id) {
      go(`detail/${listingId}`);
      toast('只有刊登者可以修改');
      return;
    }
  }
  const seeded = Array.isArray(existing?.photos) ? existing.photos.filter(Boolean).slice(0, MAX_LISTING_PHOTOS) : [];
  const photos = Array.from({ length: MAX_LISTING_PHOTOS }, (_, i) => seeded[i] || '');
  let photoBusy = false;
  let step = 0;
  let hint = null;
  let hintError = false;
  let hintSeq = 0;
  const draft = {
    title: existing?.title || '',
    category: existing?.category || CATEGORIES.find((c) => c !== '全部') || '其他',
    location: existing?.location || LOCATIONS[0],
    condition: existing?.condition || '良好',
    handover: existing?.handover || HANDOVERS[0],
    description: existing?.description || '',
    price: existing && existing.price != null && existing.price !== '' ? String(existing.price) : '',
    negotiable: existing ? existing.negotiable !== false : true,
  };
  const STEPS = ['相片', '狀況', '價錢', '確認'];

  const paintSlots = () => {
    const row = app.querySelector('#photo-row');
    const actions = app.querySelector('#photo-actions');
    if (!row) return;
    row.innerHTML = photos
      .map((src, i) => {
        // Album input: no `capture`. That attribute forces the camera and
        // hides the photo library on iOS Safari, mobile Safari, and many WebViews.
        // The input itself is the hit target (inside a label) so the tap is a real gesture.
        const albumInput = `<input class="photo-file-input" type="file" accept="image/*" multiple data-slot="${i}" aria-label="${
          src ? '從相簿更換照片' : '從相簿加圖'
        }" />`;
        if (src) {
          return `
            <div class="photo-slot filled has-img">
              <img src="${escapeAttr(mediaSrc(src))}" alt="" />
              <label class="photo-replace">${albumInput}</label>
              <button type="button" class="photo-clear" data-clear="${i}" aria-label="移除照片">×</button>
            </div>`;
        }
        return `
            <label class="photo-slot photo-add">
              <span class="photo-add-label" aria-hidden="true">＋ 加圖</span>
              ${albumInput}
            </label>`;
      })
      .join('');

    row.querySelectorAll('input[type="file"]').forEach((input) => {
      input.removeAttribute('capture');
      input.multiple = true;
    });

    if (actions) {
      const hasEmpty = photos.some((p) => !p);
      actions.hidden = !hasEmpty;
      actions.innerHTML = hasEmpty
        ? `<label class="photo-camera">
            <span class="photo-add-label" aria-hidden="true">拍照</span>
            <input class="photo-file-input" type="file" accept="image/*" capture="environment" data-camera="1" aria-label="拍照" />
          </label>`
        : '';
      actions.querySelectorAll('input[type="file"]').forEach((input) => {
        input.removeAttribute('multiple');
        input.multiple = false;
        input.setAttribute('capture', 'environment');
      });
    }
    const hintText = app.querySelector('#photo-hint-text');
    if (hintText) {
      const count = photos.filter(Boolean).length;
      hintText.textContent =
        count === 0
          ? `至少一張相片，最多 ${MAX_LISTING_PHOTOS} 張。建議多角度：正面、細節、瑕疵。相簿可多選，拍照仍可用。`
          : count >= MAX_LISTING_PHOTOS
            ? `已有 ${count} 張，已到上限。`
            : count === 1
              ? '已有 1 張。再加側面或瑕疵會更清楚，仍然可以繼續。'
              : `已有 ${count} 張。多角度會幫買家睇清楚。`;
    }
  };

  const bindPhotos = () => {
    const photoField = app.querySelector('#photo-field');
    photoField?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-clear]');
      if (!btn || !photoField.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(btn.getAttribute('data-clear'));
      if (!Number.isInteger(idx) || idx < 0 || idx >= photos.length) return;
      photos[idx] = '';
      paintSlots();
    });

    photoField?.addEventListener('change', async (e) => {
      const input = e.target.closest?.('input[type="file"]');
      if (!input || !photoField.contains(input)) return;
      // Copy first. Clearing the input drops the live FileList, and an empty
      // list means the picker was cancelled — leave existing photos alone.
      const picked = Array.from(input.files || []);
      if (!picked.length) return;
      input.value = '';
      if (photoBusy) {
        toast('請稍候');
        return;
      }
      const camera = input.dataset.camera === '1';
      const images = picked.filter(isLikelyImageFile);
      if (!images.length) {
        toast('請選擇圖片');
        return;
      }
      const chosen = camera ? images.slice(0, 1) : images;
      const slotAttr = input.hasAttribute('data-slot') ? Number(input.getAttribute('data-slot')) : -1;
      const targets = planPhotoTargets(photos, camera ? -1 : slotAttr, chosen.length);
      if (!targets.length) {
        toast(`最多 ${MAX_LISTING_PHOTOS} 張照片`);
        return;
      }
      photoBusy = true;
      toast('壓縮圖片中…');
      let added = 0;
      try {
        for (let i = 0; i < targets.length; i += 1) {
          try {
            photos[targets[i]] = await compressImageFile(chosen[i]);
            added += 1;
          } catch (err) {
            if (err?.message === 'TOO_LARGE') toast('圖片太大，請改選一張');
            /* keep going so one bad file does not drop the rest */
          }
        }
      } finally {
        photoBusy = false;
        paintSlots();
      }
      if (!added) {
        toast('無法讀取圖片');
        return;
      }
      if (images.length > targets.length) toast(`已加入 ${added} 張（最多 ${MAX_LISTING_PHOTOS} 張）`);
      else if (added > 1) toast(`已加入 ${added} 張照片`);
      else toast('已加入照片');
    });
  };

  const capture = () => {
    const title = app.querySelector('#title');
    if (title) draft.title = title.value;
    const category = app.querySelector('#category');
    if (category) draft.category = category.value;
    const location = app.querySelector('#location');
    if (location) draft.location = location.value;
    const description = app.querySelector('#description');
    if (description) draft.description = description.value;
    const price = app.querySelector('#price');
    if (price) draft.price = price.value;
    const negotiable = app.querySelector('[name="negotiable"]');
    if (negotiable) draft.negotiable = negotiable.checked;
    const handover = app.querySelector('#handover');
    if (handover) draft.handover = handover.value;
    const condition = app.querySelector('[data-condition].active');
    if (condition) draft.condition = condition.dataset.condition;
  };

  const validate = (current) => {
    capture();
    if (current === 0) {
      if (!photos.some(Boolean)) {
        toast('請至少加入一張相片');
        return false;
      }
      const title = draft.title.replace(/[\r\n]+/g, ' ').trim();
      draft.title = title;
      if (!title) {
        toast('請填寫標題');
        return false;
      }
      if (Array.from(title).length > 40) {
        toast('標題最多 40 字');
        return false;
      }
      return true;
    }
    if (current === 1) {
      draft.description = draft.description.trim();
      if (!draft.description) {
        toast('請寫一兩句狀況說明');
        return false;
      }
      return true;
    }
    if (current === 2) {
      const price = Number(draft.price);
      if (!price || price <= 0) {
        toast('請輸入有效價錢');
        return false;
      }
      return true;
    }
    return true;
  };

  const renderHint = () => {
    const box = app.querySelector('#price-hint');
    if (!box) return;
    if (hintError) {
      box.innerHTML = '<p class="photo-hint">價錢參考暫時載入不到。請自行填寫，這不是估價或鑑定。</p>';
      return;
    }
    if (!hint) {
      box.innerHTML = '<div class="sk sk-line"></div><p class="photo-hint">正在對照同類刊登…</p>';
      return;
    }
    box.innerHTML = `
      <div class="price-suggest">
        <div class="meta">參考價錢</div>
        <div class="suggest-mid">${money(hint.mid)}</div>
        <p class="photo-hint">${escapeHtml(hint.note || '')}</p>
        <button class="btn ghost" type="button" data-apply-price>填入 ${money(hint.mid)}</button>
      </div>`;
    box.querySelector('[data-apply-price]')?.addEventListener('click', () => {
      const input = app.querySelector('#price');
      if (!input) return;
      input.value = String(hint.mid);
      draft.price = input.value;
      input.focus();
    });
  };

  const loadHint = async () => {
    const seq = (hintSeq += 1);
    hint = null;
    hintError = false;
    renderHint();
    try {
      const data = await priceHint(draft.category, draft.condition);
      if (seq !== hintSeq || step !== 2 || !isView(token)) return;
      hint = data;
      hintError = false;
    } catch (err) {
      if (seq !== hintSeq || step !== 2 || !isView(token)) return;
      hintError = true;
      errToast(err, '價錢參考載入失敗');
    }
    if (seq !== hintSeq || step !== 2 || !isView(token)) return;
    renderHint();
  };

  const publish = async () => {
    if (photoBusy) {
      toast('請稍候');
      return;
    }
    capture();
    if (!photos.some(Boolean)) {
      toast('請至少加入一張相片');
      return;
    }
    if (!draft.title.trim() || !draft.description.trim() || !(Number(draft.price) > 0)) {
      toast('請先填好標題、狀況與價錢');
      return;
    }
    const btn = app.querySelector('#wiz-next');
    if (btn) btn.disabled = true;
    try {
      const payload = {
        title: draft.title.trim(),
        price: Number(draft.price),
        category: draft.category,
        location: draft.location,
        condition: draft.condition,
        description: draft.description.trim(),
        handover: draft.handover || HANDOVERS[0],
        negotiable: draft.negotiable !== false,
        photos: photos.filter(Boolean),
      };
      const listing = editing ? await updateListing(listingId, payload) : await addListing(payload);
      go(`detail/${listing.id}`);
      toast(editing ? '已更新刊登' : '已發佈');
    } catch (err) {
      errToast(err, editing ? '更新失敗：請檢查圖片大小或網路' : '發佈失敗：請檢查圖片大小或網路');
      if (btn) btn.disabled = false;
    }
  };

  const goStep = (next) => {
    if (photoBusy && next > step) {
      toast('請稍候');
      return;
    }
    if (next > step && !validate(step)) return;
    capture();
    step = Math.max(0, Math.min(STEPS.length - 1, next));
    paint();
    if (step === 2) loadHint();
  };

  const optionHtml = (values, current) => {
    const list = current && !values.includes(current) ? [current, ...values] : values;
    return list
      .map(
        (v) =>
          `<option value="${escapeAttr(v)}"${v === current ? ' selected' : ''}>${escapeHtml(v)}</option>`
      )
      .join('');
  };

  const paint = () => {
    const stepBar = `<div class="steps" aria-label="刊登步驟">${STEPS.map(
      (label, i) => `<span class="step ${i === step ? 'on' : ''}">${i + 1} ${escapeHtml(label)}</span>`
    ).join('')}</div>`;
    let fields = '';
    if (step === 0) {
      fields = `
        <div class="field" id="photo-field">
          <label>相片（至少 1 張，最多 ${MAX_LISTING_PHOTOS} 張）</label>
          <div class="photo-row" id="photo-row"></div>
          <p class="photo-hint" id="photo-hint-text">至少一張相片，最多 ${MAX_LISTING_PHOTOS} 張。建議多角度：正面、細節、瑕疵。相簿可多選，拍照仍可用。</p>
          <div class="photo-actions" id="photo-actions"></div>
        </div>
        <div class="field">
          <label for="title">標題</label>
          <input id="title" name="title" lang="zh-Hant" inputmode="text" autocomplete="off" maxlength="40" placeholder="例如：雙門雪櫃 運作正常" value="${escapeAttr(draft.title)}" />
        </div>`;
    } else if (step === 1) {
      fields = `
        <div class="field">
          <label>狀況</label>
          <div class="condition-list">
            ${(CONDITION_OPTIONS.some((c) => c.value === draft.condition)
              ? CONDITION_OPTIONS
              : [{ value: draft.condition, label: draft.condition, hint: '目前標示' }, ...CONDITION_OPTIONS]
            )
              .map(
                (c) =>
                  `<button type="button" class="condition-opt ${c.value === draft.condition ? 'active' : ''}" data-condition="${escapeAttr(c.value)}">
                  <span class="condition-label">${escapeHtml(c.label)}</span>
                  <span class="condition-hint">${escapeHtml(c.hint)}</span>
                </button>`
              )
              .join('')}
          </div>
          <p class="photo-hint">成色由你自己標示，買家會看到。平台不提供鑑定。</p>
        </div>
        <div class="field">
          <label for="category">分類</label>
          <select id="category" name="category">${optionHtml(
            CATEGORIES.filter((c) => c !== '全部'),
            draft.category
          )}</select>
        </div>
        <div class="field">
          <label for="location">地點</label>
          <select id="location" name="location">${optionHtml(LOCATIONS, draft.location)}</select>
        </div>
        <div class="field">
          <label>交收</label>
          <div class="chips tight" id="handover-chips">
            ${(HANDOVERS.includes(draft.handover) ? HANDOVERS : [draft.handover, ...HANDOVERS])
              .map(
                (h) =>
                  `<button type="button" class="chip ${h === draft.handover ? 'active' : ''}" data-handover="${escapeAttr(h)}">${escapeHtml(h)}</button>`
              )
              .join('')}
          </div>
          <input type="hidden" name="handover" id="handover" value="${escapeAttr(draft.handover)}" />
        </div>
        <div class="field">
          <label for="description">說明</label>
          <textarea id="description" name="description" lang="zh-Hant" inputmode="text" autocomplete="off" placeholder="說明使用情況、痕跡、方便交收的時間…">${escapeHtml(draft.description)}</textarea>
        </div>`;
    } else if (step === 2) {
      fields = `
        <div id="price-hint"></div>
        <div class="field">
          <label for="price">你的價錢（MOP）</label>
          <input id="price" name="price" type="number" min="1" inputmode="numeric" placeholder="例如：800" value="${escapeAttr(draft.price)}" />
        </div>
        <div class="field check-field">
          <label class="check-row">
            <input id="negotiable" type="checkbox" name="negotiable" ${draft.negotiable ? 'checked' : ''} />
            <span class="check-box" aria-hidden="true"></span>
            <span class="check-text">可議價</span>
          </label>
          <p class="photo-hint">參考價只是同類刊登的大概，由你決定。不是估價或鑑定。</p>
        </div>`;
    } else {
      const filled = photos.filter(Boolean);
      const thumbs = filled.length
        ? `<div class="photo-row summary-photos">${filled
            .map((src) => `<div class="photo-slot filled has-img"><img src="${escapeAttr(mediaSrc(src))}" alt="" /></div>`)
            .join('')}</div>`
        : '<p class="photo-hint">未加相片。請返回加上至少一張。</p>';
      fields = `
        ${thumbs}
        <div class="summary-line"><span>標題</span><span>${escapeHtml(draft.title)}</span></div>
        <div class="summary-line"><span>狀況</span><span>${escapeHtml(draft.condition)} · ${escapeHtml(draft.category)}</span></div>
        <div class="summary-line"><span>地點</span><span>${escapeHtml(draft.location)} · ${escapeHtml(draft.handover)}</span></div>
        <div class="summary-line"><span>價錢</span><span>${money(draft.price)} · ${draft.negotiable ? '可議價' : '否'}</span></div>
        ${hint ? `<div class="summary-line"><span>參考中間價</span><span>${money(hint.mid)}</span></div>` : ''}
        <p class="desc">${escapeHtml(draft.description)}</p>
        <p class="trust-footnote">${
          editing
            ? '儲存後這筆刊登會立刻更新，街坊看到最新內容。平台不鑑定、不代收款。'
            : '發佈後由你與街坊直接交收。平台不鑑定、不代收款。'
        }</p>
        <button class="text-link" type="button" data-edit-step="0">改相片或標題</button>
        <button class="text-link" type="button" data-edit-step="1">改狀況</button>
        <button class="text-link" type="button" data-edit-step="2">改價錢</button>`;
    }

    app.innerHTML = shell(
      `
      <header class="topbar"><h1>${editing ? '編輯刊登' : '刊登商品'}</h1></header>
      <form class="form" id="post-form">
        ${stepBar}
        <p class="photo-hint">第 ${step + 1} 步，共 4 步</p>
        ${fields}
        <div class="wizard-nav">
          <button class="btn ghost" type="button" id="wiz-back">${step === 0 ? '取消' : '上一步'}</button>
          <button class="btn primary" type="button" id="wiz-next">${step === 3 ? (editing ? '儲存更新' : '發佈') : '下一步'}</button>
        </div>
      </form>`,
      { tab: editing ? 'me' : 'post' }
    );

    if (step === 0) {
      paintSlots();
      bindPhotos();
    }
    if (step === 1) {
      app.querySelectorAll('[data-condition]').forEach((btn) => {
        btn.addEventListener('click', () => {
          app.querySelectorAll('[data-condition]').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          draft.condition = btn.dataset.condition;
        });
      });
      app.querySelectorAll('[data-handover]').forEach((btn) => {
        btn.addEventListener('click', () => {
          app.querySelectorAll('[data-handover]').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          draft.handover = btn.dataset.handover;
          const input = app.querySelector('#handover');
          if (input) input.value = btn.dataset.handover;
        });
      });
    }
    if (step === 2) {
      renderHint();
      const negotiable = app.querySelector('#negotiable');
      negotiable?.addEventListener('change', () => {
        draft.negotiable = negotiable.checked;
      });
    }
    app.querySelectorAll('[data-edit-step]').forEach((btn) => {
      btn.addEventListener('click', () => goStep(Number(btn.dataset.editStep)));
    });
    app.querySelector('#wiz-back')?.addEventListener('click', () => {
      if (step === 0) go(editing ? 'mine' : 'home');
      else goStep(step - 1);
    });
    app.querySelector('#wiz-next')?.addEventListener('click', () => {
      if (step >= 3) publish();
      else goStep(step + 1);
    });
    app.querySelector('#post-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (step >= 3) publish();
      else goStep(step + 1);
    });
  };

  paint();
}

async function renderMessages(token = nextView()) {
  if (!requireAuth('messages')) return;
  const header = `<header class="topbar"><h1>訊息</h1></header>`;
  app.innerHTML = shell(`${header}${scamTipHtml('messages-tip')}${skeletonThreads()}`, { tab: 'messages' });
  let error = null;
  try {
    await Promise.all([refreshThreads(), refreshNotices()]);
  } catch (err) {
    error = err;
    errToast(err, '載入訊息失敗');
  }
  if (!isView(token)) return;
  const { threads, listings } = getState();
  const list = threads
    .map((t) => {
      const l = listings.find((x) => x.id === t.listingId) || t.listing;
      return `
          <div class="thread">
            <button class="thread-open" type="button" data-go="chat/${t.id}">
              ${avatarHtml(t.peerAvatar, 'sm')}
              <div class="body">
                <div class="top">
                  <span class="name">${escapeHtml(t.peerName)}</span>
                  <span class="thread-side">${t.offer ? statusPill(t.offer) : ''}<span class="meta tiny">${escapeHtml(t.time)}</span></span>
                </div>
                <div class="preview">${escapeHtml(t.preview || '尚未傳訊息')}</div>
              </div>
              <div class="thumb-sm" style="background:${l?.tone || '#f5f5f5'}">${l ? thumbInner(l) : '📦'}</div>
              ${t.unread ? '<span class="dot" aria-label="未讀"></span>' : '<span style="width:8px"></span>'}
            </button>
            <button class="thread-delete" type="button" data-hide-thread="${escapeAttr(t.id)}" data-hide-name="${escapeAttr(t.peerName || '這位街坊')}" aria-label="刪除對話">刪除</button>
          </div>`;
    })
    .join('');
  const unreadNotices = (getState().notices || []).filter((n) => !n.read).slice(0, 3);
  const noticeStrip = unreadNotices
    .map(
      (n) =>
        `<button class="notice-strip" type="button" data-notice="${escapeAttr(n.id)}" data-href="${escapeAttr(n.href || '')}">${escapeHtml(n.body)}</button>`
    )
    .join('');
  const body = error && !threads.length
    ? listErrorHtml('訊息載入失敗')
    : threads.length
      ? `${error ? listRetryBar() : ''}${noticeStrip}${list}`
      : `${noticeStrip}<div class="empty">還沒有訊息<br/>去議價一筆商品吧</div>`;
  app.innerHTML = shell(`${header}${scamTipHtml('messages-tip')}${body}`, { tab: 'messages' });
  app.querySelectorAll('[data-notice]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-notice');
      const href = btn.getAttribute('data-href');
      try {
        await markNoticesRead(id ? [id] : []);
      } catch {
        /* still open the thread */
      }
      paintTabBadges();
      if (href) go(href);
    });
  });
  app.querySelector('#retry-load')?.addEventListener('click', () => renderMessages());
  app.querySelectorAll('[data-hide-thread]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-hide-thread');
      if (!id) return;
      const name = btn.getAttribute('data-hide-name') || '這位街坊';
      const ok = await confirmAction({
        title: '刪除對話',
        message: `與「${name}」的對話會從你的訊息列表移除，對方的列表不受影響。訊息仍保留。之後再傳訊息，對話會再出現。`,
        confirmLabel: '刪除對話',
        cancelLabel: '取消',
      });
      if (!ok || !isView(token)) return;
      btn.disabled = true;
      try {
        await hideThread(id);
        toast('已刪除對話');
        renderMessages();
      } catch (err) {
        btn.disabled = false;
        errToast(err, '刪除失敗');
      }
    });
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('READ_FAILED'));
    reader.readAsDataURL(blob);
  });
}

/** Same-browser recordings are WebM or MP4. WAV plays in both Chrome and Safari. */
async function transcodeBlobToWav(blob, signal) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('NO_AUDIO');
  const ctx = new Ctx();
  const fail = () => {
    try {
      ctx.close();
    } catch {
      /* ignore */
    }
  };
  if (signal?.aborted) {
    fail();
    throw new Error('ABORTED');
  }
  signal?.addEventListener('abort', fail, { once: true });
  try {
    const raw = await blob.arrayBuffer();
    if (signal?.aborted) throw new Error('ABORTED');
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    const samples = resampleMono(mixToMono(decoded), decoded.sampleRate || 48000, 16000, MAX_VOICE_SECONDS);
    if (!samples.length) throw new Error('EMPTY');
    return new Blob([encodeVoiceWav(samples, 16000)], { type: 'audio/wav' });
  } finally {
    fail();
  }
}

function blobHeader(blob) {
  return blob.slice(0, 16).arrayBuffer().then((buf) => new Uint8Array(buf));
}

async function audioDataUrl(blob) {
  const [url, header] = await Promise.all([blobToDataUrl(blob), blobHeader(blob)]);
  return coerceAudioDataUrl(url, header);
}

function stopVoicePlayback() {
  document.querySelectorAll('audio').forEach((el) => {
    try {
      el.pause();
    } catch {
      /* ignore */
    }
  });
  if (!currentVoice) return;
  try {
    currentVoice.button.textContent = '播放';
    currentVoice.button.setAttribute('aria-label', '播放');
    if (currentVoice.fill) currentVoice.fill.style.width = '0%';
  } catch {
    /* node already gone */
  }
  currentVoice = null;
}

function releaseVoiceCapture() {
  voiceGeneration += 1;
  voiceArming = false;
  const rec = activeCapture;
  if (!rec) return;
  rec.discard = true;
  rec.stopping = true;
  clearInterval(rec.timer);
  activeCapture = null;
  try {
    if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
  } catch {
    /* already stopped */
  }
  rec.stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  });
}

function chatVoiceBusy() {
  return voiceArming || Boolean(document.querySelector('#chat-form[data-voice-lock="1"]'));
}

function voiceBubbleHtml(m) {
  if (!m?.audio?.url) return '';
  return `<div class="bubble-voice" data-voice-msg="${escapeAttr(m.id)}">
    <button type="button" class="voice-toggle" aria-label="播放">播放</button>
    <span class="voice-dur">${escapeHtml(formatVoiceDuration(m.audio.duration))}</span>
    <span class="voice-track" aria-hidden="true"><span class="voice-fill"></span></span>
  </div>`;
}

function bindVoiceBubbles(root, messages) {
  if (!root) return;
  root.querySelectorAll('[data-voice-msg]').forEach((row) => {
    const msg = messages.find((item) => item.id === row.getAttribute('data-voice-msg'));
    const src = playableAudioSrc(msg?.audio?.url, API_BASE);
    const button = row.querySelector('.voice-toggle');
    const fill = row.querySelector('.voice-fill');
    if (!src || !button) {
      row.remove();
      return;
    }
    const audio = document.createElement('audio');
    audio.preload = 'none';
    audio.setAttribute('playsinline', '');
    audio.setAttribute('aria-hidden', 'true');
    audio.src = src;
    row.append(audio);
    const ui = { audio, button, fill, duration: Number(msg.audio.duration) || 0 };
    const showPaused = () => {
      button.textContent = '播放';
      button.setAttribute('aria-label', '播放');
    };
    audio.addEventListener('timeupdate', () => {
      const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : ui.duration;
      if (fill && total > 0) fill.style.width = `${Math.min(100, (audio.currentTime / total) * 100)}%`;
    });
    audio.addEventListener('ended', () => {
      showPaused();
      if (fill) fill.style.width = '0%';
      if (currentVoice?.audio === audio) currentVoice = null;
    });
    audio.addEventListener('pause', () => {
      if (!audio.ended) showPaused();
      if (currentVoice?.audio === audio) currentVoice = null;
    });
    button.addEventListener('click', () => {
      if (!audio.paused) {
        audio.pause();
        return;
      }
      if (currentVoice && currentVoice.audio !== audio) currentVoice.audio.pause();
      currentVoice = ui;
      button.textContent = '暫停';
      button.setAttribute('aria-label', '暫停');
      audio.play().catch(() => {
        toast('無法播放語音');
        showPaused();
        if (fill) fill.style.width = '0%';
        if (currentVoice?.audio === audio) currentVoice = null;
      });
    });
  });
}

function bindChatVoice(root, threadId) {
  const mic = root.querySelector('#chat-mic');

  const syncLock = () => {
    const form = root.querySelector('#chat-form');
    if (!form || form.dataset.threadId !== threadId) return;
    if (activeCapture && activeCapture.threadId === threadId && !activeCapture.discard) form.dataset.voiceLock = '1';
    else delete form.dataset.voiceLock;
  };

  const paintVoice = () => {
    syncLock();
    const voiceBox = root.querySelector('#chat-voice');
    const button = root.querySelector('#chat-mic');
    if (!voiceBox) return;
    const recording = activeCapture && activeCapture.threadId === threadId && !activeCapture.discard;
    const draft = chatVoiceDrafts.get(threadId);
    voiceBox.replaceChildren();
    if (!recording && !draft) {
      voiceBox.hidden = true;
      if (button) {
        button.classList.remove('is-recording');
        button.disabled = false;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', '錄音');
      }
      return;
    }
    voiceBox.hidden = false;
    if (recording) {
      if (button) {
        button.classList.add('is-recording');
        button.disabled = Boolean(activeCapture.processing);
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', activeCapture.processing ? '處理錄音' : '停止錄音');
      }
      const status = document.createElement('span');
      status.id = 'chat-voice-status';
      status.className = 'chat-voice-status';
      status.textContent = activeCapture.processing
        ? '處理錄音…'
        : `錄音中 ${formatVoiceDuration(activeCapture.elapsed || 0)}`;
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'chat-voice-action';
      stop.textContent = '停止';
      stop.disabled = Boolean(activeCapture.processing);
      stop.addEventListener('click', () => finishRecording(false));
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'chat-voice-action';
      cancel.textContent = '取消';
      cancel.disabled = Boolean(activeCapture.processing);
      cancel.addEventListener('click', () => finishRecording(true));
      voiceBox.append(status, stop, cancel);
      return;
    }
    if (button) {
      button.classList.remove('is-recording');
      button.disabled = false;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', '錄音');
    }
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'chat-voice-action';
    play.textContent = '播放';
    play.setAttribute('aria-label', '播放');
    const dur = document.createElement('span');
    dur.className = 'chat-voice-status';
    dur.textContent = formatVoiceDuration(draft.duration);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.setAttribute('playsinline', '');
    audio.setAttribute('aria-hidden', 'true');
    audio.src = draft.url;
    play.addEventListener('click', () => {
      if (audio.paused) {
        stopVoicePlayback();
        play.textContent = '暫停';
        play.setAttribute('aria-label', '暫停');
        audio.play().catch(() => {
          toast('無法播放語音');
          play.textContent = '播放';
          play.setAttribute('aria-label', '播放');
        });
      } else {
        audio.pause();
        play.textContent = '播放';
        play.setAttribute('aria-label', '播放');
      }
    });
    audio.addEventListener('ended', () => {
      play.textContent = '播放';
      play.setAttribute('aria-label', '播放');
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'chat-voice-action';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => {
      audio.pause();
      if (draft.url) URL.revokeObjectURL(draft.url);
      chatVoiceDrafts.delete(threadId);
      paintVoice();
    });
    voiceBox.append(play, dur, audio, cancel);
  };

  const finishRecording = (discard) => {
    const rec = activeCapture;
    if (!rec || rec.threadId !== threadId || rec.stopping) return;
    rec.stopping = true;
    rec.discard = discard;
    clearInterval(rec.timer);
    if (rec.recorder && rec.recorder.state !== 'inactive') {
      try {
        rec.recorder.stop();
      } catch {
        void rec.onStop?.();
        return;
      }
      // Some phones never fire `stop` after MediaRecorder.stop().
      rec.fallbackTimer = setTimeout(() => {
        void rec.onStop?.();
      }, 1000);
      return;
    }
    void rec.onStop?.();
  };

  const startRecording = async () => {
    if (voiceArming || activeCapture) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('此瀏覽器不支援錄音');
      return;
    }
    const form = root.querySelector('#chat-form');
    if (!form) return;
    voiceArming = true;
    form.dataset.voiceLock = '1';
    const gen = voiceGeneration;
    stopVoicePlayback();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      voiceArming = false;
      if (root.querySelector('#chat-form') === form) delete form.dataset.voiceLock;
      if (gen === voiceGeneration) toast(voiceErrorMessage(err));
      return;
    }
    if (gen !== voiceGeneration || root.querySelector('#chat-form') !== form) {
      voiceArming = false;
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    let recorder;
    try {
      const mime = preferredRecorderMime((type) => MediaRecorder.isTypeSupported(type));
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      voiceArming = false;
      delete form.dataset.voiceLock;
      stream.getTracks().forEach((track) => track.stop());
      toast('此瀏覽器不支援錄音');
      return;
    }
    const rec = {
      threadId,
      stream,
      recorder,
      chunks: [],
      startedAt: Date.now(),
      elapsed: 0,
      timer: 0,
      discard: false,
      stopping: false,
      processing: false,
    };
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size) rec.chunks.push(event.data);
    });
    let noteSaved = false;
    rec.onStop = async () => {
      if (noteSaved) return;
      noteSaved = true;
      clearInterval(rec.timer);
      clearTimeout(rec.fallbackTimer);
      const stopTracks = () => {
        rec.stream?.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        });
      };
      const sameThread = () => root.querySelector('#chat-form')?.dataset.threadId === threadId;
      const release = () => {
        if (activeCapture === rec) activeCapture = null;
        syncLock();
        if (sameThread()) paintVoice();
      };
      if (rec.discard || !sameThread()) {
        stopTracks();
        release();
        return;
      }
      const startedWait = Date.now();
      while (!rec.chunks.length && Date.now() - startedWait < 400) {
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      stopTracks();
      const elapsed = (Date.now() - rec.startedAt) / 1000;
      const blob = new Blob(rec.chunks, { type: recorder.mimeType || 'audio/webm' });
      if (rec.discard || !sameThread()) {
        release();
        return;
      }
      if (elapsed < 0.4 || !blob.size) {
        release();
        toast(elapsed < 0.4 ? '錄音太短' : '錄音失敗');
        return;
      }
      let dataUrl = '';
      try {
        dataUrl = await audioDataUrl(blob);
      } catch {
        release();
        toast('錄音失敗');
        return;
      }
      if (rec.discard || !sameThread()) {
        release();
        return;
      }
      const previous = chatVoiceDrafts.get(threadId);
      if (previous?.url) URL.revokeObjectURL(previous.url);
      const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const duration = Math.max(1, Math.min(MAX_VOICE_SECONDS, Math.round(Math.min(elapsed, MAX_VOICE_SECONDS))));
      const draft = {
        url: URL.createObjectURL(blob),
        duration,
        dataUrl,
        token,
        upgrade: null,
      };
      const ctrl = new AbortController();
      draft.upgrade = transcodeBlobToWav(blob, ctrl.signal)
        .then(async (wav) => {
          const current = chatVoiceDrafts.get(threadId);
          if (!current || current.token !== token) return;
          current.dataUrl = await audioDataUrl(wav);
          current.upgraded = true;
        })
        .catch(() => {
          /* The original recording is already sendable. */
        });
      draft.upgrade.abort = () => ctrl.abort();
      chatVoiceDrafts.set(threadId, draft);
      release();
    };
    recorder.addEventListener('stop', () => {
      void rec.onStop?.();
    });
    activeCapture = rec;
    voiceArming = false;
    rec.timer = setInterval(() => {
      if (activeCapture !== rec || rec.stopping || rec.processing) return;
      rec.elapsed = (Date.now() - rec.startedAt) / 1000;
      const status = root.querySelector('#chat-voice-status');
      if (status) status.textContent = `錄音中 ${formatVoiceDuration(rec.elapsed)}`;
      if (rec.elapsed >= MAX_VOICE_SECONDS) {
        toast('最長 60 秒');
        finishRecording(false);
      }
    }, 200);
    try {
      recorder.start();
    } catch {
      activeCapture = null;
      clearInterval(rec.timer);
      delete form.dataset.voiceLock;
      stream.getTracks().forEach((track) => track.stop());
      toast('無法開始錄音');
      return;
    }
    paintVoice();
  };

  mic?.addEventListener('click', () => {
    if (activeCapture && activeCapture.threadId === threadId) {
      if (!activeCapture.processing) finishRecording(false);
      return;
    }
    if (chatVoiceDrafts.has(threadId)) {
      toast('請先送出或取消這段錄音');
      return;
    }
    void startRecording();
  });
  mic?.addEventListener('contextmenu', (event) => event.preventDefault());
  paintVoice();

  return {
    async payload() {
      const draft = chatVoiceDrafts.get(threadId);
      if (!draft?.dataUrl) return null;
      if (draft.upgrade && !draft.upgraded) {
        await Promise.race([
          draft.upgrade,
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
        if (!draft.upgraded) draft.upgrade.abort?.();
      }
      const current = chatVoiceDrafts.get(threadId);
      if (!current?.dataUrl) return null;
      return { data: current.dataUrl, duration: current.duration };
    },
    discard() {
      const draft = chatVoiceDrafts.get(threadId);
      try {
        draft?.upgrade?.abort?.();
      } catch {
        /* ignore */
      }
      if (draft?.url) URL.revokeObjectURL(draft.url);
      chatVoiceDrafts.delete(threadId);
    },
  };
}

function formatMsgTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('zh-Hant', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Macau',
    });
  } catch {
    return '';
  }
}

const chatViewer = { photos: [], index: 0 };

function ensureChatViewer() {
  let viewer = document.querySelector('#chat-viewer');
  if (viewer) return viewer;
  viewer = document.createElement('div');
  viewer.id = 'chat-viewer';
  viewer.className = 'chat-viewer';
  viewer.hidden = true;
  viewer.innerHTML = `
    <button type="button" class="chat-viewer-close" aria-label="關閉">×</button>
    <button type="button" class="gallery-nav prev" data-chat-step="-1" aria-label="上一張">‹</button>
    <img alt="" />
    <button type="button" class="gallery-nav next" data-chat-step="1" aria-label="下一張">›</button>
    <span class="gallery-count"></span>`;
  viewer.addEventListener('click', (e) => {
    if (e.target.closest('.gallery-nav, .gallery-count')) return;
    viewer.hidden = true;
  });
  viewer.querySelectorAll('[data-chat-step]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const len = chatViewer.photos.length;
      if (len < 2) return;
      chatViewer.index = (chatViewer.index + Number(btn.dataset.chatStep) + len) % len;
      paintChatViewer();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') viewer.hidden = true;
  });
  document.body.appendChild(viewer);
  return viewer;
}

function paintChatViewer() {
  const viewer = ensureChatViewer();
  const photos = chatViewer.photos;
  const index = photos.length ? Math.min(chatViewer.index, photos.length - 1) : 0;
  chatViewer.index = index;
  const img = viewer.querySelector('img');
  if (img) img.src = photos[index] || '';
  const multi = photos.length > 1;
  viewer.querySelectorAll('.gallery-nav').forEach((btn) => {
    btn.hidden = !multi;
  });
  const count = viewer.querySelector('.gallery-count');
  if (count) {
    count.hidden = !multi;
    count.textContent = multi ? `${index + 1} / ${photos.length}` : '';
  }
  viewer.hidden = photos.length === 0;
}

function openChatViewer(photos, index) {
  chatViewer.photos = photos.filter(Boolean);
  chatViewer.index = index;
  paintChatViewer();
}

async function renderChat(threadId, token = nextView()) {
  stopVoicePlayback();
  releaseVoiceCapture();
  if (!requireAuth(`chat/${threadId}`)) return;
  let thread;
  try {
    thread = await markThreadRead(threadId);
  } catch (err) {
    errToast(err);
    go('messages');
    return;
  }
  if (!isView(token)) return;
  const related = (getState().notices || []).filter((n) => !n.read && n.href === `chat/${threadId}`);
  if (related.length) {
    markNoticesRead(related.map((n) => n.id))
      .then(() => paintTabBadges())
      .catch(() => {});
  }
  if (!thread) {
    go('messages');
    return;
  }
  const state = getState();
  const l = getListing(thread.listingId) || thread.listing;
  const meId = state.me.id;
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const offer = thread.offer || null;
  const role = offer ? offerPartyRole(offer, l, meId) : 'other';
  const statusCard = offer ? offerStatusHtml(offer, { role, showThreadLink: false }) : '';

  const bubbles = messages.length
    ? messages
        .map((m) => {
          const mine = m.fromId === meId;
          const photos = Array.isArray(m.photos) ? m.photos.filter(Boolean) : [];
          const photoHtml = photos.length
            ? `<div class="bubble-photos${photos.length === 1 ? ' one' : ''}">${photos
                .map((p) => {
                  const src = mediaSrc(p);
                  return `<button type="button" class="bubble-photo" data-chat-photo="${escapeAttr(src)}" aria-label="放大相片"><img src="${escapeAttr(src)}" alt="" /></button>`;
                })
                .join('')}</div>`
            : '';
          const textHtml = m.text
            ? `<div class="bubble-text">${escapeHtml(m.text).replaceAll('\n', '<br/>')}</div>`
            : '';
          const voiceHtml = voiceBubbleHtml(m);
          const deleteHtml = mine
            ? `<button type="button" class="bubble-delete" data-delete-message="${escapeAttr(m.id)}">刪除</button>`
            : '';
          return `
          <div class="bubble-row ${mine ? 'me' : 'peer'}">
            <div class="bubble">
              ${photoHtml}
              ${voiceHtml}
              ${textHtml}
              <div class="bubble-foot">
                <span class="bubble-time">${formatMsgTime(m.createdAt)}</span>
                ${deleteHtml}
              </div>
            </div>
          </div>`;
        })
        .join('')
    : `<div class="empty" style="padding:24px 0">開始對話吧</div>`;

  const strip = l
    ? `<button class="product-strip chat-strip" type="button" data-go="detail/${l.id}">
        <div class="mini" style="background:${l.tone}">${thumbInner(l)}</div>
        <div class="info">
          <div class="title">${escapeHtml(l.title)}</div>
          <div class="meta">${l.removed ? '刊登已移除' : `${money(l.price)}${isSold(l) ? ' · 已售' : l.negotiable ? ' · 可議' : ''}`}</div>
        </div>
        <span class="chat-strip-link">詳情</span>
      </button>`
    : '';

  const bargainLink =
    l && !isSold(l) && !l.removed && l.sellerId !== meId && offer?.status !== 'accepted'
      ? `<button class="btn ghost chat-bargain-link" type="button" data-go="bargain/${l.id}">出價</button>`
      : '';
  const chatTip = offer?.canHandoff ? '' : scamTipHtml('chat-tip');

  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="messages" aria-label="返回">←</button>
      <h1>${escapeHtml(thread.peerName)}</h1>
      ${bargainLink}
    </header>
    ${strip}
    ${statusCard}
    ${chatTip}
    <div class="chat-log" id="chat-log">${bubbles}</div>
    <form class="chat-composer" id="chat-form" data-thread-id="${escapeAttr(threadId)}">
      <div class="chat-pending" id="chat-pending" hidden></div>
      <div class="chat-voice" id="chat-voice" hidden></div>
      <div class="chat-compose-row">
        <label class="chat-attach">
          <span class="chat-attach-mark" aria-hidden="true">＋</span>
          <input id="chat-photo" class="chat-file-input" type="file" accept="image/*" multiple aria-label="傳送相片" />
        </label>
        <button type="button" class="chat-mic" id="chat-mic" aria-label="錄音" aria-pressed="false">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>
        </button>
        <input id="chat-input" type="text" lang="zh-Hant" inputmode="text" autocomplete="off" enterkeyhint="send" placeholder="輸入訊息…" maxlength="500" />
        <button class="btn primary chat-send" type="submit">送出</button>
      </div>
    </form>`;

  app.innerHTML = shell(content, { noTab: true });
  bindOfferStatus(app, { onDone: () => renderChat(threadId) });

  const log = app.querySelector('#chat-log');
  if (log) log.scrollTop = log.scrollHeight;
  log?.querySelectorAll('[data-chat-photo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = [...btn.parentElement.querySelectorAll('[data-chat-photo]')].map((el) => el.dataset.chatPhoto);
      openChatViewer(group, group.indexOf(btn.dataset.chatPhoto));
    });
  });
  bindVoiceBubbles(log, messages);
  log?.querySelectorAll('[data-delete-message]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const messageId = btn.dataset.deleteMessage;
      if (!messageId) return;
      const ok = await confirmAction({
        title: '刪除訊息',
        message: '刪除後，這則訊息會從對話中移除，對方也看不到。',
        confirmLabel: '刪除',
        cancelLabel: '取消',
      });
      if (!ok || !isView(token)) return;
      btn.disabled = true;
      try {
        await deleteMessage(threadId, messageId);
        toast('已刪除訊息');
        renderChat(threadId);
      } catch (err) {
        btn.disabled = false;
        errToast(err, '刪除失敗');
      }
    });
  });
  const voice = bindChatVoice(app, threadId);

  const input = app.querySelector('#chat-input');
  const photoInput = app.querySelector('#chat-photo');
  if (photoInput) {
    photoInput.removeAttribute('capture');
    photoInput.multiple = true;
  }
  let photoBusy = false;
  let sending = false;

  const paintPending = () => {
    const row = app.querySelector('#chat-pending');
    if (!row) return;
    const photos = chatPhotoDrafts.get(threadId) || [];
    row.hidden = photos.length === 0;
    row.replaceChildren();
    photos.forEach((src, i) => {
      const slot = document.createElement('div');
      slot.className = 'chat-pending-slot';
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'photo-clear';
      clear.dataset.pendingClear = String(i);
      clear.setAttribute('aria-label', '移除相片');
      clear.textContent = '×';
      slot.append(img, clear);
      row.append(slot);
    });
  };
  paintPending();
  const draftKey = `aomai-chat-draft-${threadId}`;
  const savedDraft = sessionStorage.getItem(draftKey);
  if (input && savedDraft) {
    input.value = savedDraft;
  }
  input?.focus();
  try {
    if (input) input.setSelectionRange(input.value.length, input.value.length);
  } catch (_) {}

  const form = app.querySelector('#chat-form');
  form?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pending-clear]');
    if (!btn || !form.contains(btn)) return;
    e.preventDefault();
    const idx = Number(btn.getAttribute('data-pending-clear'));
    const photos = chatPhotoDrafts.get(threadId) || [];
    if (!Number.isInteger(idx) || idx < 0 || idx >= photos.length) return;
    photos.splice(idx, 1);
    chatPhotoDrafts.set(threadId, photos);
    paintPending();
  });
  form?.addEventListener('change', async (e) => {
    const fileInput = e.target.closest?.('input[type="file"]');
    if (!fileInput || !form.contains(fileInput)) return;
    const picked = Array.from(fileInput.files || []);
    if (!picked.length) return;
    fileInput.value = '';
    if (form.dataset.voiceLock === '1') {
      toast('請先停止錄音');
      return;
    }
    if (photoBusy || sending) {
      toast('請稍候');
      return;
    }
    const images = picked.filter(isLikelyImageFile);
    if (!images.length) {
      toast('請選擇圖片');
      return;
    }
    const existing = chatPhotoDrafts.get(threadId) || [];
    const room = MAX_MESSAGE_PHOTOS - existing.length;
    if (room <= 0) {
      toast(`每則訊息最多 ${MAX_MESSAGE_PHOTOS} 張相片`);
      return;
    }
    const chosen = images.slice(0, room);
    photoBusy = true;
    toast('壓縮圖片中…');
    let added = 0;
    try {
      for (const file of chosen) {
        try {
          existing.push(await compressImageFile(file));
          added += 1;
        } catch (err) {
          if (err?.message === 'TOO_LARGE') toast('圖片太大，請改選一張');
        }
      }
    } finally {
      photoBusy = false;
      chatPhotoDrafts.set(threadId, existing);
      paintPending();
    }
    if (!added) {
      toast('無法讀取圖片');
      return;
    }
    if (images.length > chosen.length) toast(`已加入 ${added} 張（每則最多 ${MAX_MESSAGE_PHOTOS} 張）`);
  });
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (input?.dataset.composing === '1') return;
    if (photoBusy || sending) {
      toast('請稍候');
      return;
    }
    const text = String(input?.value || '').trim();
    const photos = [...(chatPhotoDrafts.get(threadId) || [])];
    if (form.dataset.voiceLock === '1') {
      toast('請先停止錄音');
      return;
    }
    sending = true;
    let audio = null;
    try {
      audio = await voice.payload();
    } catch (err) {
      sending = false;
      errToast(err, '送出失敗');
      return;
    }
    if (!text && !photos.length && !audio) {
      sending = false;
      toast('請輸入訊息、加上相片或錄音');
      return;
    }
    try {
      await sendMessage(threadId, text, photos, audio);
    } catch (err) {
      sending = false;
      errToast(err, '送出失敗');
      return;
    }
    chatPhotoDrafts.delete(threadId);
    voice.discard();
    if (input) input.value = '';
    sessionStorage.removeItem(draftKey);
    renderChat(threadId);
  });

  input?.addEventListener('input', () => {
    sessionStorage.setItem(draftKey, input.value);
  });
  input?.addEventListener('compositionstart', () => {
    input.dataset.composing = '1';
  });
  input?.addEventListener('compositionend', () => {
    input.dataset.composing = '0';
  });
}

function offerRow(o, { incoming = false } = {}) {
  const l = getListing(o.listingId) || getThreadByListing(o.listingId)?.listing;
  if (!l && !o.listingId) return '';
  const view = offerStatusView(o, incoming ? 'seller' : 'buyer');
  const dest = o.threadId ? `chat/${o.threadId}` : incoming ? `detail/${o.listingId}` : `bargain/${o.listingId}`;
  const title = l?.title || '商品';
  const tone = l?.tone || '#f5f5f5';
  const amount =
    o.status === 'accepted' && o.agreedAmount
      ? o.agreedAmount
      : o.status === 'countered' && o.counterAmount
        ? o.counterAmount
        : o.amount;
  const preview = incoming
    ? `${o.fromName ? `${o.fromName} · ` : ''}${view.label}${view.status === 'countered' ? ` · ${view.detail}` : ''}`
    : `${view.sub || view.detail}${o.meetup ? ` · ${o.meetup}` : ''}`;
  return `
          <div class="thread">
            <button class="thread-open" type="button" data-go="${dest}">
              <div class="thumb-sm" style="background:${tone}">${l ? thumbInner(l) : '📦'}</div>
              <div class="body">
                <div class="top">
                  <span class="name">${escapeHtml(title)}</span>
                  <span class="amount" style="font-size:13px">${money(amount)}</span>
                </div>
                <div class="preview offer-preview">${statusPill(o)}<span>${escapeHtml(preview)}</span></div>
              </div>
            </button>
            <button class="thread-delete" type="button" data-hide-offer="${escapeAttr(o.id)}" data-hide-title="${escapeAttr(title)}" aria-label="刪除議價">刪除</button>
          </div>`;
}

async function renderBargainsTab(token = nextView()) {
  if (!requireAuth('bargains')) return;
  const header = `<header class="topbar"><h1>我的議價</h1></header>`;
  app.innerHTML = shell(`${header}${skeletonThreads()}`, { tab: 'bargains' });
  let error = null;
  try {
    await refreshListings();
    await refreshMyOffers();
    await refreshIncomingOffers();
    await refreshThreads();
  } catch (err) {
    error = err;
    errToast(err, '載入議價失敗');
  }
  if (!isView(token)) return;
  const state = getState();
  const myOffers = state.offers
    .filter((o) => o.fromId === state.me.id)
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const incoming = (state.incomingOffers || [])
    .slice()
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

  const incomingBlock = incoming.length
    ? `<div class="section-label list-label">收到的出價</div>${incoming.map((o) => offerRow(o, { incoming: true })).join('')}`
    : '';
  const mineBlock = myOffers.length
    ? `${incoming.length ? '<div class="section-label list-label">我出的價</div>' : ''}${myOffers.map((o) => offerRow(o)).join('')}`
    : '';

  const loaded = Boolean(incomingBlock || mineBlock);
  const body = error && !loaded
    ? listErrorHtml('議價載入失敗')
    : loaded
      ? `${error ? listRetryBar() : ''}${incomingBlock}${mineBlock}`
      : `<div class="empty">尚未有議價<br/>在商品詳情點「議價」，或等街坊向你出價</div>`;
  app.innerHTML = shell(`${header}${body}`, { tab: 'bargains' });
  app.querySelector('#retry-load')?.addEventListener('click', () => renderBargainsTab());
  app.querySelectorAll('[data-hide-offer]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-hide-offer');
      if (!id) return;
      const title = btn.getAttribute('data-hide-title') || '這筆議價';
      const ok = await confirmAction({
        title: '刪除議價',
        message: `「${title}」會從你的議價列表移除，對方仍看得到，對話亦不受影響。之後再出價或有新回覆，會再出現。`,
        confirmLabel: '刪除議價',
        cancelLabel: '取消',
      });
      if (!ok || !isView(token)) return;
      btn.disabled = true;
      try {
        await hideOffer(id);
        toast('已刪除議價');
        renderBargainsTab();
      } catch (err) {
        btn.disabled = false;
        errToast(err, '刪除失敗');
      }
    });
  });
}

function managedGrid(list, labelFor, { edit = false, remove = false } = {}) {
  const classes = ['card-actions', edit ? 'has-edit' : '', remove ? 'has-remove' : ''].filter(Boolean).join(' ');
  return `<div class="grid">${list
    .map(
      (l) => `
        <div class="card-stack">
          ${listingCard(l)}
          <div class="${classes}">
            ${edit ? `<button class="card-foot" type="button" data-go="edit/${escapeAttr(l.id)}">編輯</button>` : ''}
            <button class="card-foot" type="button" data-sold-toggle="${escapeAttr(l.id)}">${escapeHtml(labelFor(l))}</button>
            ${
              remove
                ? `<button class="card-foot" type="button" data-delete-listing="${escapeAttr(l.id)}">刪除刊登</button>`
                : ''
            }
          </div>
        </div>`
    )
    .join('')}</div>`;
}

function bindListingDeletes(rerender) {
  app.querySelectorAll('[data-delete-listing]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-delete-listing');
      const listing = getListing(id);
      const title = listing?.title || '這件商品';
      const ok = await confirmAction({
        title: '刪除刊登',
        message: `刪除「${title}」後，它會從你的刊登和首頁移除。已有的對話仍在，對方會看到刊登已移除。`,
        confirmLabel: '刪除刊登',
        cancelLabel: '取消',
      });
      if (!ok) return;
      btn.disabled = true;
      try {
        await deleteListing(id);
        toast('已刪除刊登');
        rerender();
      } catch (err) {
        btn.disabled = false;
        errToast(err, '刪除失敗');
      }
    });
  });
}

function bindSoldToggles(rerender) {
  app.querySelectorAll('[data-sold-toggle]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-sold-toggle');
      const listing = getListing(id);
      if (!listing) return;
      btn.disabled = true;
      try {
        await setSold(id, !isSold(listing));
        toast(isSold(getListing(id)) ? '已標示為已售出' : '已取消已售出');
        rerender();
      } catch (err) {
        btn.disabled = false;
        errToast(err);
      }
    });
  });
}

async function renderOwned(token, { title, sold, path }) {
  if (!requireAuth(path)) return;
  const header = subHeader(title, 'me');
  app.innerHTML = shell(`${header}${skeletonGrid()}`, { tab: 'me' });
  let error = null;
  let owned = [];
  try {
    owned = await refreshListings({ mine: '1' });
  } catch (err) {
    error = err;
    errToast(err, '載入刊登失敗');
    owned = getState().listings.filter((l) => l.sellerId === getState().me.id);
  }
  if (!isView(token)) return;
  const list = owned
    .filter((l) => !l.removed && isSold(l) === sold)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const empty = sold
    ? `<div class="empty">還沒有已售物品<br/>在商品詳情可以標示已售</div>`
    : `<div class="empty">還沒有刊登中的物品<br/><button class="btn ghost retry-btn" type="button" data-go="post">去刊登</button></div>`;
  const body = error && !list.length
    ? listErrorHtml('刊登載入失敗')
    : list.length
      ? `${error ? listRetryBar() : ''}${managedGrid(list, () => (sold ? '取消已售' : '標示已售'), { edit: !sold, remove: !sold })}`
      : empty;
  app.innerHTML = shell(`${header}${body}`, { tab: 'me' });
  bindSoldToggles(() => renderOwned(nextView(), { title, sold, path }));
  bindListingDeletes(() => renderOwned(nextView(), { title, sold, path }));
  app.querySelector('#retry-load')?.addEventListener('click', () => renderOwned(nextView(), { title, sold, path }));
}

async function renderMine(token = nextView()) {
  return renderOwned(token, { title: '我的刊登', sold: false, path: 'mine' });
}

async function renderSold(token = nextView()) {
  return renderOwned(token, { title: '已售', sold: true, path: 'sold' });
}

async function renderSaved(token = nextView(), path = 'saved') {
  if (!requireAuth(path)) return;
  const header = subHeader('收藏', 'me');
  app.innerHTML = shell(`${header}${skeletonGrid()}`, { tab: 'me' });
  let error = null;
  try {
    await refreshWants();
  } catch (err) {
    error = err;
    errToast(err, '載入收藏失敗');
  }
  if (!isView(token)) return;
  const list = getState().wants.map((id) => getListing(id)).filter(Boolean);
  const cards = `<div class="grid">${list
    .map(
      (l) => `
        <div class="card-stack">
          ${listingCard(l)}
          <button class="card-foot" type="button" data-unsave="${escapeAttr(l.id)}">取消收藏</button>
        </div>`
    )
    .join('')}</div>`;
  const body = error && !list.length
    ? listErrorHtml('收藏載入失敗')
    : list.length
      ? `${error ? listRetryBar() : ''}${cards}`
      : `<div class="empty">還沒有收藏<br/>在商品詳情點「收藏」加入</div>`;
  app.innerHTML = shell(`${header}${body}`, { tab: 'me' });
  app.querySelectorAll('[data-unsave]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await removeWant(btn.getAttribute('data-unsave'));
        toast('已從收藏移除');
        renderSaved(nextView(), path);
      } catch (err) {
        btn.disabled = false;
        errToast(err);
      }
    });
  });
  app.querySelector('#retry-load')?.addEventListener('click', () => renderSaved(nextView(), path));
}

function userHeader(title) {
  return `<header class="topbar">
      <button class="back" type="button" id="user-back" aria-label="返回">←</button>
      <h1>${escapeHtml(title)}</h1>
    </header>`;
}

function bindUserBack() {
  app.querySelector('#user-back')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else go('home');
  });
}

async function renderUser(id, token = nextView()) {
  if (!id) {
    go('home');
    return;
  }
  app.innerHTML = shell(`${userHeader('街坊')}${skeletonGrid()}`, { noTab: true });
  bindUserBack();
  let data = null;
  let error = null;
  try {
    data = await fetchUser(id);
  } catch (err) {
    error = err;
    errToast(err, '載入街坊頁失敗');
  }
  if (!isView(token)) return;
  if (!data?.user) {
    app.innerHTML = shell(`${userHeader('街坊')}${error ? listErrorHtml('載入失敗') : '<div class="empty">找不到這位街坊</div>'}`, {
      noTab: true,
    });
    bindUserBack();
    app.querySelector('#retry-load')?.addEventListener('click', () => renderUser(id));
    return;
  }
  const user = data.user;
  const listings = Array.isArray(data.listings) ? data.listings : [];
  const active = listings.filter((l) => !isSold(l));
  const sold = listings.filter((l) => isSold(l));
  const reviews = Array.isArray(data.reviews) ? data.reviews : [];
  const reviewHtml = reviews.length
    ? reviews
        .map(
          (r) => `
        <div class="review">
          <div class="review-top">
            <span>${starMarks(r.stars)}</span>
            <span class="meta">${escapeHtml(r.fromName || '街坊')}${r.time ? ` · ${escapeHtml(r.time)}` : ''}</span>
          </div>
          ${r.text ? `<p>${escapeHtml(r.text)}</p>` : ''}
        </div>`
        )
        .join('')
    : '<p class="meta">尚未有街坊評價</p>';
  const mine = isLoggedIn() && getState().me.id === user.id;
  const content = `
    ${userHeader(user.name)}
    <div class="profile">
      ${avatarHtml(user.avatar, 'lg')}
      <div class="name">${escapeHtml(user.name)}</div>
      <div class="meta">${escapeHtml(user.bio || '街坊')}</div>
      <div class="profile-trust">
        ${trustLines(user.trust, { quote: false })}
        <p class="trust-footnote">${TRUST_FOOTNOTE}</p>
      </div>
    </div>
    ${
      mine
        ? `<div class="menu"><button class="menu-row" type="button" data-go="profile"><span>編輯個人資料</span><span class="arrow">→</span></button></div>`
        : ''
    }
    <div class="list-pad">
      <div class="section-label">街坊評價</div>
      ${reviewHtml}
      <div class="section-label">刊登中</div>
    </div>
    ${active.length ? `<div class="grid">${active.map((l) => listingCard(l)).join('')}</div>` : '<div class="empty">暫無刊登中的物品</div>'}
    ${
      sold.length
        ? `<div class="list-pad"><div class="section-label">已售</div></div><div class="grid">${sold.map((l) => listingCard(l)).join('')}</div>`
        : ''
    }`;
  app.innerHTML = shell(content, { noTab: true });
  bindUserBack();
}

function showAbout() {
  document.querySelector('.about-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'about-overlay';
  overlay.innerHTML = `
    <div class="about-sheet" role="dialog" aria-label="關於澳賣GOT">
      <div class="brand-strip brand-strip-dark">
        <img class="brand-logo brand-logo-lg" data-brand-logo="dark" src="${brandLogoSrc('dark')}" alt="澳賣GOT" />
      </div>
      <div class="about-body">
        <p>澳門鄰里二手 · 議價為主</p>
        <p class="meta">MoGOT</p>
        <p class="meta" style="margin:8px 0 16px">一物一故事 · 閑置亦有價</p>
        <button type="button" class="btn ghost" id="about-support" style="width:100%;margin-bottom:8px">支援與聯絡</button>
        <button type="button" class="btn ghost" id="about-privacy" style="width:100%;margin-bottom:8px">隱私政策</button>
        <button type="button" class="btn primary" id="about-close" style="width:100%">關閉</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#about-close')?.addEventListener('click', close);
  overlay.querySelector('#about-support')?.addEventListener('click', () => {
    close();
    go('support');
  });
  overlay.querySelector('#about-privacy')?.addEventListener('click', () => {
    close();
    go('privacy');
  });
}

function menuGo(path, label, count) {
  const end =
    count == null
      ? '<span class="arrow">→</span>'
      : `<span class="menu-end"><span class="menu-count">${count}</span><span class="arrow">→</span></span>`;
  return `<button class="menu-row" type="button" data-go="${path}"><span>${label}</span>${end}</button>`;
}

async function renderMe(token = nextView()) {
  const state = getState();
  const logged = isLoggedIn();
  let s = { active: 0, sold: 0, saved: 0, posts: 0, deals: 0 };
  if (logged) {
    try {
      s = await stats();
    } catch {
      /* ignore */
    }
  }
  if (!isView(token)) return;
  let alertPref = { enabled: false, remotePush: false, note: messageAlertNote({ enabled: false }) };
  if (logged) {
    try {
      alertPref = await loadMessageAlertPref();
    } catch {
      /* keep the switch off until the server answers */
    }
  }
  if (!isView(token)) return;
  const active = s.active ?? Math.max(0, (s.posts || 0) - (s.deals || 0));
  const soldCount = s.sold ?? s.deals ?? 0;
  const saved = s.saved ?? getState().wants.length;
  const trust = getState().me.trust;
  const content = `
    <header class="topbar"><h1>我的</h1></header>
    ${offlineBanner()}
    <div class="brand-strip brand-strip-light">
      <div class="brand brand-home">
        <img class="brand-logo brand-logo-lg" data-brand-logo="auto" src="${brandLogoSrc()}" alt="澳賣GOT" />
        <span class="muted tiny brand-tagline">MoGOT</span>
      </div>
    </div>
    <div class="profile">
      ${avatarHtml(state.me.avatar, 'lg')}
      <div class="name">${escapeHtml(state.me.name)}</div>
      <div class="meta">${escapeHtml(logged ? state.me.bio || state.me.email || '' : '登入後可刊登、議價與對話')}</div>
      ${
        logged
          ? `<div class="profile-trust">${trustLines(trust, { quote: false })}<p class="trust-footnote">${TRUST_FOOTNOTE}</p></div>`
          : ''
      }
    </div>
    ${
      logged
        ? `<div class="stats">
      <button class="stat" type="button" data-go="mine"><div class="n">${active}</div><div class="l">刊登</div></button>
      <button class="stat" type="button" data-go="sold"><div class="n">${soldCount}</div><div class="l">已售</div></button>
      <button class="stat" type="button" data-go="saved"><div class="n">${saved}</div><div class="l">收藏</div></button>
    </div>`
        : ''
    }
    <div class="menu">
      ${
        logged
          ? `
      ${menuGo('profile', '編輯個人資料')}
      ${menuGo('mine', '我的刊登', active)}
      ${menuGo('sold', '已售', soldCount)}
      ${menuGo('saved', '收藏', saved)}
      ${menuGo('bargains', '我的議價')}
      <button class="menu-row" type="button" id="notify-toggle" role="switch" aria-checked="${alertPref.enabled ? 'true' : 'false'}" aria-label="訊息提醒">
        <span>訊息提醒</span>
        <span class="notify-control">
          <span class="theme-state" id="notify-state">${alertPref.enabled ? '開啟' : '關閉'}</span>
          <span class="notify-switch" id="notify-switch" data-on="${alertPref.enabled ? 'true' : 'false'}" aria-hidden="true"></span>
        </span>
      </button>
      <p class="photo-hint notify-note" id="notify-note">${escapeHtml(alertPref.note || messageAlertNote(alertPref))}</p>`
          : `
      <button class="menu-row" type="button" data-go="login" id="me-login"><span>登入</span><span class="arrow">→</span></button>
      <button class="menu-row" type="button" data-go="register" id="me-register"><span>註冊</span><span class="arrow">→</span></button>`
      }
      <button class="menu-row theme-row" type="button" id="theme-toggle" aria-pressed="${getTheme() === 'dark'}">
        <span>介面顏色</span>
        <span style="display:flex;align-items:center">
          <span class="theme-state">${getTheme() === 'dark' ? '深色模式' : '淺色模式'}</span>
          <span class="theme-switch" aria-hidden="true"></span>
        </span>
      </button>
      <button class="menu-row" type="button" data-go="support"><span>支援與聯絡</span><span class="arrow">→</span></button>
      <button class="menu-row" type="button" data-go="privacy"><span>隱私政策</span><span class="arrow">→</span></button>
      <button class="menu-row" type="button" id="about"><span>關於澳賣GOT</span><span class="arrow">→</span></button>
      ${
        logged
          ? `<button class="menu-row" type="button" id="logout"><span>登出</span><span class="arrow">→</span></button>`
          : ''
      }
    </div>`;
  app.innerHTML = shell(content, { tab: 'me' });
  app.querySelector('#me-login')?.addEventListener('click', () => {
    sessionStorage.setItem('aomai-after-login', 'me');
  });
  app.querySelector('#me-register')?.addEventListener('click', () => {
    sessionStorage.setItem('aomai-after-login', 'me');
  });
  let notifyBusy = false;
  const paintNotify = (enabled, note) => {
    const btn = app.querySelector('#notify-toggle');
    const stateEl = app.querySelector('#notify-state');
    const switchEl = app.querySelector('#notify-switch');
    const noteEl = app.querySelector('#notify-note');
    if (btn) btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
    if (stateEl) stateEl.textContent = enabled ? '開啟' : '關閉';
    if (switchEl) switchEl.dataset.on = enabled ? 'true' : 'false';
    if (noteEl) noteEl.textContent = note;
  };
  app.querySelector('#notify-toggle')?.addEventListener('click', async () => {
    if (notifyBusy) return;
    const btn = app.querySelector('#notify-toggle');
    const was = btn?.getAttribute('aria-checked') === 'true';
    notifyBusy = true;
    paintNotify(!was, '更新中…');
    try {
      const result = await setMessageAlerts(!was);
      alertPref = { ...alertPref, ...result };
      paintNotify(result.enabled, result.note);
      if (result.permission === 'denied') toast('系統未允許通知，提醒維持關閉');
      else if (result.enabled) toast(result.remotePush ? '已開啟訊息提醒' : '已開啟本機提醒');
      else toast('已關閉訊息提醒');
    } catch (err) {
      paintNotify(was, messageAlertNote({ enabled: was, remotePush: alertPref.remotePush }));
      errToast(err, '未能更新訊息提醒');
    } finally {
      notifyBusy = false;
    }
  });
  app.querySelector('#theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    renderMe();
  });
  app.querySelector('#about')?.addEventListener('click', () => {
    showAbout();
  });
  app.querySelector('#logout')?.addEventListener('click', async () => {
    dismissToast();
    await logout();
    toast('已登出');
    renderMe();
  });
}

const PROFILE_NAME_MAX = 20;
const PROFILE_BIO_MAX = 80;

function renderProfile() {
  if (!requireAuth('me')) return;
  const me = getState().me;
  let picked = '';
  let removed = false;
  let photoBusy = false;

  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="me" aria-label="返回">←</button>
      <h1>編輯個人資料</h1>
    </header>
    ${offlineBanner()}
    <form class="form" id="profile-form">
      <div class="field" id="avatar-field">
        <label>使用者頭像</label>
        <div class="avatar-edit">
          <div id="avatar-preview"></div>
          <div class="avatar-actions">
            <label class="photo-camera">
              <span class="photo-add-label">從相簿選擇</span>
              <input class="photo-file-input" type="file" accept="image/*" data-avatar="album" aria-label="從相簿選擇頭像" />
            </label>
            <label class="photo-camera">
              <span class="photo-add-label">拍照</span>
              <!-- capture opens the camera. Album input above must not set capture, or iOS hides the library. The camera purpose string lives in ios/App/App/Info.plist; without NSCameraUsageDescription, iOS kills the app on tap. -->
              <input class="photo-file-input" type="file" accept="image/*" capture="environment" data-avatar="camera" aria-label="拍照作為頭像" />
            </label>
            <button class="text-link" type="button" id="avatar-clear">移除照片</button>
          </div>
        </div>
        <p class="photo-hint">從相簿選取，或拍照。未設定時顯示名稱首字。</p>
      </div>
      <div class="field">
        <label for="name">使用者名稱</label>
        <input id="name" name="name" lang="zh-Hant" inputmode="text" autocomplete="nickname" required maxlength="${PROFILE_NAME_MAX}" value="${escapeAttr(me.name)}" placeholder="例如：阿輝" />
      </div>
      <div class="field">
        <label for="bio">個人簡介</label>
        <textarea id="bio" name="bio" lang="zh-Hant" inputmode="text" autocomplete="off" maxlength="${PROFILE_BIO_MAX}" placeholder="例如：氹仔街坊 · 週末出沒">${escapeHtml(me.bio || '')}</textarea>
        <p class="photo-hint">最多 ${PROFILE_BIO_MAX} 字，可留空</p>
      </div>
      <div class="field">
        <label for="email">電郵</label>
        <input id="email" name="email" type="email" value="${escapeAttr(me.email)}" readonly tabindex="-1" />
        <p class="photo-hint">電郵暫不可更改</p>
      </div>
      <div class="actionbar" style="position:static;transform:none;max-width:none;padding:8px 0 0;border:0">
        <button class="btn ghost" type="button" data-go="me">取消</button>
        <button class="btn primary" type="submit">儲存</button>
      </div>
    </form>`;

  app.innerHTML = shell(content, { tab: 'me' });

  const preview = app.querySelector('#avatar-preview');
  const clearBtn = app.querySelector('#avatar-clear');
  const nameInput = app.querySelector('#name');
  const avatarField = app.querySelector('#avatar-field');

  const currentName = () => String(nameInput?.value || me.name || '').trim();
  const showingPhoto = () => Boolean(picked) || (!removed && isPhotoAvatar(me.avatar));
  const previewAvatar = () => {
    if (picked) return picked;
    const typed = currentName();
    if (removed) return letterFromName(typed);
    if (isPhotoAvatar(me.avatar)) return me.avatar;
    const original = String(me.name || '').trim();
    if (typed === original && String(me.avatar || '').trim()) return me.avatar;
    return letterFromName(typed);
  };
  const paintAvatar = () => {
    if (preview) preview.innerHTML = avatarHtml(previewAvatar(), 'lg');
    if (clearBtn) clearBtn.hidden = !showingPhoto();
  };

  avatarField?.querySelectorAll('input[type="file"]').forEach((input) => {
    if (input.dataset.avatar === 'camera') {
      input.removeAttribute('multiple');
      input.multiple = false;
      input.setAttribute('capture', 'environment');
    } else {
      input.removeAttribute('capture');
      input.removeAttribute('multiple');
      input.multiple = false;
    }
  });

  nameInput?.addEventListener('input', () => {
    if (!showingPhoto()) paintAvatar();
  });

  clearBtn?.addEventListener('click', () => {
    picked = '';
    removed = true;
    paintAvatar();
  });

  avatarField?.addEventListener('change', async (e) => {
    const input = e.target.closest?.('input[type="file"]');
    if (!input || !avatarField.contains(input)) return;
    const pickedFiles = Array.from(input.files || []);
    input.value = '';
    if (!pickedFiles.length) return;
    if (photoBusy) {
      toast('請稍候');
      return;
    }
    const file = pickedFiles.find(isLikelyImageFile);
    if (!file) {
      toast('請選擇圖片');
      return;
    }
    photoBusy = true;
    toast('壓縮圖片中…');
    try {
      picked = await compressImageFile(file, 640, 0.8);
      removed = false;
      toast('已加入頭像');
    } catch (err) {
      toast(err?.message === 'TOO_LARGE' ? '圖片太大，請改選一張' : '無法讀取圖片');
    } finally {
      photoBusy = false;
      paintAvatar();
    }
  });

  paintAvatar();

  app.querySelector('#profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (photoBusy) {
      toast('請稍候');
      return;
    }
    const fd = new FormData(e.target);
    const name = String(fd.get('name') || '').replace(/[\r\n]+/g, ' ').trim();
    const bio = String(fd.get('bio') || '').trim();
    if (!name) {
      toast('請填寫使用者名稱');
      return;
    }
    if (Array.from(name).length > PROFILE_NAME_MAX) {
      toast(`使用者名稱最多 ${PROFILE_NAME_MAX} 字`);
      return;
    }
    if (Array.from(bio).length > PROFILE_BIO_MAX) {
      toast(`個人簡介最多 ${PROFILE_BIO_MAX} 字`);
      return;
    }
    const payload = { name, bio };
    if (removed) payload.avatar = '';
    else if (picked) payload.avatar = picked;
    const btn = e.target.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await updateProfile(payload);
      go('me');
      toast('已更新個人資料');
    } catch (err) {
      errToast(err, '更新失敗');
      if (btn) btn.disabled = false;
    }
  });
}

/* ---------- Router ---------- */

async function route() {
  releaseVoiceCapture();
  stopVoicePlayback();
  closeOfferSheet();
  closeRateSellerModal();
  dismissStaleToast();
  const token = nextView();
  const { parts } = parseHash();
  const [a, b] = parts;
  switch (a) {
    case 'home':
    case undefined:
      await renderHome(token);
      break;
    case 'detail':
      await renderDetail(b, token);
      break;
    case 'bargain':
      await renderBargain(b, token);
      break;
    case 'post':
      await renderPost(token);
      break;
    case 'edit':
      if (!b) {
        go('mine');
        break;
      }
      await renderPost(token, b);
      break;
    case 'messages':
      await renderMessages(token);
      break;
    case 'chat':
      await renderChat(b, token);
      break;
    case 'bargains':
    case 'offers':
      await renderBargainsTab(token);
      break;
    case 'mine':
      await renderMine(token);
      break;
    case 'sold':
      await renderSold(token);
      break;
    case 'saved':
      await renderSaved(token, 'saved');
      break;
    case 'wants':
      await renderSaved(token, 'wants');
      break;
    case 'user':
      await renderUser(b, token);
      break;
    case 'me':
      await renderMe(token);
      break;
    case 'profile':
      renderProfile();
      break;
    case 'login':
      renderLogin();
      break;
    case 'forgot':
      renderForgot();
      break;
    case 'reset':
      renderReset();
      break;
    case 'register':
      renderRegister();
      break;
    case 'verify-sent':
      renderVerifySent();
      break;
    case 'privacy':
      renderPrivacy();
      break;
    case 'support':
      renderSupport();
      break;
    default:
      go('home');
  }
}

app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-go]');
  if (!btn) return;
  e.preventDefault();
  go(btn.dataset.go);
});

window.addEventListener('hashchange', () => {
  route();
});

function escapeHtml(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(s = '') {
  return escapeHtml(s).replaceAll("'", '&#39;');
}

applyTheme(getTheme());

app.innerHTML = shell(
  `<header class="topbar"><h1>澳賣GOT</h1></header>${skeletonGrid()}`,
  { tab: 'home', screenClass: 'home-screen' }
);

bootstrap()
  .then(async (r) => {
    try {
      await resumeMessageAlerts();
    } catch (err) {
      console.warn('message alerts', err);
    }
    watchNotices({
      onNotice: (notice) => {
        if (!isLoggedIn()) return;
        const { parts } = parseHash();
        if (parts[0] === 'chat' && notice.href === `chat/${parts[1]}`) {
          const input = document.querySelector('#chat-input');
          if (chatVoiceBusy() || (input && document.activeElement === input && input.value)) {
            paintTabBadges();
            return;
          }
          renderChat(parts[1]);
          return;
        }
        if (messageAlertsEnabled()) toast(notice.body || notice.title || '有新訊息');
        paintTabBadges();
        refreshBadges()
          .then(() => paintTabBadges())
          .catch(() => {});
      },
    });
    if (!location.hash) location.hash = '#/home';
    await route();
    if (!r.online) toast('無法連接後端，請先執行 npm run server');
  })
  .catch((err) => {
    console.error(err);
    if (!location.hash) location.hash = '#/home';
    route().then(() => toast('啟動失敗'), () => toast('啟動失敗'));
  });
