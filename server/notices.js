/** In-app notices for messages, offers, and handoff.
 * Remote APNs/FCM is intentionally not sent: credentials are not part of this deploy.
 * Device tokens can still be stored for a later sender. See STORE_CHECKLIST.md. */

const MAX_PER_USER = 40;

export function addNotice(db, notice) {
  if (!db) return null;
  if (!Array.isArray(db.notices)) db.notices = [];
  const userId = String(notice?.userId || '');
  const body = String(notice?.body || '').trim().slice(0, 140);
  if (!userId || !body) return null;
  const row = {
    id: notice.id,
    userId,
    kind: String(notice.kind || 'message'),
    title: String(notice.title || '澳賣GOT').slice(0, 40),
    body,
    href: String(notice.href || ''),
    refId: String(notice.refId || ''),
    createdAt: notice.createdAt || Date.now(),
    readAt: null,
  };
  db.notices.unshift(row);
  const mine = [];
  const rest = [];
  for (const item of db.notices) {
    if (item.userId === userId) mine.push(item);
    else rest.push(item);
  }
  db.notices = [...mine.slice(0, MAX_PER_USER), ...rest];
  return row;
}

export function presentNotice(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href || '',
    refId: row.refId || '',
    createdAt: row.createdAt,
    read: Boolean(row.readAt),
  };
}

export function noticesFor(db, userId) {
  return (db?.notices || [])
    .filter((n) => n.userId === userId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map(presentNotice);
}

export function unreadNotices(db, userId) {
  return (db?.notices || []).filter((n) => n.userId === userId && !n.readAt).length;
}

export function markNoticesRead(db, userId, ids) {
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
  let changed = 0;
  const now = Date.now();
  for (const row of db?.notices || []) {
    if (row.userId !== userId || row.readAt) continue;
    if (wanted && !wanted.has(row.id)) continue;
    row.readAt = now;
    changed += 1;
  }
  return changed;
}

/** Hook for a future APNs/FCM sender. This build never delivers remote push. */
export function remotePushHook(db, userId) {
  const devices = (db?.devices || []).filter((d) => d.userId === userId);
  const hasApns = Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_KEY);
  const hasFcm = Boolean(process.env.FCM_SERVER_KEY || process.env.FCM_SERVICE_ACCOUNT);
  return {
    delivered: false,
    devices: devices.length,
    reason: hasApns || hasFcm ? 'sender_not_wired' : 'credentials_missing',
  };
}
