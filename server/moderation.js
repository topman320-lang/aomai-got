/** Staff review of stored reports and user-to-user blocks.
 * Marking a report status does not hide a listing or ban anyone.
 * Hiding a listing and platform ban are separate confirmed actions.
 * The reported person is notified only after one of those actions takes effect. */

import { REPORT_REASONS, blockedIdsFor, reasonById } from './safety.js';
import { SUPPORT_EMAIL } from './public-pages.js';

/** Comma-separated user ids and/or exact display names. Empty means nobody is staff. */
export function staffTokens(env = process.env) {
  return String(env.MOD_STAFF || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isStaffUser(user, env = process.env) {
  if (!user) return false;
  const tokens = staffTokens(env);
  if (!tokens.length) return false;
  const id = String(user.id || '');
  const name = String(user.name || '').trim();
  return tokens.some((token) => token === id || (name && token === name));
}

export const REPORT_STATUSES = ['open', 'follow', 'done', 'dismissed', 'malicious'];

/** New and follow-up rows. Malicious, dismissed, and handled rows stay out of this inbox. */
export const INBOX_STATUSES = new Set(['open', 'follow']);

export const REPEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const REPEAT_THRESHOLD = 3;

const TYPE_LABELS = {
  listing: '刊登',
  message: '訊息',
  review: '評價',
  offer: '出價',
  user: '街坊',
};

const STATUS_LABELS = {
  open: '待處理',
  follow: '要跟進',
  done: '已處理',
  dismissed: '不處理',
  malicious: '惡意檢舉',
};

export function reportStatus(row) {
  const status = String(row?.status || 'open');
  return REPORT_STATUSES.includes(status) ? status : 'open';
}

export function isPlatformBanned(user) {
  return Boolean(user && user.bannedAt);
}

export function platformBannedIds(db) {
  const ids = new Set();
  for (const user of db?.users || []) {
    if (isPlatformBanned(user)) ids.add(user.id);
  }
  return ids;
}

/** User-to-user blocks plus platform-banned authors, so their names stay off public pages. */
export function viewerHiddenIds(db, viewerId) {
  const hidden = blockedIdsFor(db, viewerId);
  for (const id of platformBannedIds(db)) hidden.add(id);
  return hidden;
}

export function listingTakenDown(listing, db) {
  if (!listing) return false;
  if (listing.staffHiddenAt) return true;
  return platformBannedIds(db).has(listing.sellerId);
}

function findUser(db, userId) {
  const id = String(userId || '');
  if (!id) return null;
  return (db?.users || []).find((row) => row && row.id === id) || null;
}

export function resolveReportTargets(db, row) {
  let listingId = '';
  let accountId = String(row?.targetUserId || '');
  const type = row?.targetType;
  if (type === 'listing') listingId = String(row?.targetId || '');
  else if (type === 'user') accountId = String(row?.targetId || accountId);
  else if (type === 'review' || type === 'offer') listingId = String(row?.snapshot?.listingId || '');
  else if (type === 'message') {
    const message = (db?.messages || []).find((item) => item && item.id === row?.targetId);
    const threadId = message?.threadId || row?.snapshot?.threadId || '';
    const thread = (db?.threads || []).find((item) => item && item.id === threadId);
    if (thread?.listingId) listingId = thread.listingId;
  }
  const listing = listingId ? (db?.listings || []).find((item) => item && item.id === listingId) || null : null;
  if (!listing) listingId = '';
  else if (!accountId) accountId = listing.sellerId || '';
  const account = findUser(db, accountId);
  if (!account) accountId = '';
  const seller = listing ? findUser(db, listing.sellerId) : null;
  return {
    listingId,
    accountId,
    listingHidden: Boolean(listing && (listing.staffHiddenAt || isPlatformBanned(seller))),
    accountBanned: isPlatformBanned(account),
  };
}

/** True when an in-app notice would put a platform-banned person or a taken-down listing back on screen. */
export function noticeRevealsConcealed(db, viewerId, notice) {
  if (!notice) return false;
  const banned = platformBannedIds(db);
  const link = String(notice.href || '');
  if (link.startsWith('chat/')) {
    const thread = (db?.threads || []).find((row) => row && row.id === link.slice('chat/'.length));
    if (thread) {
      const peer = thread.buyerId === viewerId ? thread.sellerId : thread.buyerId;
      if (banned.has(peer)) return true;
    }
  }
  if (link.startsWith('detail/')) {
    const listing = (db?.listings || []).find((row) => row && row.id === link.slice('detail/'.length));
    if (listing && (listing.staffHiddenAt || banned.has(listing.sellerId))) return true;
  }
  const ref = String(notice.refId || '');
  if (!ref) return false;
  const offer = (db?.offers || []).find((row) => row && row.id === ref);
  if (offer && banned.has(offer.fromId)) return true;
  const message = (db?.messages || []).find((row) => row && row.id === ref);
  if (message && banned.has(message.fromId)) return true;
  return false;
}

function redactEmails(value) {
  return String(value ?? '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '（電郵已隱藏）');
}

function cleanSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (/email/i.test(key)) continue;
    if (typeof value === 'string') out[key] = redactEmails(value);
    else if (typeof value === 'number' || typeof value === 'boolean' || value == null) out[key] = value;
  }
  return out;
}

export function reporterActivity(reports, now = Date.now()) {
  const byId = new Map();
  for (const row of reports || []) {
    const reporterId = String(row?.reporterId || '');
    if (!reporterId) continue;
    const bucket = byId.get(reporterId) || { total: 0, recent: 0 };
    bucket.total += 1;
    if (now - Number(row.createdAt || 0) <= REPEAT_WINDOW_MS && now - Number(row.createdAt || 0) >= 0) {
      bucket.recent += 1;
    }
    byId.set(reporterId, bucket);
  }
  return byId;
}

function presentReport(row, activity, db) {
  const counts = activity.get(row.reporterId) || { total: 0, recent: 0 };
  const status = reportStatus(row);
  const targets = resolveReportTargets(db, row);
  return {
    id: row.id,
    reporterId: row.reporterId || '',
    reporterName: redactEmails(row.reporterName || '街坊'),
    targetType: row.targetType || '',
    targetTypeLabel: TYPE_LABELS[row.targetType] || row.targetType || '',
    targetId: row.targetId || '',
    targetUserId: row.targetUserId || '',
    targetName: redactEmails(row.targetName || ''),
    reason: row.reason || '',
    reasonLabel: reasonById(row.reason)?.label || row.reason || '',
    detail: redactEmails(row.detail || ''),
    snapshot: cleanSnapshot(row.snapshot),
    createdAt: row.createdAt || 0,
    status,
    statusLabel: STATUS_LABELS[status],
    recentCount: counts.recent,
    totalCount: counts.total,
    busy: counts.recent >= REPEAT_THRESHOLD,
    listingId: targets.listingId,
    accountId: targets.accountId,
    listingHidden: targets.listingHidden,
    accountBanned: targets.accountBanned,
  };
}

export function listModerationReports(db, { status = 'inbox', now = Date.now() } = {}) {
  const wanted = String(status || 'inbox').trim() || 'inbox';
  const reports = Array.isArray(db?.reports) ? db.reports : [];
  const activity = reporterActivity(reports, now);
  const rows = reports
    .filter((row) => row && row.id)
    .filter((row) => {
      const current = reportStatus(row);
      if (wanted === 'all') return true;
      if (wanted === 'inbox') return INBOX_STATUSES.has(current);
      return current === wanted;
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((row) => presentReport(row, activity, db));
  return {
    reports: rows,
    status: wanted,
    repeatWindowDays: REPEAT_WINDOW_MS / (24 * 60 * 60 * 1000),
    repeatThreshold: REPEAT_THRESHOLD,
    reasons: REPORT_REASONS,
  };
}

export function setReportStatus(db, { reportId, status, staffId, now = Date.now() } = {}) {
  const next = String(status || '').trim();
  if (!REPORT_STATUSES.includes(next)) {
    return { ok: false, status: 400, error: 'INVALID_INPUT', message: '請選擇處理狀態' };
  }
  const row = (db?.reports || []).find((item) => item && item.id === reportId);
  if (!row) return { ok: false, status: 404, error: 'NOT_FOUND', message: '找不到這則檢舉' };
  row.status = next;
  row.statusAt = now;
  row.statusBy = String(staffId || '');
  const activity = reporterActivity(db.reports, now);
  return { ok: true, report: presentReport(row, activity, db) };
}

export function listModerationBlocks(db) {
  const blocks = (Array.isArray(db?.blocks) ? db.blocks : [])
    .filter((row) => row && row.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((row) => {
      const blocker = findUser(db, row.blockerId);
      const blocked = findUser(db, row.blockedId);
      return {
        id: row.id,
        blockerId: blocker?.id || '',
        blockerName: redactEmails(blocker?.name || row.blockerName || '街坊'),
        blockedId: blocked?.id || '',
        blockedName: redactEmails(blocked?.name || row.blockedName || '街坊'),
        createdAt: row.createdAt || 0,
        blockerBanned: isPlatformBanned(blocker),
        blockedBanned: isPlatformBanned(blocked),
      };
    });
  return { blocks };
}

const NOTICE_MAX = 140;

/** Keep the support email even when the lead is long. addNotice also caps at 140. */
export function staffActionNoticeText(lead) {
  const tail = `如有疑問，請聯絡 ${SUPPORT_EMAIL}。`;
  const head = String(lead || '').trim();
  if (!head) return tail.slice(0, NOTICE_MAX);
  if (`${head}${tail}`.length <= NOTICE_MAX) return `${head}${tail}`;
  const room = Math.max(0, NOTICE_MAX - tail.length);
  return `${head.slice(0, room)}${tail}`.slice(0, NOTICE_MAX);
}

function listingHiddenLead(listing) {
  const title = String(listing?.title || '').replace(/\s+/g, ' ').trim();
  if (!title) return '你的刊登已被隱藏，一般街坊不會再見到。';
  return `刊登「${title}」已被隱藏，一般街坊不會再見到。`;
}

/** In-app notice for the seller. No reporter, no link back to the hidden listing. */
export function listingHiddenNotice(listing) {
  const userId = String(listing?.sellerId || '');
  if (!userId) return null;
  return {
    userId,
    kind: 'moderation',
    title: '刊登已隱藏',
    body: staffActionNoticeText(listingHiddenLead(listing)),
    href: '',
    refId: '',
  };
}

/** In-app notice for the banned account. No reporter. */
export function accountBannedNotice(userId) {
  const id = String(userId || '');
  if (!id) return null;
  return {
    userId: id,
    kind: 'moderation',
    title: '帳號已封鎖',
    body: staffActionNoticeText('你的帳號已被平台封鎖，不能再使用。'),
    href: '',
    refId: '',
  };
}

/** Hide one listing from ordinary users. Does not change report status or add a user block. */
export function hideListing(db, { listingId, staffId, confirm, now = Date.now() } = {}) {
  if (confirm !== true) {
    return { ok: false, status: 400, error: 'CONFIRM_REQUIRED', message: '請再確認隱藏這件刊登' };
  }
  const listing = (db?.listings || []).find((row) => row && row.id === listingId);
  if (!listing) return { ok: false, status: 404, error: 'NOT_FOUND', message: '找不到這件刊登' };
  let fresh = false;
  if (!listing.staffHiddenAt) {
    listing.staffHiddenAt = now;
    listing.staffHiddenBy = String(staffId || '');
    fresh = true;
  }
  return {
    ok: true,
    listing: { id: listing.id, staffHidden: true, staffHiddenAt: listing.staffHiddenAt },
    notice: fresh ? listingHiddenNotice(listing) : null,
  };
}

/** Platform ban. Separate from a user-to-user block, and refused for the acting staff member. */
export function banUser(db, { userId, staffId, confirm, now = Date.now(), env = process.env } = {}) {
  if (confirm !== true) {
    return { ok: false, status: 400, error: 'CONFIRM_REQUIRED', message: '請再確認平台封鎖' };
  }
  const targetId = String(userId || '').trim();
  if (!targetId) return { ok: false, status: 400, error: 'INVALID_INPUT', message: '請選擇要封鎖的帳號' };
  if (targetId === String(staffId || '')) {
    return { ok: false, status: 400, error: 'INVALID_INPUT', message: '不能平台封鎖自己' };
  }
  const user = findUser(db, targetId);
  if (!user) return { ok: false, status: 404, error: 'NOT_FOUND', message: '找不到這位街坊' };
  if (isStaffUser(user, env)) {
    return { ok: false, status: 400, error: 'INVALID_INPUT', message: '不能平台封鎖審核員' };
  }
  let fresh = false;
  if (!user.bannedAt) {
    user.bannedAt = now;
    user.bannedBy = String(staffId || '');
    fresh = true;
  }
  return {
    ok: true,
    user: { id: user.id, name: user.name || '', banned: true, bannedAt: user.bannedAt },
    notice: fresh ? accountBannedNotice(user.id) : null,
  };
}
