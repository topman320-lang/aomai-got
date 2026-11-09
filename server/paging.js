/**
 * Public browse: newest first, optional text / category / price.
 * Sold rows stay out unless `includeSold` (the signed-in seller's own inventory).
 */
export function filterBrowseListings(listings, { q = '', category = '', min = null, max = null, sellerId = '', includeSold = false } = {}) {
  let list = Array.isArray(listings) ? [...listings] : [];
  list.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
  list = list.filter((l) => !l?.removedAt);
  if (sellerId) list = list.filter((l) => l?.sellerId === sellerId);
  if (!includeSold) list = list.filter((l) => !l?.sold);
  const cat = String(category || '').trim();
  if (cat && cat !== '全部') list = list.filter((l) => l.category === cat);
  const query = String(q || '').trim().toLowerCase();
  if (query) {
    list = list.filter((l) => {
      const blob = `${l.title || ''}\n${l.description || ''}\n${l.location || ''}\n${l.category || ''}`.toLowerCase();
      return blob.includes(query);
    });
  }
  if (min != null && max != null && min > max) return [];
  if (min != null || max != null) {
    list = list.filter((l) => {
      const price = Number(l.price);
      if (min != null && price < min) return false;
      if (max != null && price > max) return false;
      return true;
    });
  }
  return list;
}

/** Slice an already filtered list. Omit `limit` to return every row (used by 我的). */

export function pageWindow(list, query = {}) {
  const rows = Array.isArray(list) ? list : [];
  const total = rows.length;
  const rawLimit = query.limit;
  const unlimited = rawLimit === undefined || rawLimit === null || String(rawLimit).trim() === '';
  if (unlimited) {
    return { items: rows, total, offset: 0, limit: total, hasMore: false, nextOffset: total };
  }
  const limitNum = Number(rawLimit);
  if (!Number.isFinite(limitNum) || limitNum <= 0) return { error: 'INVALID_LIMIT' };
  const limit = Math.min(48, Math.floor(limitNum));
  const offsetNum = Number(query.offset ?? 0);
  const offset = Number.isFinite(offsetNum) && offsetNum > 0 ? Math.floor(offsetNum) : 0;
  const items = rows.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return { items, total, offset, limit, hasMore: nextOffset < total, nextOffset };
}
