import {
  AuthApi,
  BadgesApi,
  ModerationApi,
  SafetyApi,
  ListingsApi,
  NoticesApi,
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
import { countUnseenOfferReminders, mergeOfferSeen } from './reminders.js';

export const CATEGORIES = [
  '全部',
  '服飾',
  '美妝',
  '數碼',
  '家電',
  '家居',
  '運動',
  '母嬰',
  '玩具',
  '遊戲',
  '卡牌',
  '寵物用品',
  '票券／會籍',
  '書本',
  '其他',
];
export const LOCATIONS = ['澳門 · 附近', '氹仔', '中區', '路環', '黑沙環', '筷子基'];
export const CONDITION_OPTIONS = [
  { value: '全新', label: '全新', hint: '未使用，包裝或配件齊' },
  { value: '幾乎全新', label: '幾乎全新', hint: '只用過一兩次，幾乎睇唔出痕跡' },
  { value: '良好', label: '良好', hint: '日常使用痕跡，功能正常' },
  { value: '有使用痕跡', label: '有使用痕跡', hint: '有刮花、污漬或小瑕疵，請在說明寫明' },
  { value: '外觀較舊', label: '外觀較舊', hint: '功能正常，外觀明顯舊或有小缺件' },
];
export const CONDITIONS = CONDITION_OPTIONS.map((c) => c.value);
export const MEETUPS = ['賣家地點', '買家地點', '中間點', '地鐵站'];
/** Keep aligned with server/handoff.js MEET_PLACES. */
export const MEET_PLACES = [
  { id: 'senado', label: '議事亭前地' },
  { id: 'ruinas', label: '大三巴牌坊' },
  { id: 'lealdad', label: '仁慈堂' },
  { id: 'border', label: '關閘廣場' },
  { id: 'taipa', label: '官也街' },
  { id: 'cotai', label: '路氹城' },
  { id: 'hsa', label: '黑沙海灘' },
  { id: 'um', label: '澳門大學' },
  { id: 'must', label: '澳門科技大學' },
  { id: 'custom', label: '自訂地點' },
];
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
    staff: Boolean(user.staff),
  };
}

let state = {
  me: { ...GUEST_ME },
  listings: [],
  offers: [],
  incomingOffers: [],
  threads: [],
  wants: [],
  notices: [],
  blocks: [],
  blockedIds: [],
  badges: { messages: 0, offers: 0, notices: 0 },
  ready: false,
  online: false,
};

export function getState() {
  return state;
}

export function isLoggedIn() {
  return Boolean(getToken() && state.me?.id);
}

/** Bumps on login and logout so in-flight notices cannot surface after a switch. */
let sessionGen = 1;
/** Bumps when this session marks notices or offer reminders, so a stale poll cannot restore them. */
let noticesEpoch = 0;
let offerSeenEpoch = 0;

export function sessionGeneration() {
  return sessionGen;
}

function clearPrivateState() {
  state.threads = [];
  state.wants = [];
  state.offers = [];
  state.incomingOffers = [];
  state.notices = [];
  state.blocks = [];
  state.blockedIds = [];
  state.badges = { messages: 0, offers: 0, notices: 0 };
}

/** Drop the previous user's private cache and invalidate in-flight notice polls. */
function rotateSession() {
  sessionGen += 1;
  clearPrivateState();
  return sessionGen;
}

export function getBadges() {
  return state.badges || { messages: 0, offers: 0, notices: 0 };
}

export function syncBadges() {
  if (!isLoggedIn()) {
    state.badges = { messages: 0, offers: 0, notices: 0 };
    return state.badges;
  }
  const me = state.me.id;
  const messages = state.threads.filter((t) => t.unread).length;
  const offers = countUnseenOfferReminders({
    userId: me,
    incoming: state.incomingOffers,
    mine: state.offers,
    listings: state.listings,
  });
  state.badges = { messages, offers, notices: state.badges?.notices || 0 };
  return state.badges;
}

