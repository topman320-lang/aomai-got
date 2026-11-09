import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import test from 'node:test';
import {
  apnsCredentials,
  apnsProviderToken,
  applyAlertPreference,
  deliverNoticePush,
  normalizeApnsKey,
} from './push.js';

const TOKEN = 'ab'.repeat(32);

function pemPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey,
  };
}

function creds(extra = {}) {
  const { privatePem } = pemPair();
  return {
    configured: true,
    keyId: 'KEYID12345',
    teamId: 'TEAMID1234',
    key: privatePem,
    bundleId: 'com.aomai.got',
    sandbox: false,
    ...extra,
  };
}

const notice = {
  id: 'n-1',
  userId: 'u1',
  kind: 'message',
  title: '新訊息',
  body: '晚上好',
  href: 'chat/t-1',
};

test('APNs credentials stay off until the key, team, and key id are all set', () => {
  assert.equal(apnsCredentials({}).configured, false);
  assert.equal(
    apnsCredentials({ APNS_KEY_ID: 'KEYID12345', APNS_TEAM_ID: 'TEAMID1234' }).configured,
    false
  );
  const { privatePem } = pemPair();
  const ready = apnsCredentials({
    APNS_KEY_ID: 'KEYID12345',
    APNS_TEAM_ID: 'TEAMID1234',
    APNS_KEY: privatePem,
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.bundleId, 'com.aomai.got');
  assert.equal(ready.sandbox, false);
  assert.equal(
    apnsCredentials({
      APNS_KEY_ID: 'KEYID12345',
      APNS_TEAM_ID: 'TEAMID1234',
      APNS_KEY: privatePem,
      APNS_BUNDLE_ID: 'com.example.app',
      APNS_ENV: 'sandbox',
    }).sandbox,
    true
  );
});

test('a one-line p8 restores its PEM newlines', () => {
  const stored = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----';
  assert.match(normalizeApnsKey(stored), /BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----/);
  const pem = `-----BEGIN PRIVATE KEY-----\n${'ABC'.repeat(40)}\n-----END PRIVATE KEY-----\n`;
  const wrapped = Buffer.from(pem, 'utf8').toString('base64');
  assert.ok(wrapped.length > 80);
  assert.match(normalizeApnsKey(wrapped), /BEGIN PRIVATE KEY/);
});

test('provider token is an ES256 JWT for the team and key id', () => {
  const { privatePem, publicKey } = pemPair();
  const token = apnsProviderToken(
    {
      keyId: 'KEYID12345',
      teamId: 'TEAMID1234',
      key: privatePem,
    },
    1_700_000_000
  );
  const decoded = jwt.decode(token, { complete: true });
  assert.equal(decoded.header.alg, 'ES256');
  assert.equal(decoded.header.kid, 'KEYID12345');
  assert.equal(decoded.payload.iss, 'TEAMID1234');
  assert.equal(decoded.payload.iat, 1_700_000_000);
  const verified = jwt.verify(token, publicKey, { algorithms: ['ES256'] });
  assert.equal(verified.iss, 'TEAMID1234');
});

test('alert preference is stored per user and install', () => {
  const db = { devices: [] };
  const first = applyAlertPreference(db, 'u1', {
    installId: 'phone',
    enabled: true,
    platform: 'ios',
    token: TOKEN,
  });
  applyAlertPreference(db, 'u2', {
    installId: 'phone',
    enabled: false,
    platform: 'ios',
    token: 'cd'.repeat(32),
  });
  assert.equal(db.devices.length, 2);
  assert.equal(first.device.alerts, true);
  applyAlertPreference(db, 'u1', { installId: 'phone', enabled: false });
  assert.equal(db.devices.length, 2);
  assert.equal(db.devices.find((d) => d.userId === 'u1').alerts, false);
  assert.equal(db.devices.find((d) => d.userId === 'u1').token, TOKEN);
  assert.equal(db.devices.find((d) => d.userId === 'u2').alerts, false);
  const missing = applyAlertPreference(db, 'u1', {});
  assert.equal(missing.error, 'INVALID_INPUT');
});

test('remote push is skipped when alerts are off, the token is not iOS, or credentials are missing', async () => {
  const calls = [];
  const transport = async (request) => {
    calls.push(request);
    return { ok: true, status: 200, reason: '' };
  };
  const quiet = await deliverNoticePush(
    {
      devices: [
        { userId: 'u1', platform: 'ios', token: TOKEN, alerts: false },
        { userId: 'u1', platform: 'android', token: TOKEN, alerts: true },
        { userId: 'u2', platform: 'ios', token: TOKEN, alerts: true },
      ],
    },
    notice,
    { transport, creds: creds() }
  );
  assert.equal(quiet.skipped, 'no_devices');
  assert.equal(calls.length, 0);

  const missing = await deliverNoticePush(
    { devices: [{ userId: 'u1', platform: 'ios', token: TOKEN, alerts: true }] },
    notice,
    { transport, creds: { configured: false } }
  );
  assert.equal(missing.skipped, 'credentials_missing');
  assert.equal(missing.devices, 1);
  assert.equal(calls.length, 0);
});

test('an opted-in iOS device gets an alert, and a legacy row without alerts still does', async () => {
  const calls = [];
  const db = {
    devices: [
      { id: 'd-new', userId: 'u1', platform: 'ios', token: TOKEN, alerts: true },
      { id: 'd-old', userId: 'u1', platform: 'ios', token: 'ef'.repeat(32) },
    ],
  };
  const result = await deliverNoticePush(db, notice, {
    creds: creds(),
    transport: async (request) => {
      calls.push(request);
      return { ok: true, status: 200, reason: '' };
    },
  });
  assert.equal(result.delivered, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].host, 'api.push.apple.com');
  assert.equal(calls[0].topic, 'com.aomai.got');
  assert.equal(calls[0].payload.aps.alert.title, '新訊息');
  assert.equal(calls[0].payload.aps.alert.body, '晚上好');
  assert.equal(calls[0].payload.href, 'chat/t-1');
  assert.equal(calls[0].payload.kind, 'message');
  assert.equal(calls[0].collapseId, 'n-1');
  assert.equal(db.devices[0].apnsEnv, 'production');
});

