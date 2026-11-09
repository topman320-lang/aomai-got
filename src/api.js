const TOKEN_KEY = 'aomai-got-token';

/** Live API. The website is same-origin with this host; native WebViews are not. */
const PROD_API_ORIGIN = 'https://aomai-got.onrender.com';
const DEV_API_ORIGIN = 'http://127.0.0.1:8787';

/**
 * Where `/api/...` is fetched.
 *
 * A non-empty `VITE_API_URL` wins, so an iOS build can pin the host with
 * `VITE_API_URL=https://aomai-got.onrender.com npm run build:mobile`.
 * Unset or empty (Render sets `VITE_API_URL=`) stays relative in a production
 * web build and uses the local API in dev. `capacitor:`, `ionic:`, and
 * `file:` are not that origin, so those shells use `PROD_API_ORIGIN` even
 * when the baked-in value is empty.
 */
export function resolveApiBase({ viteApiUrl, prod = false, protocol = '' } = {}) {
  const configured = normalizeApiBase(viteApiUrl);
  if (configured) return configured;
  if (isNativeShellProtocol(protocol)) return PROD_API_ORIGIN;
  if (prod) return '';
  return DEV_API_ORIGIN;
}

function normalizeApiBase(value) {
  if (value == null) return '';
  return String(value).trim().replace(/\/+$/, '');
}

function isNativeShellProtocol(protocol) {
  const value = String(protocol || '').trim().toLowerCase();
  const withColon = value.endsWith(':') ? value : `${value}:`;
  return withColon === 'capacitor:' || withColon === 'ionic:' || withColon === 'file:';
}

function readBuildFlags() {
  // Vite inlines these member expressions. Node's test runner has no env object.
  try {
    return {
      viteApiUrl: import.meta.env.VITE_API_URL,
      prod: Boolean(import.meta.env.PROD),
    };
  } catch {
    return { viteApiUrl: undefined, prod: false };
  }
}

function readPageProtocol() {
  try {
    if (typeof location === 'undefined' || !location) return '';
    return location.protocol || '';
  } catch {
    return '';
  }
}

const buildFlags = readBuildFlags();
export const API_BASE = resolveApiBase({
  viteApiUrl: buildFlags.viteApiUrl,
  prod: buildFlags.prod,
  protocol: readPageProtocol(),
});

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function clearToken() {
  setToken('');
}

export class ApiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export async function api(path, { method = 'GET', body, auth = false, headers = {} } = {}) {
  const opts = {
    method,
    headers: { ...headers },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (auth === true || auth === 'if') {
    const token = getToken();
    if (!token && auth === true) throw new ApiError('請先登入', { status: 401, code: 'UNAUTHORIZED' });
    if (token) opts.headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, opts);
  } catch (err) {
    throw new ApiError('無法連接伺服器，請確認後端已啟動（port 8787）', {
      status: 0,
      code: 'NETWORK',
      body: err,
    });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new ApiError(data?.message || data?.error || `請求失敗 (${res.status})`, {
      status: res.status,
      code: data?.error || 'HTTP_ERROR',
      body: data,
    });
  }
  return data;
}

