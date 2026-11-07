/** Public site. Localhost and the Capacitor shell share this so the link opens in a browser. */
export const PUBLIC_SITE = 'https://aomai-got.onrender.com';

function mop(price) {
  const num = Number(price);
  if (!Number.isFinite(num)) return 'MOP';
  return `MOP ${num.toLocaleString('zh-Hant')}`;
}

/** Hash route the SPA already uses: `/#/detail/<id>`. */
export function listingPageUrl(id, loc = {}) {
  const path = `#/detail/${encodeURIComponent(id || '')}`;
  const protocol = String(loc.protocol || '');
  const host = String(loc.hostname || '');
  const origin = String(loc.origin || '').replace(/\/$/, '');
  const http = protocol === 'http:' || protocol === 'https:';
  const local = !host || host === 'localhost' || host === '127.0.0.1';
  if (http && !local && origin) return `${origin}/${path}`;
  return `${PUBLIC_SITE}/${path}`;
}

/** Title, MOP price, and the listing link. `text` is what the share sheet and WhatsApp send. */
export function listingSharePayload(listing, loc) {
  const url = listingPageUrl(listing?.id, loc);
  const title = String(listing?.title || '澳賣GOT').trim() || '澳賣GOT';
  let priceLine = mop(listing?.price);
  if (listing?.sold) priceLine += ' · 已售';
  else if (listing?.negotiable) priceLine += ' · 可議';
  const preview = `${title}\n${priceLine}`;
  const text = `${preview}\n${url}`;
  return { title, text, preview, url, dialogTitle: '分享' };
}
