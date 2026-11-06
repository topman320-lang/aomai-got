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
