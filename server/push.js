/**
 * Apple Push Notification service (HTTP/2, token auth).
 *
 * Sends only when APNS_KEY_ID, APNS_TEAM_ID, and APNS_KEY are set.
 * APNS_BUNDLE_ID defaults to com.aomai.got. APNS_ENV (production or sandbox)
 * chooses which host is tried first; BadDeviceToken retries the other host once.
 * Nothing here is a real credential. Android FCM is not sent.
 */
import http2 from 'node:http2';
import jwt from 'jsonwebtoken';
import { id } from './db.js';

const PRODUCTION_HOST = 'api.push.apple.com';
const SANDBOX_HOST = 'api.sandbox.push.apple.com';

let tokenCache = { key: '', token: '', iat: 0 };

export function normalizeApnsKey(raw) {
  let key = String(raw || '').trim();
  if (!key) return '';
  key = key.replace(/\\n/g, '\n');
  if (!key.includes('BEGIN')) {
    const compact = key.replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 80) {
      try {
        const decoded = Buffer.from(compact, 'base64').toString('utf8');
        if (decoded.includes('BEGIN')) key = decoded;
      } catch {
        /* keep the original text */
      }
    }
  }
  return key;
}

export function apnsCredentials(env = process.env) {
  const keyId = String(env.APNS_KEY_ID || '').trim();
  const teamId = String(env.APNS_TEAM_ID || '').trim();
  const key = normalizeApnsKey(env.APNS_KEY);
  const bundleId = String(env.APNS_BUNDLE_ID || 'com.aomai.got').trim() || 'com.aomai.got';
  const envName = String(env.APNS_ENV || 'production').trim().toLowerCase();
  const sandbox = envName === 'sandbox' || envName === 'development';
  return {
    configured: Boolean(keyId && teamId && key.includes('BEGIN')),
    keyId,
    teamId,
    key,
    bundleId,
    sandbox,
  };
}

export function apnsProviderToken(creds, nowSec = Math.floor(Date.now() / 1000)) {
  const cacheKey = `${creds.keyId}:${creds.teamId}:${creds.key}`;
  if (tokenCache.key === cacheKey && nowSec >= tokenCache.iat && nowSec - tokenCache.iat < 50 * 60) {
    return tokenCache.token;
  }
  const token = jwt.sign({ iss: creds.teamId, iat: nowSec }, creds.key, {
    algorithm: 'ES256',
    keyid: creds.keyId,
  });
  tokenCache = { key: cacheKey, token, iat: nowSec };
  return token;
}

export function isApnsToken(token) {
  return /^[0-9a-f]{32,200}$/i.test(String(token || '').trim());
}

export function deviceAlertsOn(device) {
  if (!device) return false;
  if (device.alerts === false) return false;
  if (device.alerts === true) return true;
  return Boolean(String(device.token || '').trim());
}

export function iosPushTargets(db, userId) {
  return (db?.devices || []).filter(
    (device) =>
      device &&
      device.userId === userId &&
      device.platform === 'ios' &&
      deviceAlertsOn(device) &&
      isApnsToken(device.token)
  );
}

export function applyAlertPreference(db, userId, body = {}) {
  const installId = String(body.installId || '').trim().slice(0, 80);
  const token = String(body.token || '').trim();
  const platform = String(body.platform || '').trim();
  const alerts =
    typeof body.enabled === 'boolean' ? body.enabled : typeof body.alerts === 'boolean' ? body.alerts : null;
  if (!installId && !token) return { error: 'INVALID_INPUT', message: '缺少裝置識別' };
  if (token.length > 4096) return { error: 'INVALID_INPUT', message: '裝置權杖不正確' };
  if (platform && !['ios', 'android', 'web'].includes(platform)) {
    return { error: 'INVALID_INPUT', message: '平台不正確' };
  }
  if (!Array.isArray(db.devices)) db.devices = [];
  let row = installId ? db.devices.find((d) => d.userId === userId && d.installId === installId) : null;
  if (!row && token) row = db.devices.find((d) => d.userId === userId && d.token === token);
  const now = Date.now();
  if (!row) {
    row = {
      id: id('d-'),
      userId,
      token,
      platform: platform || 'web',
      installId,
      alerts: alerts === null ? Boolean(token) : alerts,
      createdAt: now,
      updatedAt: now,
    };
    db.devices.push(row);
  } else {
    if (token) row.token = token;
    if (platform) row.platform = platform;
    if (installId) row.installId = installId;
    if (alerts !== null) row.alerts = alerts;
    else if (typeof row.alerts !== 'boolean') row.alerts = true;
    row.updatedAt = now;
  }
  return { device: row };
}