function withOfferSeen(remote, previous) {
  const prior = new Map((previous || []).filter((row) => row && row.id).map((row) => [row.id, row]));
  return (remote || []).map((row) => mergeOfferSeen(prior.get(row.id), row));
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

/** Same rules as public GET /api/listings. Sold rows stay off the home feed. */
export function listingMatches(listing, { q = '', category = '全部', min = null, max = null } = {}) {
  if (!listing || listing.sold) return false;
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
    state.notices = [];
    state.blocks = [];
    state.blockedIds = [];
    state.badges = { messages: 0, offers: 0, notices: 0 };
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
    state.notices = [];
    state.blocks = [];
    state.blockedIds = [];
    state.badges = { messages: 0, offers: 0, notices: 0 };
  }
  if (isLoggedIn()) {
    await refreshBlocks();
    await refreshBadges();
  }
  else syncBadges();
  state.ready = true;
  return { online: true, me: state.me };
}

export async function refreshListings(params = {}) {
  const { listings } = await ListingsApi.list(params);
  const rows = Array.isArray(listings) ? listings : [];
  const priceFiltered = params.min != null || params.max != null;
  const scoped = Boolean(params.q || (params.category && params.category !== '全部') || priceFiltered || params.mine);
  if (!scoped) {
    const hidden = new Set(state.blockedIds || []);
    const kept = state.listings.filter(
      (l) => l.sold && !l.staffHidden && !l.sellerBanned && !hidden.has(l.sellerId) && !rows.some((n) => n.id === l.id)
    );
    state.listings = [...rows, ...kept];
  } else {
    for (const l of rows) upsertListing(l);
  }
  return rows;
}

export async function fetchHomeListings({ q = '', category = '全部', min = null, max = null, limit, offset } = {}) {
  const lo = cleanBound(min);
  const hi = cleanBound(max);
  const data = await ListingsApi.list({
    q: q || undefined,
    category: category !== '全部' ? category : undefined,
    min: lo == null ? undefined : lo,
    max: hi == null ? undefined : hi,
    limit,
    offset,
  });
  const listings = Array.isArray(data?.listings) ? data.listings : [];
  const visible = listings.filter((l) => listingMatches(l, { q, category, min: lo, max: hi }));
  for (const l of visible) upsertListing(l);
  const total = Number(data?.total);
  const nextOffset = Number(data?.nextOffset);
  return {
    listings: visible,
    total: Number.isFinite(total) ? total : visible.length,
    hasMore: Boolean(data?.hasMore),
    nextOffset: Number.isFinite(nextOffset) ? nextOffset : visible.length,
  };
}

export async function refreshListing(id) {
  let listing;
  try {
    ({ listing } = await ListingsApi.get(id));
  } catch (err) {
    if (err?.code === 'BLOCKED' || err?.status === 404) state.listings = state.listings.filter((row) => row.id !== id);
    throw err;
  }
  upsertListing(listing);
  if (!isLoggedIn()) {
    state.offers = state.offers.filter((o) => o.listingId !== id);
    return listing;
  }
  const session = sessionGeneration();
  try {
    const { offers } = await ListingsApi.offers(id);
    if (session !== sessionGeneration()) return listing;
    const visible = Array.isArray(offers) ? offers : [];
    state.offers = [...visible, ...state.offers.filter((o) => o.listingId !== id)];
  } catch {
    /* offers stay as last fetched for this session */
  }
  return listing;
}

export async function refreshThreads() {
  if (!isLoggedIn()) {
    state.threads = [];
    return [];
  }
  const session = sessionGeneration();
  const { threads } = await ThreadsApi.list();
  if (session !== sessionGeneration() || !isLoggedIn()) return state.threads;
  state.threads = threads;
  syncBadges();
  return threads;
}

