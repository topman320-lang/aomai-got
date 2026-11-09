/** Peer trust derived from deals, messages, and short reviews.
 * Never describes platform authentication, appraisal, or escrow. */

const GUIDE = {
  服飾: 80,
  美妝: 60,
  數碼: 500,
  家電: 400,
  家居: 200,
  運動: 100,
  母嬰: 180,
  玩具: 120,
  其他: 80,
};

const FACTOR = {
  全新: 1,
  幾乎全新: 0.85,
  良好: 0.7,
  有使用痕跡: 0.5,
  外觀較舊: 0.45,
};

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round10(n) {
  return Math.max(10, Math.round(Number(n) / 10) * 10);
}

export function agoLabel(ts) {
  const time = Number(ts || 0);
  if (!time) return '';
  const diff = Date.now() - time;
  if (diff < 0) return '剛剛';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  try {
    return new Date(time).toLocaleDateString('zh-Hant', { timeZone: 'Asia/Macau' });
  } catch {
    return '';
  }
}

export function presentReview(review, db) {
  const from = (db.users || []).find((u) => u.id === review.fromId);
  return {
    id: review.id,
    listingId: review.listingId,
    fromId: review.fromId,
    fromName: from?.name || '街坊',
    toId: review.toId,
    stars: Number(review.stars) || 0,
    text: review.text || '',
    createdAt: review.createdAt,
    time: agoLabel(review.createdAt),
  };
}

export function isActiveReview(review, db) {
  const listing = (db.listings || []).find((l) => l.id === review.listingId);
  if (!listing?.sold || !listing.buyerId || listing.buyerId === listing.sellerId) return false;
  const parties = new Set([listing.sellerId, listing.buyerId]);
  return parties.has(review.fromId) && parties.has(review.toId);
}

export function reviewsForListing(listing, db) {
  if (!listing?.sold) return [];
  return (db.reviews || [])
    .filter((r) => r.listingId === listing.id && isActiveReview(r, db))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => presentReview(r, db));
}

export function reviewAccess(listing, db, viewerId) {
  const buyerId = listing?.sold ? listing.buyerId || '' : '';
  const mine = viewerId
    ? (db.reviews || []).find((r) => r.listingId === listing.id && r.fromId === viewerId) || null
    : null;
  const isSeller = Boolean(viewerId && viewerId === listing?.sellerId);
  const isBuyer = Boolean(viewerId && buyerId && viewerId === buyerId);
  const distinct = Boolean(buyerId && buyerId !== listing?.sellerId);
  const canReview = Boolean(listing?.sold && distinct && (isSeller || isBuyer) && !mine);
  let reviewRole = '';
  if (isSeller) reviewRole = 'seller';
  else if (isBuyer) reviewRole = 'buyer';
  return {
    canReview,
    reviewRole,
    myReview: mine ? presentReview(mine, db) : null,
    buyerId,
  };
}

