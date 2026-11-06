const TOKEN_KEY = 'aomai-got-token';

export const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://127.0.0.1:8787');

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
    const q = qs.toString();
    return api(`/api/listings${q ? `?${q}` : ''}`, { auth: 'if' });
  },
  get: (id) => api(`/api/listings/${encodeURIComponent(id)}`, { auth: 'if' }),
  create: (payload) => api('/api/listings', { method: 'POST', body: payload, auth: true }),
  setSold: (id, sold) =>
    api(`/api/listings/${encodeURIComponent(id)}/sold`, {
      method: 'PATCH',
      body: { sold },
      auth: true,
    }),
  want: (id) =>
    api(`/api/listings/${encodeURIComponent(id)}/want`, { method: 'POST', auth: true }),
  unwant: (id) =>
    api(`/api/listings/${encodeURIComponent(id)}/want`, { method: 'DELETE', auth: true }),
  offers: (id) => api(`/api/listings/${encodeURIComponent(id)}/offers`, { auth: 'if' }),
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
  get: (id) => api(`/api/threads/${encodeURIComponent(id)}`, { auth: true }),
  send: (id, text) =>
    api(`/api/threads/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: { text },
      auth: true,
    }),
};

export const OffersApi = {
  mine: () => api('/api/offers/mine', { auth: true }),
  incoming: () => api('/api/offers/incoming', { auth: true }),
  respond: (id, payload) =>
    api(`/api/offers/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, auth: true }),
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