test('BadDeviceToken retries the other APNs host and remembers which one worked', async () => {
  const calls = [];
  const db = { devices: [{ userId: 'u1', platform: 'ios', token: TOKEN, alerts: true }] };
  const result = await deliverNoticePush(db, notice, {
    creds: creds({ sandbox: false }),
    transport: async (request) => {
      calls.push(request.host);
      if (request.host.includes('sandbox')) return { ok: true, status: 200, reason: '' };
      return { ok: false, status: 400, reason: 'BadDeviceToken' };
    },
  });
  assert.deepEqual(calls, ['api.push.apple.com', 'api.sandbox.push.apple.com']);
  assert.equal(result.delivered, 1);
  assert.equal(db.devices[0].apnsEnv, 'sandbox');
  assert.equal(result.changed, true);
});

test('an unregistered token is dropped and a rejected key is kept', async () => {
  const gone = { id: 'd1', userId: 'u1', platform: 'ios', token: TOKEN, alerts: true };
  const kept = { id: 'd2', userId: 'u1', platform: 'ios', token: '11'.repeat(32), alerts: true };
  const db = { devices: [gone, kept] };
  let n = 0;
  const result = await deliverNoticePush(db, notice, {
    creds: creds(),
    transport: async () => {
      n += 1;
      if (n === 1) return { ok: false, status: 410, reason: 'Unregistered' };
      return { ok: false, status: 403, reason: 'InvalidProviderToken' };
    },
  });
  assert.equal(result.delivered, 0);
  assert.equal(result.changed, true);
  assert.equal(db.devices.length, 1);
  assert.equal(db.devices[0].id, 'd2');
});

test('notice creation asks the APNs sender, and the Xcode project has push entitlements', () => {
  const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(source, /deliverNoticePush\(db,\s*row\)/);
  assert.doesNotMatch(source, /remotePushHook/);
  const debug = fs.readFileSync(new URL('../ios/App/App/App.Debug.entitlements', import.meta.url), 'utf8');
  const release = fs.readFileSync(new URL('../ios/App/App/App.Release.entitlements', import.meta.url), 'utf8');
  const project = fs.readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const appDelegate = fs.readFileSync(new URL('../ios/App/App/AppDelegate.swift', import.meta.url), 'utf8');
  assert.match(debug, /<key>aps-environment<\/key>\s*<string>development<\/string>/);
  assert.match(release, /<key>aps-environment<\/key>\s*<string>production<\/string>/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = App\/App\.Debug\.entitlements;/);
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = App\/App\.Release\.entitlements;/);
  assert.match(appDelegate, /capacitorDidRegisterForRemoteNotifications/);
  assert.match(appDelegate, /capacitorDidFailToRegisterForRemoteNotifications/);
});
