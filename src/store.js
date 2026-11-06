import {
  AuthApi,
  ListingsApi,
  OffersApi,
  StatsApi,
  ThreadsApi,
  WantsApi,
  clearToken,
  getToken,
  healthCheck,
  setToken,
} from './api.js';

export const CATEGORIES = ['全部', '潮流', '服飾', '美妝', '數碼', '家電', '家居', '運動', '母嬰', '其他'];
export const LOCATIONS = ['澳門 · 附近', '氹仔', '中區', '路環', '黑沙環', '筷子基'];
export const CONDITIONS = ['全新', '幾乎全新', '良好', '有使用痕跡'];
export const MEETUPS = ['賣家地點', '買家地點', '中間點', '地鐵站'];
export const HANDOVERS = ['面交', '自取', '面交／自取'];

const GUEST_ME = {
  id: '',
  name: '訪客',
  avatar: '訪',
  bio: '登入後開始議價',
  email: '',
  verified: false,
};

function asMe(user) {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    bio: user.bio || '',
    email: user.email || '',
    verified: Boolean(user.verified),
  };
}

let state = {
  me: { ...GUEST_ME },
  listings: [],
  offers: [],
  threads: [],
  wants: [],
  ready: false,
  online: false,
};

export function getState() {
  return state;
}

export function isLoggedIn() {
  return Boolean(getToken() && state.me?.id);
}

export function getListing(id) {
  return state.listings.find((l) => l.id === id);
}

export function getThread(id) {
  return state.threads.find((t) => t.id === id);
}

export function getThreadByListing(listingId) {
  return state.threads.find((t) => t.listingId === listingId);
}

export function getOffersForListing(listingId) {
  return state.offers
    .filter((o) => o.listingId === listingId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function upsertListing(listing) {
  if (!listing) return;
  const i = state.listings.findIndex((l) => l.id === listing.id);
  if (i >= 0) state.listings[i] = listing;
  else state.listings = [listing, ...state.listings];
}

function upsertThread(thread) {
  if (!thread) return;
  const i = state.threads.findIndex((t) => t.id === thread.id);
  if (i >= 0) {
    state.threads[i] = thread;
    state.threads = [thread, ...state.threads.filter((t) => t.id !== thread.id)];
  } else {
    state.threads = [thread, ...state.threads];
  }
}

export async function bootstrap() {
  let online = false;
  try {
    online = await healthCheck();
  } catch {
    online = false;
  }
  state.online = online;

  if (!online) {
    state.ready = true;
    state.me = { ...GUEST_ME };
    state.listings = [];
    state.offers = [];
    state.threads = [];
    state.wants = [];
    return { online: false };
  }

  if (getToken()) {
    try {
      const { user } = await AuthApi.me();
      state.me = asMe(user);
    } catch {
      clearToken();
      state.me = { ...GUEST_ME };
    }
  } else {
    state.me = { ...GUEST_ME };
  }

  await refreshListings();
  if (isLoggedIn()) {
    await Promise.all([refreshThreads(), refreshWants(), refreshMyOffers()]);
  } else {
    state.threads = [];
    state.wants = [];
    state.offers = [];
  }
  state.ready = true;
  return { online: true, me: state.me };
}

export async function refreshListings(params = {}) {
  const { listings } = await ListingsApi.list(params);
  // Merge: keep full cache for detail navigation, but when filtering home we still replace visible set.
  // For simplicity, replace all when no filters; when filters, still replace (home uses session filters via API).
  if (!params.q && (!params.category || params.category === '全部')) {
    state.listings = listings;
  } else {
    // upsert filtered results without wiping others
    for (const l of listings) upsertListing(l);
    // Also store filtered list marker — home will call list directly via store helper
  }
  return listings;
}

export async function fetchHomeListings({ q = '', category = '全部' } = {}) {
  const { listings } = await ListingsApi.list({
    q: q || undefined,
    category: category !== '全部' ? category : undefined,
  });
  for (const l of listings) upsertListing(l);
  return listings;
}

export async function refreshListing(id) {
  const { listing } = await ListingsApi.get(id);
  upsertListing(listing);
  try {
    const { offers } = await ListingsApi.offers(id);
    state.offers = [...offers, ...state.offers.filter((o) => o.listingId !== id)];
  } catch {
    /* offers optional when offline auth */
  }
  return listing;
}

export async function refreshThreads() {
  if (!isLoggedIn()) {
    state.threads = [];
    return [];
  }
  const { threads } = await ThreadsApi.list();
  state.threads = threads;
  return threads;
}

export async function refreshWants() {
  if (!isLoggedIn()) {
    state.wants = [];
    return [];
  }
  const { wants } = await WantsApi.list();
  state.wants = wants;
  return wants;
}

export async function refreshMyOffers() {
  if (!isLoggedIn()) {
    state.offers = state.offers.filter(() => false);
    return [];
  }
  const { offers } = await OffersApi.mine();
  // keep offers for other listings from detail fetches
  const mineIds = new Set(offers.map((o) => o.id));
  state.offers = [...offers, ...state.offers.filter((o) => o.fromId !== state.me.id && !mineIds.has(o.id))];
  return offers;
}

export async function login(email, password) {
  const { token, user } = await AuthApi.login({ email, password });
  setToken(token);
  state.me = asMe(user);
  await Promise.all([refreshListings(), refreshThreads(), refreshWants(), refreshMyOffers()]);
  return state.me;
}

export async function register(name, email, password) {
  const { token, user } = await AuthApi.register({ name, email, password });
  setToken(token);
  state.me = asMe(user);
  await Promise.all([refreshListings(), refreshThreads(), refreshWants(), refreshMyOffers()]);
  return state.me;
}

export async function requestPasswordReset(email) {
  return AuthApi.forgot({ email });
}

export async function resetPassword(token, password) {
  return AuthApi.reset({ token, password });
}

export async function logout() {
  clearToken();
  state.me = { ...GUEST_ME };
  state.threads = [];
  state.wants = [];
  state.offers = [];
  await refreshListings().catch(() => {});
}

export async function addListing(payload) {
  const { listing } = await ListingsApi.create(payload);
  upsertListing(listing);
  return listing;
}

export async function addOffer({ listingId, amount, meetup, message }) {
  const { offer, thread } = await ListingsApi.createOffer(listingId, {
    amount,
    meetup,
    message,
  });
  state.offers = [offer, ...state.offers.filter((o) => o.id !== offer.id)];
  upsertThread(thread);
  return { offer, thread };
}

export async function sendMessage(threadId, text) {
  const { message, thread } = await ThreadsApi.send(threadId, text);
  upsertThread(thread);
  return message;
}

export async function markThreadRead(threadId) {
  const { thread } = await ThreadsApi.get(threadId);
  upsertThread(thread);
  return thread;
}

export async function addWant(listingId) {
  const { wants } = await ListingsApi.want(listingId);
  state.wants = wants;
}

export async function removeWant(listingId) {
  const { wants } = await ListingsApi.unwant(listingId);
  state.wants = wants;
}

export async function setSold(listingId, sold) {
  const { listing } = await ListingsApi.setSold(listingId, sold);
  upsertListing(listing);
  return listing;
}

export async function stats() {
  if (!isLoggedIn()) return { posts: 0, bargains: 0, deals: 0 };
  try {
    return await StatsApi.get();
  } catch {
    const mine = state.listings.filter((l) => l.sellerId === state.me.id);
    const myOffers = state.offers.filter((o) => o.fromId === state.me.id);
    return {
      posts: mine.length,
      bargains: myOffers.length,
      deals: mine.filter((l) => l.sold).length,
    };
  }
}
