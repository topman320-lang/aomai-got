import {
  AuthApi,
  BadgesApi,
  ListingsApi,
  OffersApi,
  PriceApi,
  StatsApi,
  ThreadsApi,
  UsersApi,
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
    trust: user.trust || null,
  };
}

let state = {
  me: { ...GUEST_ME },
  listings: [],
  offers: [],
  incomingOffers: [],
  threads: [],
  wants: [],
  badges: { messages: 0, offers: 0 },
  ready: false,
  online: false,
};

export function getState() {
  return state;
}

export function isLoggedIn() {
  return Boolean(getToken() && state.me?.id);
}

export function getBadges() {
  return state.badges || { messages: 0, offers: 0 };
}

export function syncBadges() {
  if (!isLoggedIn()) {
    state.badges = { messages: 0, offers: 0 };
    return state.badges;
  }
  const me = state.me.id;
  const messages = state.threads.filter((t) => t.unread).length;
  const seen = new Set();
  let offers = 0;
  const consider = (offer) => {
    if (!offer || seen.has(offer.id)) return;
    seen.add(offer.id);
    const listing = state.listings.find((l) => l.id === offer.listingId);
    if (listing?.sold) return;
    const status = offer.status || 'pending';
    if (offer.fromId === me && status === 'countered') {
      offers += 1;
      return;
    }
    if (offer.fromId !== me && status === 'pending') {
      const incoming = (state.incomingOffers || []).some((item) => item.id === offer.id);
      if (incoming || listing?.sellerId === me) offers += 1;
    }
  };
  for (const offer of state.incomingOffers || []) consider(offer);
  for (const offer of state.offers || []) consider(offer);
  state.badges = { messages, offers };
  return state.badges;
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
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
}

function cleanBound(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Same rules as GET /api/listings: title, description, place, category, and price. */
export function listingMatches(listing, { q = '', category = '全部', min = null, max = null } = {}) {
  if (!listing) return false;
  if (category && category !== '全部' && listing.category !== category) return false;
  const query = String(q || '').trim().toLowerCase();
  if (query) {
    const blob = `${listing.title || ''}\n${listing.description || ''}\n${listing.location || ''}\n${listing.category || ''}`.toLowerCase();
    if (!blob.includes(query)) return false;
  }
  const lo = cleanBound(min);
  const hi = cleanBound(max);
  if (lo != null && hi != null && lo > hi) return false;
  const price = Number(listing.price);
  if (lo != null && price < lo) return false;
  if (hi != null && price > hi) return false;
  return true;
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
    state.incomingOffers = [];
    state.threads = [];
    state.wants = [];
    state.badges = { messages: 0, offers: 0 };
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
    await Promise.all([refreshThreads(), refreshWants()]);
    await refreshMyOffers();
    await refreshIncomingOffers();
  } else {
    state.threads = [];
    state.wants = [];
    state.offers = [];
    state.incomingOffers = [];
    state.badges = { messages: 0, offers: 0 };
  }
  if (isLoggedIn()) await refreshBadges();
  else syncBadges();
  state.ready = true;
  return { online: true, me: state.me };
}

export async function refreshListings(params = {}) {
  const { listings } = await ListingsApi.list(params);
  const priceFiltered = params.min != null || params.max != null;
  if (!params.q && (!params.category || params.category === '全部') && !priceFiltered) {
    state.listings = listings;
  } else {
    for (const l of listings) upsertListing(l);
  }
  return listings;
}

export async function fetchHomeListings({ q = '', category = '全部', min = null, max = null } = {}) {
  const lo = cleanBound(min);
  const hi = cleanBound(max);
  const { listings } = await ListingsApi.list({
    q: q || undefined,
    category: category !== '全部' ? category : undefined,
    min: lo == null ? undefined : lo,
    max: hi == null ? undefined : hi,
  });
  const visible = listings.filter((l) => listingMatches(l, { q, category, min: lo, max: hi }));
  for (const l of visible) upsertListing(l);
  return visible;
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
  syncBadges();
  return threads;
}

export async function refreshWants() {
  if (!isLoggedIn()) {
    state.wants = [];
    return [];
  }
  const data = await WantsApi.list();
  state.wants = data.wants || [];
  for (const listing of data.listings || []) upsertListing(listing);
  return state.wants;
}

export async function refreshMyOffers() {
  if (!isLoggedIn()) {
    state.offers = state.offers.filter(() => false);
    return [];
  }
  const { offers } = await OffersApi.mine();
  const mineIds = new Set(offers.map((o) => o.id));
  state.offers = [...offers, ...state.offers.filter((o) => o.fromId !== state.me.id && !mineIds.has(o.id))];
  syncBadges();
  return offers;
}

export async function refreshIncomingOffers() {
  if (!isLoggedIn()) {
    state.incomingOffers = [];
    return [];
  }
  const { offers } = await OffersApi.incoming();
  state.incomingOffers = offers;
  const ids = new Set(offers.map((o) => o.id));
  state.offers = [...offers, ...state.offers.filter((o) => !ids.has(o.id))];
  syncBadges();
  return offers;
}

