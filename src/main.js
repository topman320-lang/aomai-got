import { API_BASE, privacyUrl } from './api.js';
import {
  CATEGORIES,
  CONDITIONS,
  HANDOVERS,
  LOCATIONS,
  MEETUPS,
  addListing,
  addOffer,
  addWant,
  bootstrap,
  fetchHomeListings,
  getListing,
  getOffersForListing,
  getState,
  getThread,
  getThreadByListing,
  isLoggedIn,
  login,
  logout,
  markThreadRead,
  refreshListing,
  refreshMyOffers,
  refreshThreads,
  refreshWants,
  register,
  requestPasswordReset,
  resetPassword,
  sendMessage,
  setSold,
  stats,
} from './store.js';

const app = document.getElementById('app');

function parseHash() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  return { parts, params };
}

function go(path) {
  location.hash = `#/${path.replace(/^\//, '')}`;
}

function money(n) {
  return `MOP ${Number(n).toLocaleString('zh-Hant')}`;
}

function isSold(l) {
  return Boolean(l?.sold);
}

function listingBadges(l) {
  const bits = [];
  if (isSold(l)) bits.push('<span class="badge sold">已售</span>');
  else if (l.negotiable) bits.push('<span class="badge">可議</span>');
  return bits.join('');
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
  if (l?.negotiable && !isSold(l)) items.push({ key: 'offer', label: '可議價' });
  if (l?.sellerVerified) items.push({ key: 'verified', label: '賣家已驗證' });
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

function thumbInner(l, { emojiClass = 'emoji' } = {}) {
  const photo = firstPhoto(l);
  if (photo) {
    return `<img class="thumb-img" src="${escapeAttr(photo)}" alt="" />`;
  }
  return `<span class="${emojiClass}">${l?.emoji || '📦'}</span>`;
}

function listingCard(l, { go: dest = `detail/${l.id}` } = {}) {
  const sold = isSold(l);
  const chips = [
    l.location ? `<span class="mini-chip">${escapeHtml(l.location)}</span>` : '',
    l.condition ? `<span class="mini-chip">${escapeHtml(l.condition)}</span>` : '',
    l.sellerVerified ? `<span class="mini-chip mini-strong">賣家已驗證</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  return `
        <button class="card ${sold ? 'sold' : ''}" type="button" data-go="${dest}">
          <div class="thumb" style="background:${escapeAttr(l.tone || '')}">
            ${listingBadges(l)}
            ${thumbInner(l)}
          </div>
          <div class="card-body">
            <div class="card-title">${escapeHtml(l.title)}</div>
            ${priceHtml(l.price, sold)}
            ${chips ? `<div class="card-chips">${chips}</div>` : ''}
          </div>
        </button>`;
}

function toast(msg, ms = 2200) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
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

function compressImageFile(file, maxEdge = 960, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!isLikelyImageFile(file)) {
      reject(new Error('NOT_IMAGE'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('NO_CANVAS'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
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

function tabbar(active) {
  const tabs = [
    { id: 'home', label: '首頁' },
    { id: 'messages', label: '訊息' },
    { id: 'post', label: '刊登', post: true },
    { id: 'bargains', label: '議價' },
    { id: 'me', label: '我的' },
  ];
  return `
    <nav class="tabbar" aria-label="主導覽">
      ${tabs
        .map(
          (t) => `
        <button class="tab ${t.post ? 'post' : ''} ${active === t.id ? 'active' : ''}" data-go="${t.id}" type="button">
          <span class="ico">${tabIcon(t.id)}</span>
          <span>${t.label}</span>
        </button>`
        )
        .join('')}
    </nav>`;
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

function renderLogin() {
  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="home" aria-label="返回">←</button>
      <h1>登入</h1>
    </header>
    ${offlineBanner()}
    <form class="form" id="login-form">
      <div class="field">
        <label for="email">電郵</label>
        <input id="email" name="email" type="email" autocomplete="username" required placeholder="demo@aomai.got" />
      </div>
      <div class="field">
        <label for="password">密碼</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="至少 6 位" />
      </div>
      <p class="meta" style="padding:0 4px 8px">示範帳號：demo@aomai.got / demo1234</p>
      <div class="actionbar" style="position:static;transform:none;max-width:none;padding:8px 0 0;border:0">
        <button class="btn ghost" type="button" data-go="register">註冊</button>
        <button class="btn primary" type="submit">登入</button>
      </div>
      <p class="form-links">
        <button class="text-link" type="button" data-go="forgot">忘記密碼</button>
      </p>
    </form>`;
  app.innerHTML = shell(content, { noTab: true });
  app.querySelector('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await login(String(fd.get('email')).trim(), String(fd.get('password')));
      toast('登入成功');
      const next = sessionStorage.getItem('aomai-after-login') || 'home';
      sessionStorage.removeItem('aomai-after-login');
      go(next);
    } catch (err) {
      errToast(err, '登入失敗');
    }
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
      <div class="actionbar" style="position:static;transform:none;max-width:none;padding:8px 0 0;border:0">
        <button class="btn ghost" type="button" data-go="login">已有帳號</button>
        <button class="btn primary" type="submit">建立帳號</button>
      </div>
    </form>`;
  app.innerHTML = shell(content, { noTab: true });
  app.querySelector('#register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await register(
        String(fd.get('name')).trim(),
        String(fd.get('email')).trim(),
        String(fd.get('password'))
      );
      toast('註冊成功');
      const next = sessionStorage.getItem('aomai-after-login') || 'home';
      sessionStorage.removeItem('aomai-after-login');
      go(next);
    } catch (err) {
      errToast(err, '註冊失敗');
    }
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
        <input id="email" name="email" type="email" autocomplete="email" required placeholder="demo@aomai.got" />
      </div>
      <p class="meta" id="forgot-note" style="padding:0 4px">輸入註冊電郵。此示範不會寄出電郵，送出後只確認已收到申請。</p>
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
      toast(data?.message || '密碼已更新，請重新登入', 2800);
      go('login');
    } catch (err) {
      errToast(err, '重設失敗');
      if (submit) submit.disabled = false;
    }
  });
}

function renderPrivacy() {
  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="me" aria-label="返回">←</button>
      <h1>隱私政策</h1>
    </header>
    <div class="privacy-box">
      <p class="meta">載入中…</p>
      <iframe class="privacy-frame" title="隱私政策" src="${escapeAttr(privacyUrl())}"></iframe>
      <p class="meta" style="padding:12px 0">若無法顯示，請開啟：<a href="${escapeAttr(privacyUrl())}" target="_blank" rel="noopener">${escapeHtml(privacyUrl())}</a></p>
    </div>`;
  app.innerHTML = shell(content, { noTab: true });
}

/* ---------- Screens ---------- */

async function renderHome() {
  const q = (sessionStorage.getItem('aomai-q') || '').trim();
  const cat = sessionStorage.getItem('aomai-cat') || '全部';

  let list = [];
  if (getState().online) {
    try {
      list = await fetchHomeListings({ q, category: cat });
    } catch (err) {
      errToast(err, '載入刊登失敗');
      list = getState().listings;
    }
  }

  const content = `
    <div class="home-head">
      <header class="topbar topbar-brand">
        <div class="brand brand-home">
          <img class="brand-logo brand-logo-home" data-brand-logo="auto" src="${brandLogoSrc()}" alt="澳賣 GOT" />
          <span class="muted tiny brand-tagline">一物一故事 · 閑置亦有價</span>
        </div>
      </header>
      <div class="search">
        <span aria-hidden="true">⌕</span>
        <input id="search" type="search" lang="zh-Hant" inputmode="search" enterkeyhint="search" placeholder="搜尋附近二手…" value="${escapeAttr(q)}" />
      </div>
      <div class="chips" id="cats">
        ${CATEGORIES.map(
          (c) => `<button type="button" class="chip ${c === cat ? 'active' : ''}" data-cat="${c}">${c}</button>`
        ).join('')}
      </div>
    </div>
    ${offlineBanner()}
    ${
      list.length
        ? `<div class="grid">
      ${list.map((l) => listingCard(l)).join('')}
    </div>`
        : `<div class="empty">${
            getState().online ? '沒有符合的刊登<br/>換個關鍵字或分類試試' : '伺服器未連線<br/>啟動後端後重新整理'
          }</div>`
    }`;

  const keepFocus = document.activeElement?.id === 'search';
  const selStart = keepFocus ? document.activeElement.selectionStart : null;
  const selEnd = keepFocus ? document.activeElement.selectionEnd : null;

  app.innerHTML = shell(content, { tab: 'home', screenClass: 'home-screen' });

  const search = app.querySelector('#search');
  if (keepFocus && search) {
    search.focus();
    try {
      search.setSelectionRange(selStart ?? search.value.length, selEnd ?? search.value.length);
    } catch (_) {}
  }

  const scheduleHome = () => {
    clearTimeout(renderHome._t);
    renderHome._t = setTimeout(() => {
      const routeName = parseHash().parts[0] || 'home';
      if (routeName !== 'home') return;
      renderHome();
    }, 180);
  };

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

  app.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sessionStorage.setItem('aomai-cat', btn.dataset.cat);
      renderHome();
    });
  });
}