export async function refreshWants() {
  if (!isLoggedIn()) {
    state.wants = [];
    return [];
  }
  const session = sessionGeneration();
  const data = await WantsApi.list();
  if (session !== sessionGeneration() || !isLoggedIn()) return state.wants;
  state.wants = data.wants || [];
  for (const listing of data.listings || []) upsertListing(listing);
  return state.wants;
}

export async function refreshMyOffers() {
  if (!isLoggedIn()) {
    state.offers = [];
    return [];
  }
  const session = sessionGeneration();
  const { offers } = await OffersApi.mine();
  if (session !== sessionGeneration() || !isLoggedIn()) return [];
  const merged = withOfferSeen(offers, state.offers);
  const mineIds = new Set(merged.map((o) => o.id));
  state.offers = [...merged, ...state.offers.filter((o) => o.fromId !== state.me.id && !mineIds.has(o.id))];
  syncBadges();
  return merged;
}

export async function refreshIncomingOffers() {
  if (!isLoggedIn()) {
    state.incomingOffers = [];
    return [];
  }
  const session = sessionGeneration();
  const { offers } = await OffersApi.incoming();
  if (session !== sessionGeneration() || !isLoggedIn()) return [];
  const merged = withOfferSeen(offers, [...(state.incomingOffers || []), ...(state.offers || [])]);
  state.incomingOffers = merged;
  const ids = new Set(merged.map((o) => o.id));
  state.offers = [...merged, ...state.offers.filter((o) => !ids.has(o.id))];
  syncBadges();
  return merged;
}

export async function refreshBadges() {
  if (!isLoggedIn()) {
    state.badges = { messages: 0, offers: 0, notices: 0 };
    return state.badges;
  }
  const session = sessionGeneration();
  const seenEpoch = offerSeenEpoch;
  const noteEpoch = noticesEpoch;
  try {
    const data = await BadgesApi.get();
    if (session !== sessionGeneration() || !isLoggedIn()) return state.badges;
    const current = getBadges();
    state.badges = {
      messages: Number(data?.messages) || 0,
      offers: seenEpoch === offerSeenEpoch ? Number(data?.offers) || 0 : current.offers,
      notices: noteEpoch === noticesEpoch ? Number(data?.notices) || 0 : current.notices,
    };
  } catch {
    if (session === sessionGeneration() && isLoggedIn()) syncBadges();
  }
  return state.badges;
}

export async function login(email, password) {
  sessionGen += 1;
  const { token, user } = await AuthApi.login({ email, password });
  rotateSession();
  setToken(token);
  state.me = asMe(user);
  await Promise.all([refreshListings(), refreshThreads(), refreshWants(), refreshBlocks()]);
  await refreshMyOffers();
  await refreshIncomingOffers();
  await refreshBadges();
  return state.me;
}

/** Creates an unverified account. The caller must open the email before login. */
export async function register(name, email, password, consent) {
  return AuthApi.register({ name, email, password, consent: consent === true });
}