function alertPayload(notice) {
  return {
    aps: {
      alert: {
        title: String(notice?.title || '澳賣GOT').slice(0, 40),
        body: String(notice?.body || '').slice(0, 140),
      },
      sound: 'default',
    },
    href: String(notice?.href || ''),
    kind: String(notice?.kind || ''),
    noticeId: String(notice?.id || ''),
  };
}

function shouldDropToken(result) {
  if (!result) return false;
  if (result.status === 410 || result.reason === 'Unregistered') return true;
  return result.status === 400 && result.reason === 'BadDeviceToken';
}

async function sendToDevice(device, notice, creds, bearer, transport) {
  const preferred =
    device.apnsEnv === 'sandbox' || device.apnsEnv === 'production'
      ? device.apnsEnv
      : creds.sandbox
        ? 'sandbox'
        : 'production';
  const order = preferred === 'sandbox' ? ['sandbox', 'production'] : ['production', 'sandbox'];
  const payload = alertPayload(notice);
  let last = { ok: false, status: 0, reason: '', apnsEnv: preferred };
  for (let i = 0; i < order.length; i += 1) {
    const apnsEnv = order[i];
    const host = apnsEnv === 'sandbox' ? SANDBOX_HOST : PRODUCTION_HOST;
    const sent = await transport({
      host,
      deviceToken: String(device.token || '').trim(),
      topic: creds.bundleId,
      bearer,
      payload,
      collapseId: String(notice?.id || '').slice(0, 64),
    });
    last = {
      ok: Boolean(sent?.ok),
      status: Number(sent?.status || 0),
      reason: String(sent?.reason || ''),
      apnsEnv,
    };
    if (last.ok) return last;
    const retry = i === 0 && last.status === 400 && last.reason === 'BadDeviceToken';
    if (!retry) return last;
  }
  return last;
}

export function postApns({ host, deviceToken, topic, bearer, payload, collapseId, timeoutMs = 10000 }) {
  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        client.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };
    timer = setTimeout(() => finish({ ok: false, status: 0, reason: 'timeout' }), timeoutMs);
    client.on('error', (err) => finish({ ok: false, status: 0, reason: err?.message || 'connect_error' }));
    let req;
    try {
      const headers = {
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${bearer}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      };
      if (collapseId) headers['apns-collapse-id'] = collapseId;
      req = client.request(headers);
    } catch (err) {
      finish({ ok: false, status: 0, reason: err?.message || 'request_error' });
      return;
    }
    let status = 0;
    let body = '';
    req.on('response', (headers) => {
      status = Number(headers[':status'] || 0);
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('error', (err) => finish({ ok: false, status: 0, reason: err?.message || 'request_error' }));
    req.on('end', () => {
      let reason = '';
      if (body) {
        try {
          reason = JSON.parse(body).reason || '';
        } catch {
          reason = String(body).slice(0, 180);
        }
      }
      finish({ ok: status === 200, status, reason });
    });
    req.end(JSON.stringify(payload));
  });
}

export async function deliverNoticePush(db, notice, options = {}) {
  const userId = String(notice?.userId || '');
  const targets = iosPushTargets(db, userId);
  const creds = options.creds || apnsCredentials();
  if (!targets.length) return { delivered: 0, attempted: 0, skipped: 'no_devices', changed: false };
  if (!creds.configured) {
    return { delivered: 0, attempted: 0, skipped: 'credentials_missing', changed: false, devices: targets.length };
  }
  const skipNetwork =
    !options.transport &&
    options.allowNetwork !== true &&
    process.env.NODE_ENV === 'test' &&
    process.env.APNS_ALLOW_NETWORK !== '1';
  if (skipNetwork) {
    return { delivered: 0, attempted: targets.length, skipped: 'test', changed: false };
  }
  let bearer = '';
  try {
    bearer = apnsProviderToken(creds, options.nowSec);
  } catch (err) {
    return {
      delivered: 0,
      attempted: 0,
      skipped: 'credentials_invalid',
      changed: false,
      reason: err?.message || '',
    };
  }
  const transport = options.transport || postApns;
  let delivered = 0;
  let changed = false;
  const results = [];
  for (const device of targets) {
    const sent = await sendToDevice(device, notice, creds, bearer, transport);
    results.push({ ok: sent.ok, status: sent.status, reason: sent.reason, apnsEnv: sent.apnsEnv });
    if (sent.ok) {
      delivered += 1;
      if (sent.apnsEnv && device.apnsEnv !== sent.apnsEnv) {
        device.apnsEnv = sent.apnsEnv;
        device.updatedAt = Date.now();
        changed = true;
      }
    } else if (shouldDropToken(sent)) {
      db.devices = (db.devices || []).filter((item) => item !== device);
      changed = true;
    }
  }
  return { delivered, attempted: targets.length, skipped: '', changed, results };
}