export async function healthCheck() {
  try {
    const data = await api('/api/health');
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

export const AuthApi = {
  register: (payload) => api('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => api('/api/auth/login', { method: 'POST', body: payload }),
  resendVerification: (payload) => api('/api/auth/resend-verification', { method: 'POST', body: payload }),
  forgot: (payload) => api('/api/auth/forgot', { method: 'POST', body: payload }),
  reset: (payload) => api('/api/auth/reset', { method: 'POST', body: payload }),
  me: () => api('/api/me', { auth: true }),
  updateMe: (payload) => api('/api/me', { method: 'PATCH', body: payload, auth: true }),
};

export const ListingsApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.category) qs.set('category', params.category);
    if (params.min != null && params.min !== '') qs.set('min', String(params.min));
    if (params.max != null && params.max !== '') qs.set('max', String(params.max));
    if (params.limit != null && params.limit !== '') qs.set('limit', String(params.limit));
    if (params.offset != null && params.offset !== '') qs.set('offset', String(params.offset));
    if (params.mine) qs.set('mine', '1');
    const q = qs.toString();
    return api(`/api/listings${q ? `?${q}` : ''}`, { auth: params.mine ? true : 'if' });
  },
  get: (id) => api(`/api/listings/${encodeURIComponent(id)}`, { auth: 'if' }),
  create: (payload) => api('/api/listings', { method: 'POST', body: payload, auth: true }),
  update: (id, payload) =>
    api(`/api/listings/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, auth: true }),
  setSold: (id, sold) =>
    api(`/api/listings/${encodeURIComponent(id)}/sold`, {
      method: 'PATCH',
      body: { sold },
      auth: true,
    }),
  remove: (id) => api(`/api/listings/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),
  confirmReceipt: (id) =>
    api(`/api/listings/${encodeURIComponent(id)}/confirm-receipt`, { method: 'POST', auth: true }),
  want: (id) =>
    api(`/api/listings/${encodeURIComponent(id)}/want`, { method: 'POST', auth: true }),
  unwant: (id) =>
    api(`/api/listings/${encodeURIComponent(id)}/want`, { method: 'DELETE', auth: true }),
  offers: (id) => api(`/api/listings/${encodeURIComponent(id)}/offers`, { auth: true }),
  review: (id, payload) =>
    api(`/api/listings/${encodeURIComponent(id)}/reviews`, { method: 'POST', body: payload, auth: true }),
  createOffer: (id, payload) =>
    api(`/api/listings/${encodeURIComponent(id)}/offers`, {
      method: 'POST',
      body: payload,
      auth: true,
    }),
};

export const WantsApi = {
  list: () => api('/api/wants', { auth: true }),
};

export const ThreadsApi = {
  list: () => api('/api/threads', { auth: true }),
  openForListing: (listingId) =>
    api(`/api/listings/${encodeURIComponent(listingId)}/thread`, { method: 'POST', auth: true }),
  get: (id) => api(`/api/threads/${encodeURIComponent(id)}`, { auth: true }),
  send: (id, payload) =>
    api(`/api/threads/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: typeof payload === 'string' ? { text: payload } : payload,
      auth: true,
    }),
  hide: (id) => api(`/api/threads/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),
  remove: (threadId, messageId) =>
    api(
      `/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE', auth: true }
    ),
};

export const OffersApi = {
  mine: () => api('/api/offers/mine', { auth: true }),
  incoming: () => api('/api/offers/incoming', { auth: true }),
  respond: (id, payload) =>
    api(`/api/offers/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, auth: true }),
  hide: (id) => api(`/api/offers/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }),
  saveHandoff: (id, payload) =>
    api(`/api/offers/${encodeURIComponent(id)}/handoff`, { method: 'PUT', body: payload, auth: true }),
  confirmHandoff: (id) =>
    api(`/api/offers/${encodeURIComponent(id)}/handoff/confirm`, { method: 'POST', auth: true }),
};

export const NoticesApi = {
  list: () => api('/api/notifications', { auth: true }),
  read: (ids) => api('/api/notifications/read', { method: 'POST', body: { ids: ids || [] }, auth: true }),
  pushStatus: () => api('/api/push/status', { auth: true }),
};

export const DevicesApi = {
  register: (payload) => api('/api/devices', { method: 'POST', body: payload, auth: true }),
};

export const StatsApi = {
  get: () => api('/api/stats', { auth: true }),
};

export const BadgesApi = {
  get: () => api('/api/badges', { auth: true }),
};

export const UsersApi = {
  get: (id) => api(`/api/users/${encodeURIComponent(id)}`, { auth: 'if' }),
};

export const PriceApi = {
  hint: (category, condition) => {
    const qs = new URLSearchParams({
      category: category || '其他',
      condition: condition || '良好',
    });
    return api(`/api/price-hint?${qs}`);
  },
};

export function privacyUrl() {
  return `${API_BASE}/privacy`;
}

export function supportUrl() {
  return `${API_BASE}/support`;
}