export async function resendVerification(email) {
  return AuthApi.resendVerification({ email });
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

/** Updates the signed-in user's password. The current login token stays valid. */
export async function changePassword({ currentPassword, newPassword, confirmPassword }) {
  return AuthApi.changePassword({ currentPassword, newPassword, confirmPassword });
}

export async function logout() {
  rotateSession();
  clearToken();
  state.me = { ...GUEST_ME };
  await refreshListings().catch(() => {});
}

export async function addListing(payload) {
  const { listing } = await ListingsApi.create(payload);
  upsertListing(listing);
  return listing;
}

export async function updateListing(id, payload) {
  const { listing } = await ListingsApi.update(id, payload);
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

function applyOfferResult(offer, thread) {
  if (offer) {
    state.offers = [offer, ...state.offers.filter((o) => o.id !== offer.id)];
    state.incomingOffers = state.incomingOffers.map((o) => (o.id === offer.id ? offer : o));
  }
  upsertThread(thread);
  syncBadges();
}

export async function saveHandoff(offerId, payload) {
  const data = await OffersApi.saveHandoff(offerId, payload);
  applyOfferResult(data.offer, data.thread);
  return data;
}

export async function confirmHandoff(offerId) {
  const data = await OffersApi.confirmHandoff(offerId);
  applyOfferResult(data.offer, data.thread);
  return data;
}

export async function refreshNotices() {
  if (!isLoggedIn()) {
    state.notices = [];
    state.badges = { ...getBadges(), notices: 0 };
    return [];
  }
  const session = sessionGeneration();
  const epoch = noticesEpoch;
  const data = await NoticesApi.list();
  if (session !== sessionGeneration() || !isLoggedIn() || epoch !== noticesEpoch) return state.notices;
  state.notices = data.notices || [];
  state.badges = { ...getBadges(), notices: Number(data.unread) || state.notices.filter((n) => !n.read).length };
  return state.notices;
}

export async function markNoticesRead(ids) {
  if (!isLoggedIn()) return [];
  const data = await NoticesApi.read(ids);
  noticesEpoch += 1;
  state.notices = data.notices || [];
  state.badges = { ...getBadges(), notices: Number(data.unread) || 0 };
  return state.notices;
}

function stampOffersSeen(items) {
  const acked = new Set((items || []).map((item) => `${item.id}:${Number(item.updatedAt) || 0}`));
  const stamp = (offer) => {
    if (!offer) return offer;
    const revision = Number(offer.updatedAt || offer.createdAt) || 0;
    if (!acked.has(`${offer.id}:${revision}`)) return offer;
    return { ...offer, seenUpdatedAt: revision };
  };
  state.offers = (state.offers || []).map(stamp);
  state.incomingOffers = (state.incomingOffers || []).map(stamp);
}

/** Mark the 議價 revisions just shown. Does not change thread unread or notice read state. */
export async function markOffersSeen(items) {
  if (!isLoggedIn()) return getBadges();
  const list = (Array.isArray(items) ? items : []).filter((item) => item && item.id && Number(item.updatedAt));
  if (!list.length) return getBadges();
  const data = await OffersApi.seen(list);
  offerSeenEpoch += 1;
  stampOffersSeen(list);
  syncBadges();
  if (data && Number.isFinite(Number(data.offers))) {
    state.badges = { ...getBadges(), offers: Number(data.offers) || 0 };
  }
  return getBadges();
}

export async function openListingThread(listingId) {
  const { thread } = await ThreadsApi.openForListing(listingId);
  upsertThread(thread);
  syncBadges();
  return thread;
}

export async function deleteMessage(threadId, messageId) {
  const { thread } = await ThreadsApi.remove(threadId, messageId);
  upsertThread(thread);
  syncBadges();
  return thread;
}

/** Drop one conversation from this account's inbox. The other person keeps it. */
export async function hideThread(threadId) {
  await ThreadsApi.hide(threadId);
  state.threads = state.threads.filter((t) => t.id !== threadId);
  syncBadges();
}

/** Drop one bid from this account's 我的議價. The bid itself stays for the other person. */
export async function hideOffer(offerId) {
  await OffersApi.hide(offerId);
  state.offers = state.offers.filter((o) => o.id !== offerId);
  state.incomingOffers = (state.incomingOffers || []).filter((o) => o.id !== offerId);
  syncBadges();
}

export async function sendMessage(threadId, text, photos = [], audio = null) {
  const payload = {
    text,
    photos: Array.isArray(photos) ? photos : [],
  };
  if (audio) payload.audio = audio;
  const { message, thread } = await ThreadsApi.send(threadId, payload);
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

export async function deleteListing(listingId) {
  const data = await ListingsApi.remove(listingId);
  state.listings = state.listings.filter((l) => l.id !== listingId);
  state.wants = (state.wants || []).filter((id) => id !== listingId);
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  state.offers = [...offers.filter((o) => o.fromId === state.me.id), ...state.offers.filter((o) => o.listingId !== listingId)];
  state.incomingOffers = [
    ...offers.filter((o) => o.fromId !== state.me.id),
    ...(state.incomingOffers || []).filter((o) => o.listingId !== listingId),
  ];
  for (const thread of data?.threads || []) upsertThread(thread);
  syncBadges();
  return data;
}

export async function setSold(listingId, sold) {
  const { listing } = await ListingsApi.setSold(listingId, sold);
  upsertListing(listing);
  syncBadges();
  return listing;
}

export async function confirmReceipt(listingId) {
  const { listing } = await ListingsApi.confirmReceipt(listingId);
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

export async function refreshBlocks() {
  if (!isLoggedIn()) {
    state.blocks = [];
    state.blockedIds = [];
    return [];
  }
  const session = sessionGeneration();
  const data = await SafetyApi.blocks();
  if (session !== sessionGeneration() || !isLoggedIn()) return state.blocks;
  const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
  state.blocks = blocks;
  state.blockedIds = blocks.map((row) => row.userId).filter(Boolean);
  return blocks;
}

/** Drop one person's listings, messages, and offers from this session immediately. */
export function forgetBlockedUser(userId) {
  const id = String(userId || '');
  if (!id) return;
  const removedListings = new Set(state.listings.filter((l) => l.sellerId === id).map((l) => l.id));
  const removedThreads = new Set(
    state.threads
      .filter((t) => t.peerId === id || t.buyerId === id || t.sellerId === id)
      .map((t) => t.id)
  );
  state.listings = state.listings.filter((l) => l.sellerId !== id);
  state.threads = state.threads.filter((t) => !removedThreads.has(t.id));
  state.offers = state.offers.filter((o) => o.fromId !== id && !removedListings.has(o.listingId));
  state.incomingOffers = (state.incomingOffers || []).filter(
    (o) => o.fromId !== id && !removedListings.has(o.listingId)
  );
  state.wants = (state.wants || []).filter((listingId) => !removedListings.has(listingId));
  state.notices = (state.notices || []).filter((notice) => {
    const href = String(notice?.href || '');
    if (href.startsWith('chat/')) return !removedThreads.has(href.slice('chat/'.length));
    if (href.startsWith('detail/')) return !removedListings.has(href.slice('detail/'.length));
    return true;
  });
  syncBadges();
}

export async function blockUser(userId) {
  const data = await SafetyApi.block(userId);
  forgetBlockedUser(userId);
  if (!state.blockedIds.includes(userId)) state.blockedIds.push(userId);
  return data;
}

export async function unblockUser(userId) {
  const data = await SafetyApi.unblock(userId);
  state.blockedIds = state.blockedIds.filter((id) => id !== userId);
  state.blocks = (state.blocks || []).filter((row) => row.userId !== userId);
  await Promise.all([
    refreshListings().catch(() => {}),
    refreshThreads().catch(() => {}),
    refreshMyOffers().catch(() => {}),
    refreshIncomingOffers().catch(() => {}),
    refreshWants().catch(() => {}),
    refreshNotices().catch(() => {}),
    refreshBadges().catch(() => {}),
  ]);
  return data;
}

export async function reportContent(payload) {
  return SafetyApi.report(payload);
}

export async function moderationReports(status) {
  return ModerationApi.reports(status);
}

export async function setReportStatus(id, status) {
  return ModerationApi.setStatus(id, status);
}

export async function hideReportedListing(id) {
  return ModerationApi.hideListing(id);
}

export async function banAccount(userId) {
  return ModerationApi.banUser(userId);
}

export async function moderationBlocks() {
  return ModerationApi.blocks();
}

/** Deletes the signed-in account, then ends this session. */
export async function deleteMyAccount(password) {
  await AuthApi.deleteMe({ password, confirm: true });
  await logout();
}
