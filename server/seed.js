import {
  absolutePhotos,
  loadDb,
  persist,
  presentAvatar,
} from './db.js';
import { reviewAccess, reviewsForListing, trustSummary } from './trust.js';

const DEMO_EMAIL = 'demo@aomai.got';
const SEED_EMAIL_SUFFIX = '@seed.aomai.got';

export const HANDOVERS = ['面交', '自取', '面交／自取'];

/** Peer handoff only. Never implies warehouse authentication or insured shipping. */
export function normalizeHandover(value, description = '') {
  const v = String(value || '').trim();
  if (HANDOVERS.includes(v)) return v;
  const text = String(description || '');
  const pickup = /自取|自備交通|帶走/.test(text);
  const meet = /面交|交收|碰面/.test(text);
  if (pickup && meet) return '面交／自取';
  if (pickup) return '自取';
  return '面交';
}

/** Robot accounts only. Other emails, including lookalikes, stay. */
export function isSeedAccountEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return false;
  return value === DEMO_EMAIL || value.endsWith(SEED_EMAIL_SUFFIX);
}

function rows(db, key) {
  return Array.isArray(db?.[key]) ? db[key] : [];
}

function idsOf(list) {
  const ids = new Set();
  for (const row of list) {
    if (row && row.id != null && row.id !== '') ids.add(row.id);
  }
  return ids;
}

/**
 * Delete demo@aomai.got and *@seed.aomai.got, plus the listings they sell
 * and the offers, threads, messages, reviews, handoffs, wants, devices, and
 * notices that belong to those accounts or those listings.
 * Real accounts and their own records stay. Safe to run on every boot.
 */
