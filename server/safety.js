/** Reports and blocks for user-generated content.
 * Rows stay in the JSON store. Developer mail is best-effort and never required
 * for the row to exist. Reports do not store email addresses. */

import { SUPPORT_EMAIL } from './public-pages.js';

export const REPORT_REASONS = [
  { id: 'spam', label: '垃圾或廣告' },
  { id: 'scam', label: '詐騙或不實內容' },
  { id: 'harassment', label: '騷擾、仇恨或冒犯' },
  { id: 'sexual', label: '不雅內容' },
  { id: 'other', label: '其他' },
];

const REPORT_TYPES = new Set(['listing', 'message', 'review', 'offer', 'user']);
const DETAIL_MAX = 200;

export function reasonById(id) {
  return REPORT_REASONS.find((reason) => reason.id === id) || null;
}

export function hasBlock(db, blockerId, blockedId) {
  if (!blockerId || !blockedId || blockerId === blockedId) return false;
  return (db?.blocks || []).some((row) => row && row.blockerId === blockerId && row.blockedId === blockedId);
}

export function blockedIdsFor(db, blockerId) {
  const ids = new Set();
  if (!blockerId) return ids;
  for (const row of db?.blocks || []) {
    if (row && row.blockerId === blockerId && row.blockedId) ids.add(row.blockedId);
  }
  return ids;
}

