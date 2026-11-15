/** Staff review of stored reports. Nothing here hides a listing or blocks a user. */

import { REPORT_REASONS, reasonById } from './safety.js';

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

function presentReport(row, activity) {
  const counts = activity.get(row.reporterId) || { total: 0, recent: 0 };
  const status = reportStatus(row);
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
    .map((row) => presentReport(row, activity));
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
  return { ok: true, report: presentReport(row, activity) };
}
