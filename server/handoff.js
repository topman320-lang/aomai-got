/** Meetup handoff after an accepted bid. Both sides propose; both must confirm.
 * Places are public landmarks or a custom note. No escrow, no custody. */

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

const PLACE_BY_ID = new Map(MEET_PLACES.map((p) => [p.id, p]));
const WHEN_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function placeLabel(placeId, customPlace = '') {
  if (placeId === 'custom') return String(customPlace || '').replace(/[\r\n]+/g, ' ').trim();
  return PLACE_BY_ID.get(placeId)?.label || '';
}

export function formatWhenLabel(when) {
  const m = WHEN_RE.exec(String(when || '').trim());
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  const weekday = WEEKDAYS[date.getUTCDay()];
  return `${month}月${day}日（${weekday}）${m[4]}:${m[5]}`;
}

/** `when` is a wall-clock stamp in Asia/Macau (UTC+8, no DST). */
export function parseWhen(value, now = Date.now()) {
  const s = String(value || '').trim();
  const m = WHEN_RE.exec(s);
  if (!m) return { error: '請選擇見面時間' };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (hour > 23 || minute > 59) return { error: '見面時間不正確' };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { error: '見面時間不正確' };
  }
  const instant = Date.UTC(year, month - 1, day, hour, minute) - 8 * HOUR;
  if (instant < now - HOUR) return { error: '見面時間已過，請再選' };
  if (instant > now + 90 * DAY) return { error: '見面時間請選 90 日內' };
  return { when: s, instant };
}

export function partyRole(offer, listing, userId) {
  if (!offer || !listing || !userId) return '';
  if (listing.sellerId === userId) return 'seller';
  if (offer.fromId === userId) return 'buyer';
  return '';
}

export function handoffAccess(offer, listing, userId) {
  const role = partyRole(offer, listing, userId);
  const accepted = offer?.status === 'accepted';
  return { role, canHandoff: Boolean(role && accepted) };
}

export function presentHandoff(row) {
  if (!row) return null;
  const buyerOk = Boolean(row.buyerOk);
  const sellerOk = Boolean(row.sellerOk);
  return {
    id: row.id,
    offerId: row.offerId,
    listingId: row.listingId,
    placeId: row.placeId,
    place: row.place,
    customPlace: row.customPlace || '',
    when: row.when,
    whenLabel: formatWhenLabel(row.when),
    note: row.note || '',
    proposedBy: row.proposedBy,
    buyerOk,
    sellerOk,
    status: buyerOk && sellerOk ? 'confirmed' : 'proposed',
    updatedAt: row.updatedAt || row.createdAt || 0,
  };
}

export function findHandoff(db, offerId) {
  return (db?.handoffs || []).find((h) => h.offerId === offerId) || null;
}

export function buildProposal({
  existing = null,
  offer,
  listing,
  userId,
  placeId,
  customPlace = '',
  when,
  note = '',
  now = Date.now(),
  id,
}) {
  const access = handoffAccess(offer, listing, userId);
  if (!access.canHandoff) return { error: '這筆出價還沒有接受，或你不是買賣雙方' };
  const pid = String(placeId || '').trim();
  if (!PLACE_BY_ID.has(pid)) return { error: '請選一個見面地點' };
  const custom = String(customPlace || '').replace(/[\r\n]+/g, ' ').trim();
  if (pid === 'custom') {
    if (!custom) return { error: '請填寫自訂地點' };
    if ([...custom].length > 40) return { error: '地點最多 40 字' };
  }
  const parsed = parseWhen(when, now);
  if (parsed.error) return { error: parsed.error };
  const text = String(note || '').replace(/[\r\n]+/g, ' ').trim();
  if ([...text].length > 80) return { error: '備註最多 80 字' };
  const place = pid === 'custom' ? custom : placeLabel(pid);
  const row = {
    id: existing?.id || id,
    offerId: offer.id,
    listingId: listing.id,
    placeId: pid,
    place,
    customPlace: pid === 'custom' ? custom : '',
    when: parsed.when,
    note: text,
    proposedBy: userId,
    buyerOk: access.role === 'buyer',
    sellerOk: access.role === 'seller',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return {
    handoff: row,
    role: access.role,
    summary: `${formatWhenLabel(parsed.when)} · ${place}`,
    changed: !existing,
  };
}

export function confirmProposal(row, offer, listing, userId, now = Date.now()) {
  const access = handoffAccess(offer, listing, userId);
  if (!access.canHandoff) return { error: '這筆暫時不能確認見面' };
  if (!row) return { error: '尚未有見面提議' };
  const next = { ...row, updatedAt: now };
  if (access.role === 'buyer') next.buyerOk = true;
  else next.sellerOk = true;
  const wasConfirmed = Boolean(row.buyerOk && row.sellerOk);
  const confirmed = Boolean(next.buyerOk && next.sellerOk);
  return {
    handoff: next,
    role: access.role,
    became: confirmed && !wasConfirmed,
    already: access.role === 'buyer' ? Boolean(row.buyerOk) : Boolean(row.sellerOk),
  };
}