function clip(value, max = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join('')}…`;
}

function userName(db, userId) {
  const user = (db?.users || []).find((row) => row && row.id === userId);
  return user?.name || '';
}

function targetOf(db, targetType, targetId) {
  if (targetType === 'listing') {
    const listing = (db.listings || []).find((row) => row && row.id === targetId);
    if (!listing) return null;
    return {
      targetUserId: listing.sellerId || '',
      snapshot: {
        title: clip(listing.title, 80),
        description: clip(listing.description),
        price: listing.price ?? null,
      },
    };
  }
  if (targetType === 'message') {
    const message = (db.messages || []).find((row) => row && row.id === targetId);
    if (!message) return null;
    return {
      targetUserId: message.fromId || '',
      snapshot: {
        text: clip(message.text),
        photoCount: Array.isArray(message.photos) ? message.photos.length : 0,
        hasAudio: Boolean(message.audio && message.audio.url),
        threadId: message.threadId || '',
      },
    };
  }
  if (targetType === 'review') {
    const review = (db.reviews || []).find((row) => row && row.id === targetId);
    if (!review) return null;
    return {
      targetUserId: review.fromId || '',
      snapshot: {
        stars: Number(review.stars) || 0,
        text: clip(review.text, 80),
        listingId: review.listingId || '',
      },
    };
  }
  if (targetType === 'offer') {
    const offer = (db.offers || []).find((row) => row && row.id === targetId);
    if (!offer) return null;
    const listing = (db.listings || []).find((row) => row && row.id === offer.listingId);
    return {
      targetUserId: offer.fromId || '',
      snapshot: {
        amount: offer.amount ?? null,
        message: clip(offer.message, 120),
        listingId: offer.listingId || '',
        listingTitle: clip(listing?.title || '', 80),
      },
    };
  }
  if (targetType === 'user') {
    const user = (db.users || []).find((row) => row && row.id === targetId);
    if (!user) return null;
    return {
      targetUserId: user.id,
      snapshot: {
        name: clip(user.name, 40),
        bio: clip(user.bio, 80),
      },
    };
  }
  return null;
}

function fail(status, error, message) {
  return { ok: false, status, error, message };
}

/** Persist one report. Does not send mail and does not copy anyone's email. */
export function createReport(db, { id, reporter, targetType, targetId, reason, detail, now = Date.now() }) {
  if (!db || !reporter?.id) return fail(401, 'UNAUTHORIZED', '請先登入');
  const type = String(targetType || '').trim();
  if (!REPORT_TYPES.has(type)) return fail(400, 'INVALID_INPUT', '請選擇要檢舉的內容');
  const target = String(targetId || '').trim();
  if (!target || target.length > 80) return fail(400, 'INVALID_INPUT', '請選擇要檢舉的內容');
  const reasonId = String(reason || '').trim();
  if (!reasonById(reasonId)) return fail(400, 'INVALID_INPUT', '請選擇檢舉原因');
  const note = String(detail || '').replace(/[\r\n]+/g, ' ').trim();
  if (Array.from(note).length > DETAIL_MAX) return fail(400, 'INVALID_INPUT', `補充最多 ${DETAIL_MAX} 字`);
  const found = targetOf(db, type, target);
  if (!found) return fail(404, 'NOT_FOUND', '找不到要檢舉的內容');
  if (found.targetUserId && found.targetUserId === reporter.id) {
    return fail(400, 'INVALID_INPUT', '不能檢舉自己的內容');
  }
  if (!Array.isArray(db.reports)) db.reports = [];
  const row = {
    id,
    reporterId: reporter.id,
    reporterName: clip(reporter.name, 40),
    targetType: type,
    targetId: target,
    targetUserId: found.targetUserId || '',
    targetName: clip(userName(db, found.targetUserId), 40),
    reason: reasonId,
    detail: note,
    snapshot: found.snapshot,
    createdAt: now,
    mailError: false,
  };
  db.reports.unshift(row);
  return { ok: true, report: row };
}

/** Persist a block. A second block of the same person does not add another row. */
export function createBlock(db, { id, blocker, blockedId, now = Date.now() }) {
  if (!db || !blocker?.id) return fail(401, 'UNAUTHORIZED', '請先登入');
  const targetId = String(blockedId || '').trim();
  if (!targetId) return fail(400, 'INVALID_INPUT', '請選擇要封鎖的街坊');
  if (targetId === blocker.id) return fail(400, 'INVALID_INPUT', '不能封鎖自己');
  const target = (db.users || []).find((row) => row && row.id === targetId);
  if (!target) return fail(404, 'NOT_FOUND', '找不到這位街坊');
  if (!Array.isArray(db.blocks)) db.blocks = [];
  const existing = db.blocks.find((row) => row && row.blockerId === blocker.id && row.blockedId === targetId);
  if (existing) return { ok: true, block: existing, created: false };
  const row = {
    id,
    blockerId: blocker.id,
    blockerName: clip(blocker.name, 40),
    blockedId: targetId,
    blockedName: clip(target.name, 40),
    createdAt: now,
    mailError: false,
  };
  db.blocks.unshift(row);
  return { ok: true, block: row, created: true };
}

export function removeBlock(db, blockerId, blockedId) {
  const before = Array.isArray(db?.blocks) ? db.blocks.length : 0;
  if (!Array.isArray(db?.blocks)) return { ok: true, removed: false };
  db.blocks = db.blocks.filter((row) => !(row && row.blockerId === blockerId && row.blockedId === blockedId));
  return { ok: true, removed: db.blocks.length !== before };
}

export function applyMailResult(row, ok, now = Date.now()) {
  if (!row) return row;
  if (ok) {
    row.notifiedAt = now;
    row.mailError = false;
  } else {
    row.mailError = true;
  }
  return row;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function snapshotLines(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const labels = {
    title: '標題',
    description: '說明',
    price: '價錢',
    text: '內容',
    photoCount: '相片數量',
    hasAudio: '語音',
    threadId: '對話',
    stars: '星數',
    listingId: '刊登',
    listingTitle: '刊登標題',
    amount: '出價',
    message: '留言',
    name: '名稱',
    bio: '簡介',
  };
  const lines = [];
  for (const [key, label] of Object.entries(labels)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
    const value = snapshot[key];
    if (value == null || value === '') continue;
    lines.push(`${label}：${value}`);
  }
  return lines;
}

/** Mail for mogot.app@gmail.com. The stored row is separate and has no email. */
export function safetyNoticeMail({
  kind,
  reporterName = '',
  reporterId = '',
  reporterEmail = '',
  targetName = '',
  targetId = '',
  targetEmail = '',
  reasonLabel = '',
  detail = '',
  snapshot = null,
  at = Date.now(),
}) {
  const when = new Date(at).toLocaleString('zh-Hant-HK', { timeZone: 'Asia/Macau', hour12: false });
  const isBlock = kind === 'block';
  const subject = isBlock ? '澳賣GOT：有街坊封鎖了另一位用戶' : '澳賣GOT：新的內容檢舉';
  const lines = [
    isBlock ? '有街坊封鎖了另一位用戶。對方的內容已從封鎖者的列表移除。' : '有街坊檢舉了內容，請查閱並跟進。',
    `時間（澳門）：${when}`,
    `${isBlock ? '封鎖者' : '檢舉人'}：${reporterName || '（沒有名稱）'}（${reporterId || '—'}）`,
    reporterEmail ? `電郵：${reporterEmail}` : '',
    `${isBlock ? '被封鎖' : '對象'}：${targetName || '（沒有名稱）'}（${targetId || '—'}）`,
    targetEmail ? `對象電郵：${targetEmail}` : '',
    reasonLabel ? `原因：${reasonLabel}` : '',
    detail ? `補充：${detail}` : '',
    ...snapshotLines(snapshot),
  ].filter(Boolean);
  const text = lines.join('\n');
  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Noto Sans TC',sans-serif;color:#111111;line-height:1.7;font-size:15px">
${lines.map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`).join('\n')}
</body>
</html>`;
  return { to: SUPPORT_EMAIL, subject, text, html };
}

/** Skip in-app and push notices that would put a blocked person's content back on screen. */
export function shouldSuppressNotice(db, { userId, href, refId } = {}) {
  const hidden = blockedIdsFor(db, userId);
  if (!hidden.size) return false;
  const link = String(href || '');
  if (link.startsWith('chat/')) {
    const thread = (db?.threads || []).find((row) => row && row.id === link.slice('chat/'.length));
    if (thread) {
      const peer = thread.buyerId === userId ? thread.sellerId : thread.buyerId;
      if (hidden.has(peer)) return true;
    }
  }
  if (link.startsWith('detail/')) {
    const listing = (db?.listings || []).find((row) => row && row.id === link.slice('detail/'.length));
    if (listing && hidden.has(listing.sellerId)) return true;
  }
  const ref = String(refId || '');
  if (!ref) return false;
  const offer = (db?.offers || []).find((row) => row && row.id === ref);
  if (offer) {
    if (hidden.has(offer.fromId)) return true;
    const listing = (db?.listings || []).find((row) => row && row.id === offer.listingId);
    if (listing && listing.sellerId !== userId && hidden.has(listing.sellerId)) return true;
  }
  const message = (db?.messages || []).find((row) => row && row.id === ref);
  if (message && hidden.has(message.fromId)) return true;
  return false;
}

/** True when this notice would show a person the viewer has blocked. */
export function noticeHiddenByBlock(db, viewerId, notice) {
  if (!notice) return false;
  return shouldSuppressNotice(db, { userId: viewerId, href: notice.href, refId: notice.refId });
}