export function purgeSeedUsers(db) {
  const live = db == null;
  if (live) db = loadDb();
  const users = rows(db, 'users');
  const seedUsers = users.filter((user) => user && isSeedAccountEmail(user.email));
  const seedIds = idsOf(seedUsers);

  const listings = rows(db, 'listings');
  const seedListings = listings.filter((listing) => listing && seedIds.has(listing.sellerId));
  const seedListingIds = idsOf(seedListings);

  const offers = rows(db, 'offers');
  const seedOffers = offers.filter(
    (offer) => offer && (seedIds.has(offer.fromId) || seedListingIds.has(offer.listingId))
  );
  const seedOfferIds = idsOf(seedOffers);

  const threads = rows(db, 'threads');
  const seedThreads = threads.filter(
    (thread) =>
      thread &&
      (seedIds.has(thread.buyerId) || seedIds.has(thread.sellerId) || seedListingIds.has(thread.listingId))
  );
  const seedThreadIds = idsOf(seedThreads);

  const messages = rows(db, 'messages');
  const seedMessages = messages.filter(
    (message) => message && (seedIds.has(message.fromId) || seedThreadIds.has(message.threadId))
  );
  const seedMessageIds = idsOf(seedMessages);

  const reviews = rows(db, 'reviews');
  const seedReviews = reviews.filter(
    (review) =>
      review &&
      (seedIds.has(review.fromId) || seedIds.has(review.toId) || seedListingIds.has(review.listingId))
  );

  const handoffs = rows(db, 'handoffs');
  const seedHandoffs = handoffs.filter(
    (handoff) =>
      handoff &&
      (seedIds.has(handoff.proposedBy) ||
        seedListingIds.has(handoff.listingId) ||
        seedOfferIds.has(handoff.offerId))
  );
  const seedHandoffIds = idsOf(seedHandoffs);

  const wants = rows(db, 'wants');
  const seedWants = wants.filter(
    (want) => want && (seedIds.has(want.userId) || seedListingIds.has(want.listingId))
  );

  const devices = rows(db, 'devices');
  const seedDevices = devices.filter((device) => device && seedIds.has(device.userId));

  const notices = rows(db, 'notices');
  const droppedRefs = new Set([
    ...seedListingIds,
    ...seedOfferIds,
    ...seedThreadIds,
    ...seedMessageIds,
    ...seedHandoffIds,
    ...idsOf(seedReviews),
  ]);
  const seedNotices = notices.filter(
    (notice) => notice && (seedIds.has(notice.userId) || droppedRefs.has(notice.refId))
  );

  const counts = {
    users: seedUsers.length,
    listings: seedListings.length,
    offers: seedOffers.length,
    threads: seedThreads.length,
    messages: seedMessages.length,
    reviews: seedReviews.length,
    handoffs: seedHandoffs.length,
    wants: seedWants.length,
    devices: seedDevices.length,
    notices: seedNotices.length,
  };
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    if (live) {
      console.log(
        '[purge] users=0 listings=0 offers=0 threads=0 messages=0 reviews=0 handoffs=0 wants=0 devices=0 notices=0'
      );
    }
    return counts;
  }

  const droppedUsers = new Set(seedUsers);
  const droppedListings = new Set(seedListings);
  const droppedOffers = new Set(seedOffers);
  const droppedThreads = new Set(seedThreads);
  const droppedMessages = new Set(seedMessages);
  const droppedReviews = new Set(seedReviews);
  const droppedHandoffs = new Set(seedHandoffs);
  const droppedWants = new Set(seedWants);
  const droppedDevices = new Set(seedDevices);
  const droppedNotices = new Set(seedNotices);

  db.users = users.filter((user) => !droppedUsers.has(user));
  db.listings = listings.filter((listing) => !droppedListings.has(listing));
  db.offers = offers.filter((offer) => !droppedOffers.has(offer));
  db.threads = threads.filter((thread) => !droppedThreads.has(thread));
  db.messages = messages.filter((message) => !droppedMessages.has(message));
  db.reviews = reviews.filter((review) => !droppedReviews.has(review));
  db.handoffs = handoffs.filter((handoff) => !droppedHandoffs.has(handoff));
  db.wants = wants.filter((want) => !droppedWants.has(want));
  db.devices = devices.filter((device) => !droppedDevices.has(device));
  db.notices = notices.filter((notice) => !droppedNotices.has(notice));

  for (const listing of db.listings) {
    if (listing && seedIds.has(listing.buyerId)) delete listing.buyerId;
  }

  if (live) persist();
  console.log(
    `[purge] users=${counts.users} listings=${counts.listings} offers=${counts.offers} threads=${counts.threads} messages=${counts.messages} reviews=${counts.reviews} handoffs=${counts.handoffs} wants=${counts.wants} devices=${counts.devices} notices=${counts.notices}`
  );
  return counts;
}

/** Ensure the database file exists. Does not create demo users or listings. */
export function seedIfEmpty() {
  loadDb();
}

export function listingDto(l, db, publicBase, viewerId = '') {
  const seller = db.users.find((u) => u.id === l.sellerId);
  const access = reviewAccess(l, db, viewerId);
  return {
    id: l.id,
    title: l.title,
    price: l.price,
    negotiable: Boolean(l.negotiable),
    category: l.category,
    location: l.location,
    condition: l.condition,
    description: l.description,
    handover: normalizeHandover(l.handover, l.description),
    sellerId: l.sellerId,
    sellerName: seller?.name || '街坊',
    sellerAvatar: presentAvatar(seller?.avatar || '賣', publicBase),
    sellerBio: seller?.bio || '',
    sellerVerified: Boolean(seller?.verified),
    sellerTrust: trustSummary(l.sellerId, db),
    buyerId: l.sold ? l.buyerId || '' : '',
    reviews: reviewsForListing(l, db),
    canReview: access.canReview,
    reviewRole: access.reviewRole,
    myReview: access.myReview,
    tone: l.tone,
    emoji: l.emoji,
    photos: absolutePhotos(l.photos || [], publicBase),
    sold: Boolean(l.sold),
    createdAt: l.createdAt,
  };
}