function replySamples(userId, db) {
  const samples = [];
  for (const thread of db.threads || []) {
    if (thread.buyerId !== userId && thread.sellerId !== userId) continue;
    const msgs = (db.messages || [])
      .filter((m) => m.threadId === thread.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    let i = 0;
    while (i < msgs.length) {
      if (msgs[i].fromId === userId) {
        i += 1;
        continue;
      }
      let replyIndex = -1;
      for (let j = i + 1; j < msgs.length; j += 1) {
        if (msgs[j].fromId === userId) {
          replyIndex = j;
          break;
        }
      }
      if (replyIndex < 0) break;
      const delta = msgs[replyIndex].createdAt - msgs[i].createdAt;
      if (delta >= 0 && delta < 14 * 24 * 60 * 60 * 1000) samples.push(delta);
      i = replyIndex;
    }
  }
  return samples;
}

export function replyHint(userId, db) {
  const samples = replySamples(userId, db);
  if (!samples.length) return '尚無足夠回覆紀錄';
  const med = median(samples);
  let pace = '較慢';
  if (med <= 15 * 60 * 1000) pace = '很快';
  else if (med <= 3 * 60 * 60 * 1000) pace = '數小時內';
  else if (med <= 24 * 60 * 60 * 1000) pace = '一天內';
  if (samples.length === 1) {
    return pace === '較慢' ? '最近一次回覆較慢' : `最近一次${pace}回覆`;
  }
  if (pace === '較慢') return '回覆較慢';
  if (pace === '很快') return '通常很快回覆';
  return `通常${pace}回覆`;
}

export function activityTs(user, db) {
  if (!user) return 0;
  if (user.lastActiveAt) return user.lastActiveAt;
  let ts = user.createdAt || 0;
  for (const listing of db.listings || []) {
    if (listing.sellerId === user.id) ts = Math.max(ts, listing.createdAt || 0);
  }
  for (const message of db.messages || []) {
    if (message.fromId === user.id) ts = Math.max(ts, message.createdAt || 0);
  }
  for (const offer of db.offers || []) {
    if (offer.fromId === user.id) ts = Math.max(ts, offer.updatedAt || offer.createdAt || 0);
  }
  return ts;
}

export function lastActiveHint(ts) {
  const time = Number(ts || 0);
  if (!time) return '尚無活動紀錄';
  const diff = Date.now() - time;
  if (diff < 5 * 60 * 1000) return '剛剛有活動';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} 分鐘前有活動`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前有活動`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前有活動`;
  return '較少近期活動';
}

export function trustSummary(userId, db, { recentLimit = 1 } = {}) {
  const sold = (db.listings || []).filter((l) => l.sellerId === userId && l.sold).length;
  const bought = (db.listings || []).filter(
    (l) => l.sold && l.buyerId === userId && l.sellerId !== userId
  ).length;
  const received = (db.reviews || [])
    .filter((r) => r.toId === userId && isActiveReview(r, db))
    .sort((a, b) => b.createdAt - a.createdAt);
  const ratingCount = received.length;
  const ratingAvg = ratingCount
    ? Math.round((received.reduce((sum, r) => sum + Number(r.stars || 0), 0) / ratingCount) * 10) / 10
    : null;
  const user = (db.users || []).find((u) => u.id === userId);
  return {
    sold,
    bought,
    ratingAvg,
    ratingCount,
    replyHint: replyHint(userId, db),
    lastActiveHint: lastActiveHint(activityTs(user, db)),
    recent: received.slice(0, recentLimit).map((r) => presentReview(r, db)),
  };
}

/** Accepted buyer confirms they have the item. Marks the listing sold to them.
 * Idempotent when it is already sold to this buyer. Peer handover only. */
export function applyConfirmReceipt(listing, db, userId) {
  if (!listing) {
    return { ok: false, status: 404, error: 'NOT_FOUND', message: '找不到商品' };
  }
  if (!userId || userId === listing.sellerId) {
    return {
      ok: false,
      status: 403,
      error: 'FORBIDDEN',
      message: userId === listing.sellerId ? '賣家請用標示已售出' : '只有已接受出價的買家可以確認收貨',
    };
  }
  const accepted = (db?.offers || []).some(
    (offer) => offer.listingId === listing.id && offer.fromId === userId && offer.status === 'accepted'
  );
  if (!accepted) {
    return {
      ok: false,
      status: 403,
      error: 'FORBIDDEN',
      message: '只有已接受出價的買家可以確認收貨',
    };
  }
  if (listing.sold) {
    const buyerId = listing.buyerId || '';
    if (buyerId && buyerId !== userId) {
      return { ok: false, status: 400, error: 'LISTING_SOLD', message: '此商品已售給其他買家' };
    }
    if (!buyerId) listing.buyerId = userId;
    return { ok: true, already: true };
  }
  listing.sold = true;
  listing.buyerId = userId;
  return { ok: true, already: false };
}

export function acceptedBuyerId(listing, db) {
  const accepted = (db.offers || [])
    .filter(
      (o) =>
        o.listingId === listing.id &&
        o.status === 'accepted' &&
        o.fromId &&
        o.fromId !== listing.sellerId
    )
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  return accepted[0]?.fromId || '';
}

export function backfillDeals(db) {
  let changed = false;
  if (!Array.isArray(db.reviews)) {
    db.reviews = [];
    changed = true;
  }
  for (const listing of db.listings || []) {
    if (!listing.sold) {
      if (listing.buyerId) {
        delete listing.buyerId;
        changed = true;
      }
      continue;
    }
    if (!listing.buyerId) {
      const buyerId = acceptedBuyerId(listing, db);
      if (buyerId) {
        listing.buyerId = buyerId;
        changed = true;
      }
    }
  }
  return changed;
}

export function badgeCountsFor(db, userId) {
  const messages = (db.threads || []).filter((t) => {
    if (t.buyerId === userId) return Boolean(t.buyerUnread);
    if (t.sellerId === userId) return Boolean(t.sellerUnread);
    return false;
  }).length;
  let offers = 0;
  for (const offer of db.offers || []) {
    const listing = (db.listings || []).find((l) => l.id === offer.listingId);
    if (!listing || listing.sold || listing.removedAt) continue;
    const status = offer.status || 'pending';
    if (offer.fromId === userId && status === 'countered') offers += 1;
    else if (listing.sellerId === userId && offer.fromId !== userId && status === 'pending') offers += 1;
  }
  return { messages, offers };
}

export function priceHint(db, category, condition) {
  const cat = GUIDE[category] ? category : '其他';
  const cond = FACTOR[condition] ? condition : '良好';
  const peers = (db.listings || []).filter((l) => !l.removedAt && l.category === cat && Number(l.price) > 0);
  const same = peers.filter((l) => l.condition === cond);
  const pool = same.length >= 2 ? same : peers;
  if (pool.length >= 1) {
    const prices = pool.map((l) => Number(l.price)).sort((a, b) => a - b);
    const low = prices[0];
    const high = prices[prices.length - 1];
    const mid = Math.round(median(prices));
    const note =
      pool.length === 1
        ? `目前只有 1 件「${cat}」刊登，標價 MOP ${mid}。只供參考，不是估價或鑑定。`
        : `同類「${cat}」刊登約 MOP ${low} 至 ${high}（${pool.length} 件，中間約 ${mid}）。只供參考，不是估價或鑑定。`;
    return { low, mid, high, count: pool.length, basis: 'peers', category: cat, condition: cond, note };
  }
  const mid = round10((GUIDE[cat] || 80) * (FACTOR[cond] || 0.7));
  const low = round10(mid * 0.8);
  const high = round10(mid * 1.25);
  return {
    low,
    mid,
    high,
    count: 0,
    basis: 'guide',
    category: cat,
    condition: cond,
    note: `暫時沒有同類刊登。依「${cat} · ${cond}」粗略約 MOP ${low} 至 ${high}。只供參考，不是估價或鑑定。`,
  };
}
