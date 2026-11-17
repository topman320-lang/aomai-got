/** Tab reminders for 訊息 and 議價.
 * 我的 is settings only and never carries a notice badge.
 * 議價 is a seen-reminder, not a standing count of bids that still need a reply. */

function cleanCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function tabBadges({ messages = 0, offers = 0, notices = 0 } = {}) {
  const unreadMessages = cleanCount(messages);
  const newNotices = cleanCount(notices);
  const newOffers = cleanCount(offers);
  let messageLabel = '';
  if (unreadMessages > 0 && newNotices > 0) {
    messageLabel = `${unreadMessages} 則未讀訊息，${newNotices} 則新提醒`;
  } else if (unreadMessages > 0) {
    messageLabel = `${unreadMessages} 則未讀訊息`;
  } else if (newNotices > 0) {
    messageLabel = `${newNotices} 則新提醒`;
  }
  return {
    messages: { count: unreadMessages + newNotices, label: messageLabel },
    bargains: { count: newOffers, label: newOffers ? `${newOffers} 筆待看議價` : '' },
    me: { count: 0, label: '' },
  };
}

/** Every unread notice the API already filtered. Read rows stay off the list. */
export function visibleUnreadNotices(notices) {
  return (Array.isArray(notices) ? notices : []).filter((notice) => notice && !notice.read);
}

export function noticeIdsMarkedOnVisit(notices, { loaded = false } = {}) {
  if (!loaded) return [];
  return visibleUnreadNotices(notices)
    .map((notice) => notice.id)
    .filter(Boolean);
}

/** Opening 訊息 marks the notices just shown. Thread unread flags are not part of this. */
export function messageVisitEffect({ notices = [], threads = [], noticesLoaded = false, listed = true } = {}) {
  const show = Boolean(noticesLoaded && listed);
  const strips = show ? visibleUnreadNotices(notices) : [];
  return {
    strips,
    noticeIds: noticeIdsMarkedOnVisit(strips, { loaded: show }),
    offerIds: [],
    threads: (threads || []).map((thread) => ({ id: thread?.id, unread: Boolean(thread?.unread) })),
  };
}

export function offerRevision(offer) {
  const n = Number(offer?.updatedAt || offer?.createdAt);
  return Number.isFinite(n) ? n : 0;
}

export function offerNeedsAttention(offer, userId, { incoming = false, listing = null } = {}) {
  if (!offer || !userId) return false;
  if (listing?.sold || listing?.removed || listing?.removedAt || listing?.staffHidden || listing?.staffHiddenAt) {
    return false;
  }
  if (listing?.sellerBanned && listing.sellerId !== userId) return false;
  const status = offer.status || 'pending';
  if (offer.fromId === userId && status === 'countered') return true;
  if (offer.fromId !== userId && status === 'pending' && (incoming || listing?.sellerId === userId)) return true;
  return false;
}

export function isOfferReminderUnseen(offer, userId, context) {
  if (!offerNeedsAttention(offer, userId, context)) return false;
  const revision = offerRevision(offer);
  const seen = Number(offer?.seenUpdatedAt) || 0;
  return !(revision && seen === revision);
}

export function countUnseenOfferReminders({ userId, incoming = [], mine = [], listings = [] } = {}) {
  if (!userId) return 0;
  const listingFor = (offer) => (listings || []).find((row) => row && row.id === offer?.listingId) || null;
  const ids = new Set();
  let count = 0;
  const consider = (offer, incomingFlag) => {
    if (!offer?.id || ids.has(offer.id)) return;
    ids.add(offer.id);
    if (isOfferReminderUnseen(offer, userId, { incoming: incomingFlag, listing: listingFor(offer) })) count += 1;
  };
  for (const offer of incoming || []) consider(offer, true);
  for (const offer of mine || []) consider(offer, false);
  return count;
}

/** Ids from the lists that actually loaded. A failed list does not clear its reminder. */
export function bargainRemindersToMark({
  userId,
  incoming = [],
  mine = [],
  listings = [],
  incomingLoaded = false,
  mineLoaded = false,
} = {}) {
  if (!userId || (!incomingLoaded && !mineLoaded)) return [];
  const listingFor = (offer) => (listings || []).find((row) => row && row.id === offer?.listingId) || null;
  const marks = [];
  const seen = new Set();
  const push = (offer, incomingFlag) => {
    if (!offer?.id || seen.has(offer.id)) return;
    if (!isOfferReminderUnseen(offer, userId, { incoming: incomingFlag, listing: listingFor(offer) })) return;
    const updatedAt = offerRevision(offer);
    if (!updatedAt) return;
    seen.add(offer.id);
    marks.push({ id: offer.id, updatedAt });
  };
  if (incomingLoaded) for (const offer of incoming || []) push(offer, true);
  if (mineLoaded) for (const offer of mine || []) push(offer, false);
  return marks;
}

export function mergeOfferSeen(local, remote) {
  if (!remote) return remote;
  const revision = offerRevision(remote);
  const localSeen = local && local.id === remote.id ? Number(local.seenUpdatedAt) || 0 : 0;
  const remoteSeen = Number(remote.seenUpdatedAt) || 0;
  const seenUpdatedAt = revision && (localSeen === revision || remoteSeen === revision) ? revision : remoteSeen;
  if ((Number(remote.seenUpdatedAt) || 0) === seenUpdatedAt) return remote;
  return { ...remote, seenUpdatedAt };
}

/** Opening 議價 marks offer reminders only. Notices and thread unreads stay as they were. */
export function bargainVisitEffect({
  userId,
  incoming = [],
  mine = [],
  listings = [],
  incomingLoaded = false,
  mineLoaded = false,
  notices = [],
  threads = [],
} = {}) {
  return {
    offers: bargainRemindersToMark({ userId, incoming, mine, listings, incomingLoaded, mineLoaded }),
    noticeIds: [],
    notices: (notices || []).map((notice) => ({ id: notice?.id, read: Boolean(notice?.read) })),
    threads: (threads || []).map((thread) => ({ id: thread?.id, unread: Boolean(thread?.unread) })),
  };
}