const uiGallery = { id: '', index: 0 };
let offerSheetKeyHandler = null;

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
      const { thread } = await addOffer({
        listingId: listing.id,
        amount: bid,
        meetup: String(fd.get('meetup') || MEETUPS[0]),
        message: String(fd.get('message') || '').trim(),
      });
      if (onSuccess) onSuccess(thread);
    } catch (err) {
      buttons.forEach((btn) => {
        btn.disabled = false;
      });
      if (err?.code === 'LISTING_SOLD') {
        closeOfferSheet();
        toast('此商品已售出');
        go(`detail/${listing.id}`);
        return;
      }
      errToast(err, '送出失敗，請再試');
    }
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
  if (isSold(l)) return;
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
      <p class="trust-note offer-trust-note">出價會傳給賣家，並在訊息裡開啟對話。平台不代收款、不代鑑定。</p>
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
    onSuccess: (thread) => {
      closeOfferSheet();
      toast('出價已送出');
      if (thread) go(`chat/${thread.id}`);
      else renderDetail(l.id);
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
  const src = photos[index];
  return `<div class="gallery ${sold ? 'sold' : ''}" id="gallery">
    <div class="gallery-stage" style="background:${escapeAttr(l.tone || '')}">
      <img class="hero-img" src="${escapeAttr(src)}" alt="${escapeAttr(l.title)}" />
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
              `<button type="button" class="gallery-thumb ${i === index ? 'on' : ''}" data-photo="${i}" aria-label="第 ${i + 1} 張"><img src="${escapeAttr(p)}" alt="" /></button>`
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
    if (img) img.src = photos[uiGallery.index];
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

async function renderDetail(id) {
  const state = getState();
  let l = getListing(id);
  if (state.online) {
    try {
      l = await refreshListing(id);
    } catch {
      /* use cache */
    }
  }
  if (!l) {
    go('home');
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
  const myOffer = isLoggedIn() ? getOffersForListing(l.id).find((o) => o.fromId === state.me.id) : null;
  const thread = getThreadByListing(l.id);

  const actionButtons = isSeller
    ? `
      <button class="btn ${sold ? 'ghost' : 'primary'}" type="button" id="toggle-sold">
        ${sold ? '取消已售出' : '標示為已售出'}
      </button>
      <button class="btn ghost" type="button" data-go="mine">我的刊登</button>`
    : sold
      ? `
      <button class="btn primary" type="button" disabled aria-disabled="true">已售出</button>
      <button class="btn ghost" type="button" disabled aria-disabled="true">想要</button>`
      : `
      <button class="btn primary" type="button" id="go-bargain">議價</button>
      <button class="btn ghost" type="button" id="want">${wanted ? '已想要' : '想要'}</button>`;

  const offerNote = myOffer
    ? `<div class="my-offer-note">
        <span>你的出價 ${money(myOffer.amount)}</span>
        <button type="button" class="text-link" id="my-offer-link">${thread ? '查看對話' : '再出價'}</button>
      </div>`
    : '';

  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="home" aria-label="返回">←</button>
      <h1>商品詳情</h1>
    </header>
    ${galleryHtml(l, photos)}
    <section class="price-block">
      <div class="price-row">
        ${priceHtml(l.price, sold)}
        ${sold ? '<span class="pill sold">已售</span>' : ''}
      </div>
      <h2>${escapeHtml(l.title)}</h2>
      <div class="trust-row">${trustHtml(l)}</div>
      <p class="trust-note">鄰里二手 · 成色由賣家自行標示。平台不提供鑑定，也不代為寄倉。</p>
    </section>
    <section class="detail-body">
      <div class="meta">${escapeHtml(l.location)} · ${escapeHtml(l.category)}</div>
      <div class="section-label">說明</div>
      <p class="desc">${escapeHtml(l.description)}</p>
      ${offerNote}
      <div class="section-label">賣家</div>
      <div class="seller-card">
        <div class="avatar">${escapeHtml(l.sellerAvatar)}</div>
        <div>
          <div class="name-row">
            <span class="name">${escapeHtml(l.sellerName)}</span>
            ${l.sellerVerified ? '<span class="trust-badge trust-verified">賣家已驗證</span>' : ''}
          </div>
          <div class="meta">${escapeHtml(l.sellerBio || '街坊賣家')}</div>
        </div>
      </div>
    </section>
    <div class="actionbar">
      ${actionButtons}
    </div>`;

  app.innerHTML = shell(content, { noTab: true });
  bindGallery(photos);
  app.querySelector('#go-bargain')?.addEventListener('click', () => openOfferSheet(l));
  app.querySelector('#my-offer-link')?.addEventListener('click', () => {
    if (thread) go(`chat/${thread.id}`);
    else openOfferSheet(l);
  });
  app.querySelector('#want')?.addEventListener('click', async () => {
    if (isSold(l)) return;
    if (!requireAuth(`detail/${l.id}`)) return;
    try {
      await addWant(l.id);
      toast('已加入我想要');
      renderDetail(id);
    } catch (err) {
      errToast(err);
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

async function renderBargain(id) {
  if (!requireAuth(`bargain/${id}`)) return;
  let l = getListing(id);
  try {
    l = await refreshListing(id);
  } catch (err) {
    errToast(err);
  }
  if (!l) {
    go('home');
    return;
  }
  if (isSold(l)) {
    toast('此商品已售出');
    go(`detail/${l.id}`);
    return;
  }
  if (isLoggedIn() && l.sellerId === getState().me.id) {
    toast('這是你的刊登');
    go(`detail/${l.id}`);
    return;
  }
  const offers = getOffersForListing(id);
  const content = `
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
            <span class="amount">${money(o.amount)}</span>
          </div>
          <div class="meta">${escapeHtml(o.meetup)}${o.message ? ` · ${escapeHtml(o.message)}` : ''}</div>
        </div>`
              )
              .join('')
          : `<div class="empty" style="padding:16px 0">還沒有出價，輸入金額做第一個</div>`
      }
    </div>
    <div class="actionbar">
      <button class="btn ghost" type="button" data-go="detail/${l.id}">取消</button>
      <button class="btn primary" type="submit" form="offer-form">送出出價</button>
    </div>`;

  app.innerHTML = shell(content, { noTab: true });
  bindOfferForm(app.querySelector('#offer-form'), l, {
    onSuccess: (thread) => {
      toast('出價已送出');
      if (thread) go(`chat/${thread.id}`);
      else renderBargain(id);
    },
  });
}

function renderPost() {
  if (!requireAuth('post')) return;
  const catOpts = CATEGORIES.filter((c) => c !== '全部')
    .map((c) => `<option value="${c}">${c}</option>`)
    .join('');
  const locOpts = LOCATIONS.map((c) => `<option value="${c}">${c}</option>`).join('');
  const condOpts = CONDITIONS.map((c) => `<option value="${c}">${c}</option>`).join('');

  const photos = ['', '', ''];
  let photoBusy = false;

  const paintSlots = () => {
    const row = app.querySelector('#photo-row');
    const actions = app.querySelector('#photo-actions');
    if (!row) return;
    row.innerHTML = [0, 1, 2]
      .map((i) => {
        const src = photos[i];
        // Album input: no `capture`. That attribute forces the camera and
        // hides the photo library on iOS Safari, mobile Safari, and many WebViews.
        // The input itself is the hit target (inside a label) so the tap is a real gesture.
        const albumInput = `<input class="photo-file-input" type="file" accept="image/*" multiple data-slot="${i}" aria-label="${
          src ? '從相簿更換照片' : '從相簿加圖'
        }" />`;
        if (src) {
          return `
            <div class="photo-slot filled has-img">
              <img src="${escapeAttr(src)}" alt="" />
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
  };

  app.innerHTML = shell(
    `
    <header class="topbar"><h1>刊登商品</h1></header>
    <form class="form" id="post-form">
      <div class="field" id="photo-field">
        <label>照片（最多 3 張）</label>
        <div class="photo-row" id="photo-row"></div>
        <p class="photo-hint">加圖從相簿選取，可多選。拍照會開啟相機。</p>
        <div class="photo-actions" id="photo-actions"></div>
      </div>
      <div class="field">
        <label for="title">標題</label>
        <input id="title" name="title" lang="zh-Hant" inputmode="text" autocomplete="off" required maxlength="40" placeholder="例如：雙門雪櫃 運作正常" />
      </div>
      <div class="field">
        <label for="price">價錢（MOP）</label>
        <input id="price" name="price" type="number" min="1" required placeholder="例如：800" />
      </div>
      <div class="field">
        <label for="category">分類</label>
        <select id="category" name="category">${catOpts}</select>
      </div>
      <div class="field">
        <label for="location">地點</label>
        <select id="location" name="location">${locOpts}</select>
      </div>
      <div class="field">
        <label for="condition">狀況</label>
        <select id="condition" name="condition">${condOpts}</select>
      </div>
      <div class="field">
        <label>交收</label>
        <div class="chips tight" id="handover-chips">
          ${HANDOVERS.map(
            (h, i) =>
              `<button type="button" class="chip ${i === 0 ? 'active' : ''}" data-handover="${escapeAttr(h)}">${escapeHtml(h)}</button>`
          ).join('')}
        </div>
        <input type="hidden" name="handover" id="handover" value="${escapeAttr(HANDOVERS[0])}" />
      </div>
      <div class="field check-field">
        <label class="check-row">
          <input type="checkbox" name="negotiable" checked />
          <span>可議價</span>
        </label>
        <p class="photo-hint">成色與交收會顯示給買家。這是街坊面交，平台不提供鑑定。</p>
      </div>
      <div class="field">
        <label for="description">描述</label>
        <textarea id="description" name="description" lang="zh-Hant" inputmode="text" autocomplete="off" required placeholder="說明狀況、交收時間、是否可議…"></textarea>
      </div>
      <div class="actionbar" style="position:static;transform:none;max-width:none;padding:8px 0 0;border:0">
        <button class="btn ghost" type="button" data-go="home">取消</button>
        <button class="btn primary" type="submit">發佈</button>
      </div>
    </form>`,
    { tab: 'post' }
  );

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
      toast('最多 3 張照片');
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
        } catch {
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
    if (images.length > targets.length) toast(`已加入 ${added} 張（最多 3 張）`);
    else if (added > 1) toast(`已加入 ${added} 張照片`);
    else toast('已加入照片');
  });

  paintSlots();

  app.querySelectorAll('[data-handover]').forEach((btn) => {
    btn.addEventListener('click', () => {
      app.querySelectorAll('[data-handover]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const input = app.querySelector('#handover');
      if (input) input.value = btn.dataset.handover;
    });
  });

  app.querySelector('#post-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const filled = photos.filter(Boolean);
    const btn = e.target.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const listing = await addListing({
        title: String(fd.get('title')).trim(),
        price: Number(fd.get('price')),
        category: String(fd.get('category')),
        location: String(fd.get('location')),
        condition: String(fd.get('condition')),
        description: String(fd.get('description')).trim(),
        handover: String(fd.get('handover') || HANDOVERS[0]),
        negotiable: fd.get('negotiable') === 'on',
        photos: filled,
      });
      toast('已發佈');
      go(`detail/${listing.id}`);
    } catch (err) {
      errToast(err, '發佈失敗：請檢查圖片大小或網路');
      if (btn) btn.disabled = false;
    }
  });
}

async function renderMessages() {
  if (!requireAuth('messages')) return;
  try {
    await refreshThreads();
  } catch (err) {
    errToast(err);
  }
  const { threads, listings } = getState();
  const content = `
    <header class="topbar"><h1>訊息</h1></header>
    ${
      threads.length
        ? threads
            .map((t) => {
              const l = listings.find((x) => x.id === t.listingId) || t.listing;
              return `
          <button class="thread" type="button" data-go="chat/${t.id}">
            <div class="avatar sm">${escapeHtml(t.peerAvatar)}</div>
            <div class="body">
              <div class="top">
                <span class="name">${escapeHtml(t.peerName)}</span>
                <span class="meta tiny">${escapeHtml(t.time)}</span>
              </div>
              <div class="preview">${escapeHtml(t.preview)}</div>
            </div>
            <div class="thumb-sm" style="background:${l?.tone || '#f5f5f5'}">${
                l ? thumbInner(l) : '📦'
              }</div>
            ${t.unread ? '<span class="dot" aria-label="未讀"></span>' : '<span style="width:8px"></span>'}
          </button>`;
            })
            .join('')
        : `<div class="empty">還沒有訊息<br/>去議價一筆商品吧</div>`
    }`;
  app.innerHTML = shell(content, { tab: 'messages' });
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

async function renderChat(threadId) {
  if (!requireAuth(`chat/${threadId}`)) return;
  let thread;
  try {
    thread = await markThreadRead(threadId);
  } catch (err) {
    errToast(err);
    go('messages');
    return;
  }
  if (!thread) {
    go('messages');
    return;
  }
  const state = getState();
  const l = getListing(thread.listingId) || thread.listing;
  const meId = state.me.id;
  const messages = Array.isArray(thread.messages) ? thread.messages : [];

  const bubbles = messages.length
    ? messages
        .map((m) => {
          const mine = m.fromId === meId;
          return `
          <div class="bubble-row ${mine ? 'me' : 'peer'}">
            <div class="bubble">
              <div class="bubble-text">${escapeHtml(m.text).replaceAll('\n', '<br/>')}</div>
              <div class="bubble-time">${formatMsgTime(m.createdAt)}</div>
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
          <div class="meta">${money(l.price)}${isSold(l) ? ' · 已售' : l.negotiable ? ' · 可議' : ''}</div>
        </div>
        <span class="chat-strip-link">詳情</span>
      </button>`
    : '';

  const bargainLink =
    l && !isSold(l) && l.sellerId !== meId
      ? `<button class="btn ghost chat-bargain-link" type="button" data-go="bargain/${l.id}">出價</button>`
      : '';

  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="messages" aria-label="返回">←</button>
      <h1>${escapeHtml(thread.peerName)}</h1>
      ${bargainLink}
    </header>
    ${strip}
    <div class="chat-log" id="chat-log">${bubbles}</div>
    <form class="chat-composer" id="chat-form">
      <input id="chat-input" type="text" lang="zh-Hant" inputmode="text" autocomplete="off" enterkeyhint="send" placeholder="輸入訊息…" maxlength="500" />
      <button class="btn primary chat-send" type="submit">送出</button>
    </form>`;

  app.innerHTML = shell(content, { noTab: true });

  const log = app.querySelector('#chat-log');
  if (log) log.scrollTop = log.scrollHeight;

  const input = app.querySelector('#chat-input');
  const draftKey = `aomai-chat-draft-${threadId}`;
  const savedDraft = sessionStorage.getItem(draftKey);
  if (input && savedDraft) {
    input.value = savedDraft;
  }
  input?.focus();
  try {
    if (input) input.setSelectionRange(input.value.length, input.value.length);
  } catch (_) {}

  app.querySelector('#chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (input?.dataset.composing === '1') return;
    const text = String(input?.value || '').trim();
    if (!text) return;
    try {
      await sendMessage(threadId, text);
    } catch (err) {
      errToast(err, '送出失敗');
      return;
    }
    input.value = '';
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

async function renderBargainsTab() {
  if (!requireAuth('bargains')) return;
  try {
    await refreshMyOffers();
    await refreshThreads();
  } catch (err) {
    errToast(err);
  }
  const state = getState();
  const myOffers = state.offers
    .filter((o) => o.fromId === state.me.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  const content = `
    <header class="topbar"><h1>我的議價</h1></header>
    ${
      myOffers.length
        ? myOffers
            .map((o) => {
              const l = getListing(o.listingId);
              if (!l) return '';
              const thread = getThreadByListing(l.id);
              const dest = thread ? `chat/${thread.id}` : `bargain/${l.id}`;
              return `
          <button class="thread" type="button" data-go="${dest}">
            <div class="thumb-sm" style="background:${l.tone}">${thumbInner(l)}</div>
            <div class="body">
              <div class="top">
                <span class="name">${escapeHtml(l.title)}</span>
                <span class="amount" style="font-size:13px">${money(o.amount)}</span>
              </div>
              <div class="preview">${escapeHtml(o.meetup)}${o.message ? ` · ${escapeHtml(o.message)}` : ''}</div>
            </div>
          </button>`;
            })
            .join('')
        : `<div class="empty">尚未送出議價<br/>在商品詳情點「議價」開始</div>`
    }`;
  app.innerHTML = shell(content, { tab: 'bargains' });
}

async function renderMine() {
  if (!requireAuth('mine')) return;
  try {
    await fetchHomeListings({});
  } catch (err) {
    errToast(err);
  }
  const state = getState();
  const list = state.listings
    .filter((l) => l.sellerId === state.me.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="me" aria-label="返回">←</button>
      <h1>我的刊登</h1>
    </header>
    ${
      list.length
        ? `<div class="mine-list">
      ${list
        .map((l) => {
          const sold = isSold(l);
          return `
        <div class="mine-row ${sold ? 'sold' : ''}">
          <button class="mine-main" type="button" data-go="detail/${l.id}">
            <div class="thumb-sm" style="background:${l.tone}">${thumbInner(l)}</div>
            <div class="body">
              <div class="top">
                <span class="name">${escapeHtml(l.title)}</span>
                <span class="amount" style="font-size:13px">${money(l.price)}</span>
              </div>
              <div class="preview">${escapeHtml(l.location)}${sold ? ' · 已售' : l.negotiable ? ' · 可議' : ''}</div>
            </div>
            ${sold ? '<span class="pill sold">已售</span>' : ''}
          </button>
          <button class="btn ${sold ? 'ghost' : 'primary'} mine-sold-btn" type="button" data-sold-toggle="${l.id}">
            ${sold ? '取消已售出' : '標示為已售出'}
          </button>
        </div>`;
        })
        .join('')}
    </div>`
        : `<div class="empty">還沒有刊登<br/>去「刊登」發佈第一件吧</div>`
    }`;

  app.innerHTML = shell(content, { tab: 'me' });
  app.querySelectorAll('[data-sold-toggle]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-sold-toggle');
      const listing = getListing(id);
      if (!listing) return;
      try {
        await setSold(id, !isSold(listing));
        toast(isSold(getListing(id)) ? '已標示為已售出' : '已取消已售出');
        renderMine();
      } catch (err) {
        errToast(err);
      }
    });
  });
}

async function renderWants() {
  if (!requireAuth('wants')) return;
  try {
    await refreshWants();
  } catch (err) {
    errToast(err);
  }
  const state = getState();
  const list = state.wants.map((id) => getListing(id)).filter(Boolean);

  const content = `
    <header class="topbar">
      <button class="back" type="button" data-go="me" aria-label="返回">←</button>
      <h1>我想要</h1>
    </header>
    ${
      list.length
        ? `<div class="grid">
      ${list.map((l) => listingCard(l)).join('')}
    </div>`
        : `<div class="empty">還沒有收藏<br/>在商品詳情點「想要」加入</div>`
    }`;

  app.innerHTML = shell(content, { tab: 'me' });
}

function showAbout() {
  document.querySelector('.about-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'about-overlay';
  overlay.innerHTML = `
    <div class="about-sheet" role="dialog" aria-label="關於澳賣 GOT">
      <div class="brand-strip brand-strip-dark">
        <img class="brand-logo brand-logo-lg" data-brand-logo="dark" src="${brandLogoSrc('dark')}" alt="澳賣 GOT" />
      </div>
      <div class="about-body">
        <p>澳門鄰里二手 · 議價為主</p>
        <p class="meta" style="margin:8px 0 16px">一物一故事 · 閑置亦有價</p>
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
  overlay.querySelector('#about-privacy')?.addEventListener('click', () => {
    close();
    go('privacy');
  });
}

async function renderMe() {
  const state = getState();
  const logged = isLoggedIn();
  let s = { posts: 0, bargains: 0, deals: 0 };
  if (logged) {
    try {
      s = await stats();
    } catch {
      /* ignore */
    }
  }
  const content = `
    <header class="topbar"><h1>我的</h1></header>
    ${offlineBanner()}
    <div class="brand-strip brand-strip-light">
      <img class="brand-logo brand-logo-lg" data-brand-logo="auto" src="${brandLogoSrc()}" alt="澳賣 GOT" />
    </div>
    <div class="profile">
      <div class="avatar lg">${escapeHtml(state.me.avatar)}</div>
      <div class="name">${escapeHtml(state.me.name)}</div>
      ${logged && state.me.verified ? '<span class="trust-badge trust-verified">已驗證</span>' : ''}
      <div class="meta">${escapeHtml(logged ? state.me.bio || state.me.email || '' : '登入後可刊登、議價與對話')}</div>
    </div>
    ${
      logged
        ? `<div class="stats">
      <div class="stat"><div class="n">${s.posts}</div><div class="l">刊登</div></div>
      <div class="stat"><div class="n">${s.bargains}</div><div class="l">議價</div></div>
      <div class="stat"><div class="n">${s.deals}</div><div class="l">成交</div></div>
    </div>`
        : ''
    }
    <div class="menu">
      ${
        logged
          ? `
      <button class="menu-row" type="button" data-go="mine"><span>我的刊登</span><span class="arrow">→</span></button>
      <button class="menu-row" type="button" data-go="wants"><span>我想要</span><span class="arrow">→</span></button>
      <button class="menu-row" type="button" data-go="bargains"><span>我的議價</span><span class="arrow">→</span></button>`
          : `
      <button class="menu-row" type="button" data-go="login"><span>登入</span><span class="arrow">→</span></button>
      <button class="menu-row" type="button" data-go="register"><span>註冊</span><span class="arrow">→</span></button>`
      }
      <button class="menu-row theme-row" type="button" id="theme-toggle" aria-pressed="${getTheme() === 'dark'}">
        <span>介面顏色</span>
        <span style="display:flex;align-items:center">
          <span class="theme-state">${getTheme() === 'dark' ? '深色模式' : '淺色模式'}</span>
          <span class="theme-switch" aria-hidden="true"></span>
        </span>
      </button>
      <button class="menu-row" type="button" data-go="privacy"><span>隱私政策</span><span class="arrow">→</span></button>
      <button class="menu-row" type="button" id="about"><span>關於澳賣 GOT</span><span class="arrow">→</span></button>
      ${
        logged
          ? `<button class="menu-row" type="button" id="logout"><span>登出</span><span class="arrow">→</span></button>`
          : ''
      }
    </div>`;
  app.innerHTML = shell(content, { tab: 'me' });
  app.querySelector('#theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    renderMe();
  });
  app.querySelector('#about')?.addEventListener('click', () => {
    showAbout();
  });
  app.querySelector('#logout')?.addEventListener('click', async () => {
    await logout();
    toast('已登出');
    renderMe();
  });
}

/* ---------- Router ---------- */

async function route() {
  closeOfferSheet();
  const { parts } = parseHash();
  const [a, b] = parts;
  switch (a) {
    case 'home':
    case undefined:
      await renderHome();
      break;
    case 'detail':
      await renderDetail(b);
      break;
    case 'bargain':
      await renderBargain(b);
      break;
    case 'post':
      renderPost();
      break;
    case 'messages':
      await renderMessages();
      break;
    case 'chat':
      await renderChat(b);
      break;
    case 'bargains':
    case 'offers':
      await renderBargainsTab();
      break;
    case 'mine':
      await renderMine();
      break;
    case 'wants':
      await renderWants();
      break;
    case 'me':
      await renderMe();
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
    case 'privacy':
      renderPrivacy();
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
  `<div class="empty" style="padding-top:40vh">載入中…</div>`,
  { noTab: true }
);

bootstrap()
  .then((r) => {
    if (!r.online) {
      toast('無法連接後端，請先執行 npm run server');
    }
    if (!location.hash) location.hash = '#/home';
    return route();
  })
  .catch((err) => {
    console.error(err);
    toast('啟動失敗');
    if (!location.hash) location.hash = '#/home';
    route();
  });