export async function refreshBadges() {
  if (!isLoggedIn()) {
    state.badges = { messages: 0, offers: 0 };
    return state.badges;
  }
  try {
    const data = await BadgesApi.get();
    state.badges = {
      messages: Number(data?.messages) || 0,
      offers: Number(data?.offers) || 0,
    };
  } catch {
    syncBadges();
  }
  return state.badges;
}

export async function login(email, password) {
  const { token, user } = await AuthApi.login({ email, password });
  setToken(token);
  state.me = asMe(user);
  await Promise.all([refreshListings(), refreshThreads(), refreshWants()]);
  await refreshMyOffers();
  await refreshIncomingOffers();
  await refreshBadges();
  return state.me;
}

export async function register(name, email, password) {
  const { token, user } = await AuthApi.register({ name, email, password });
  setToken(token);
  state.me = asMe(user);
  await Promise.all([refreshListings(), refreshThreads(), refreshWants()]);
  await refreshMyOffers();
  await refreshIncomingOffers();
  await refreshBadges();
  return state.me;
}

function withSeller(listing, me) {
  if (!listing || listing.sellerId !== me.id) return listing;
  return {
    ...listing,
    sellerName: me.name,
    sellerAvatar: me.avatar,
    sellerBio: me.bio || '',
  };
}

export async function updateProfile(payload) {
  const { user } = await AuthApi.updateMe(payload);
  const me = asMe(user);
  state.me = me;
  state.listings = state.listings.map((l) => withSeller(l, me));
  state.threads = state.threads.map((t) => ({
    ...t,
    messages: Array.isArray(t.messages)
      ? t.messages.map((m) => (m.fromId === me.id ? { ...m, fromName: me.name } : m))
      : t.messages,
    listing: withSeller(t.listing, me),
  }));
  state.offers = state.offers.map((o) => (o.fromId === me.id ? { ...o, fromName: me.name } : o));
  return me;
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
  state.incomingOffers = [];
  state.badges = { messages: 0, offers: 0 };
  await refreshListings().catch(() => {});
}

export async function addListing(payload) {
  const { listing } = await ListingsApi.create(payload);
  upsertListing(listing);
  return listing;
}

export async function addOffer({ listingId, amount, meetup, message }) {
  const { offer, thread, updated } = await ListingsApi.createOffer(listingId, {
    amount,
    meetup,
    message,
  });
  state.offers = [offer, ...state.offers.filter((o) => o.id !== offer.id)];
  upsertThread(thread);
  syncBadges();
  return { offer, thread, updated: Boolean(updated) };
}

export async function respondToOffer(offerId, payload) {
  const { offer, thread } = await OffersApi.respond(offerId, payload);
  state.offers = [offer, ...state.offers.filter((o) => o.id !== offer.id)];
  state.incomingOffers = state.incomingOffers.map((o) => (o.id === offer.id ? offer : o));
  upsertThread(thread);
  syncBadges();
  return { offer, thread };
}

export async function sendMessage(threadId, text) {
  const { message, thread } = await ThreadsApi.send(threadId, text);
  upsertThread(thread);
  syncBadges();
  return message;
}

export async function markThreadRead(threadId) {
  const { thread } = await ThreadsApi.get(threadId);
  upsertThread(thread);
  syncBadges();
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
  syncBadges();
  return listing;
}

export async function addReview(listingId, payload) {
  const { review, listing } = await ListingsApi.review(listingId, payload);
  upsertListing(listing);
  if (listing?.sellerId === state.me.id && listing.sellerTrust) {
    state.me = { ...state.me, trust: listing.sellerTrust };
  }
  return review;
}

export async function fetchUser(id) {
  const data = await UsersApi.get(id);
  for (const listing of data.listings || []) upsertListing(listing);
  if (data.user?.id && data.user.id === state.me.id && data.user.trust) {
    state.me = { ...state.me, trust: data.user.trust };
  }
  return data;
}

export function priceHint(category, condition) {
  return PriceApi.hint(category, condition);
}

function localStats() {
  const mine = state.listings.filter((l) => l.sellerId === state.me.id);
  const sold = mine.filter((l) => l.sold).length;
  const myOffers = state.offers.filter((o) => o.fromId === state.me.id);
  return {
    posts: mine.length,
    bargains: myOffers.length,
    deals: sold,
    sold,
    active: mine.length - sold,
    saved: state.wants.length,
    bought: state.me.trust?.bought || 0,
    trust: state.me.trust || null,
  };
}

export async function stats() {
  if (!isLoggedIn()) return localStats();
  try {
    const data = await StatsApi.get();
    if (data?.trust) state.me = { ...state.me, trust: data.trust };
    return data;
  } catch {
    return localStats();
  }
}
