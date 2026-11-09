import { DevicesApi, NoticesApi } from './api.js';
import { getState, isLoggedIn, refreshNotices, sessionGeneration } from './store.js';

const CURSOR_KEY = 'aomai-notice-cursor';
const INSTALL_KEY = 'aomai-install-id';
const TOKEN_STORE = 'aomai-push-token';

let timer = 0;
let nativeLocal = false;
let nativePlatform = '';
let remoteReady = false;
let actionHooked = false;
let memoryInstall = '';
let onArrive = null;

export function alertsStorageKey(userId) {
  return `aomai-message-alerts:${String(userId || '')}`;
}

export function messageAlertNote({ enabled, remotePush, permission } = {}) {
  if (!enabled && permission === 'denied') {
    return '系統未允許通知，提醒維持關閉。未讀紅點仍然會顯示。';
  }
  if (!enabled) {
    return '關閉。新訊息同出價唔會彈通知，App 關閉時亦唔會推播。未讀紅點仍然會顯示。';
  }
  if (permission === 'denied') {
    return '你開咗提醒，但系統未允許通知，所以而家收唔到。未讀紅點仍然會顯示。';
  }
  if (remotePush) {
    return '開啟。新訊息同出價會通知你；App 完全關閉時，經 Apple 推播送達。未讀紅點會保持。';
  }
  return '開啟。而家會用本機通知。Apple 推播未設定，App 完全關閉時可能收唔到。未讀紅點會保持。';
}

export function notifyStatusText(enabled = false) {
  return enabled ? '開啟' : '關閉';
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `inst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function installId() {
  try {
    const existing = localStorage.getItem(INSTALL_KEY);
    if (existing && existing.length <= 80) return existing;
    const created = randomId();
    localStorage.setItem(INSTALL_KEY, created);
    return created;
  } catch {
    if (!memoryInstall) memoryInstall = randomId();
    return memoryInstall;
  }
}

function readLocal(userId) {
  if (!userId) return null;
  try {
    const value = localStorage.getItem(alertsStorageKey(userId));
    if (value === '1') return true;
    if (value === '0') return false;
    return null;
  } catch {
    return null;
  }
}

function writeLocal(userId, enabled) {
  if (!userId) return;
  try {
    localStorage.setItem(alertsStorageKey(userId), enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function messageAlertsEnabled(userId) {
  const id = userId || getState().me?.id || '';
  return readLocal(id) === true;
}

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORE) || '';
  } catch {
    return '';
  }
}

function writeStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_STORE, token);
  } catch {
    /* ignore */
  }
}

function readCursor() {
  try {
    const n = Number(localStorage.getItem(CURSOR_KEY));
    if (Number.isFinite(n) && n > 0) return n;
    const now = Date.now();
    localStorage.setItem(CURSOR_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

function writeCursor(ts) {
  try {
    localStorage.setItem(CURSOR_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

function hashId(value) {
  const text = String(value || '');
  let n = 0;
  for (let i = 0; i < text.length; i += 1) n = (n * 33 + text.charCodeAt(i)) >>> 0;
  return (n % 2147483646) + 1;
}

async function clientPlatform() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      nativePlatform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
      return nativePlatform;
    }
  } catch {
    /* web */
  }
  nativePlatform = '';
  return 'web';
}

async function refreshNativeLocalFlag() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      nativeLocal = false;
      return;
    }
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    nativeLocal = perm?.display === 'granted';
  } catch {
    nativeLocal = false;
  }
}

async function currentPermission() {
  const platform = await clientPlatform();
  if (platform === 'ios' || platform === 'android') {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const local = await LocalNotifications.checkPermissions();
      const push = await PushNotifications.checkPermissions();
      if (push?.receive === 'granted' || local?.display === 'granted') return 'granted';
      if (push?.receive === 'denied' && local?.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'prompt';
    }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'default';
}

async function requestAlertPermission() {
  const platform = await clientPlatform();
  if (platform === 'ios' || platform === 'android') {
    let localOk = false;
    let pushOk = false;
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const local = await LocalNotifications.requestPermissions();
      localOk = local?.display === 'granted';
      nativeLocal = localOk;
    } catch (err) {
      console.warn('local notifications unavailable', err);
    }
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const push = await PushNotifications.requestPermissions();
      pushOk = push?.receive === 'granted';
    } catch (err) {
      console.warn('push permission unavailable', err);
    }
    return localOk || pushOk ? 'granted' : 'denied';
  }
  if (typeof Notification === 'undefined') return 'granted';
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') return 'granted';
    if (permission === 'denied') return 'denied';
    return permission || 'default';
  } catch {
    return Notification.permission === 'granted' ? 'granted' : 'denied';
  }
}

async function ensureActionListener() {
  if (actionHooked) return;
  actionHooked = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const href = action?.notification?.data?.href;
      if (!href || !isLoggedIn()) return;
      const path = String(href).replace(/^#\/?/, '').replace(/^\//, '');
      if (path) location.hash = `#/${path}`;
    });
  } catch (err) {
    actionHooked = false;
    console.warn('push tap listener unavailable', err);
  }
}

async function registerPushToken() {
  try {
    const platform = await clientPlatform();
    if (platform !== 'ios' && platform !== 'android') return '';
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    if (perm?.receive !== 'granted') return readStoredToken();
    await ensureActionListener();
    const token = await new Promise((resolve) => {
      let done = false;
      const handles = [];
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timerId);
        handles.forEach((handle) => {
          Promise.resolve(handle)
            .then((sub) => sub?.remove?.())
            .catch(() => {});
        });
        resolve(value);
      };
      const timerId = setTimeout(() => finish(readStoredToken()), 8000);
      handles.push(
        PushNotifications.addListener('registration', (event) => {
          const value = String(event?.value || '');
          if (value) writeStoredToken(value);
          finish(value);
        })
      );
      handles.push(PushNotifications.addListener('registrationError', () => finish(readStoredToken())));
      PushNotifications.register().catch(() => finish(readStoredToken()));
    });
    return token || readStoredToken();
  } catch (err) {
    console.warn('push registration unavailable', err);
    return readStoredToken();
  }
}

async function clearLocalBanners() {
  try {
    const platform = await clientPlatform();
    if (platform !== 'ios' && platform !== 'android') return;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const pending = await LocalNotifications.getPending();
    if (pending?.notifications?.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }
  } catch {
    /* ignore */
  }
}

async function savePreference(enabled, token = '') {
  const saved = await DevicesApi.prefs({
    enabled,
    installId: installId(),
    token: token || readStoredToken(),
    platform: await clientPlatform(),
  });
  remoteReady = Boolean(saved?.remotePush);
  return saved;
}

export async function loadMessageAlertPref() {
  const userId = getState().me?.id || '';
  let remote = null;
  let remotePush = false;
  try {
    const status = await NoticesApi.pushStatus(installId());
    remotePush = Boolean(status?.remotePush);
    if (status && typeof status.enabled === 'boolean') remote = status.enabled;
  } catch {
    remote = null;
  }
  remoteReady = remotePush;
  const local = readLocal(userId);
  const enabled = remote == null ? Boolean(local) : remote;
  writeLocal(userId, enabled);
  return {
    enabled,
    remotePush,
    permission: '',
    note: messageAlertNote({ enabled, remotePush }),
  };
}

/** Turn 訊息提醒 on or off for this user on this install. Off does not prompt. */
export async function setMessageAlerts(enabled) {
  const userId = getState().me?.id || '';
  if (!userId) {
    const err = new Error('請先登入');
    throw err;
  }
  const previous = readLocal(userId) === true;
  try {
    if (!enabled) {
      writeLocal(userId, false);
      remoteReady = false;
      await clearLocalBanners();
      const saved = await savePreference(false, readStoredToken());
      return {
        enabled: false,
        remotePush: Boolean(saved?.remotePush),
        permission: '',
        note: messageAlertNote({ enabled: false, remotePush: Boolean(saved?.remotePush) }),
      };
    }
    const permission = await requestAlertPermission();
    if (permission !== 'granted') {
      writeLocal(userId, false);
      await savePreference(false, readStoredToken());
      return {
        enabled: false,
        remotePush: false,
        permission: 'denied',
        note: messageAlertNote({ enabled: false, permission: 'denied' }),
      };
    }
    writeLocal(userId, true);
    await refreshNativeLocalFlag();
    const token = await registerPushToken();
    const saved = await savePreference(true, token);
    const remotePush = Boolean(saved?.remotePush);
    return {
      enabled: true,
      remotePush,
      permission,
      local: nativeLocal,
      note: messageAlertNote({ enabled: true, remotePush }),
    };
  } catch (err) {
    writeLocal(userId, previous);
    throw err;
  }
}

/** Re-register the device token when this install already opted in. Does not prompt. */
export async function resumeMessageAlerts() {
  if (!isLoggedIn()) {
    return { enabled: false, remotePush: false, note: messageAlertNote({ enabled: false }) };
  }
  const pref = await loadMessageAlertPref();
  if (!pref.enabled) return pref;
  const permission = await currentPermission();
  if (permission !== 'granted') {
    return {
      ...pref,
      permission,
      note: messageAlertNote({
        enabled: true,
        remotePush: pref.remotePush,
        permission: permission === 'denied' ? 'denied' : '',
      }),
    };
  }
  await refreshNativeLocalFlag();
  const token = await registerPushToken();
  try {
    const saved = await savePreference(true, token);
    const remotePush = Boolean(saved?.remotePush);
    writeLocal(getState().me?.id, true);
    return {
      enabled: true,
      remotePush,
      permission: 'granted',
      note: messageAlertNote({ enabled: true, remotePush }),
    };
  } catch {
    return pref;
  }
}

async function showSystemNotice(notice) {
  if (!messageAlertsEnabled()) return;
  if (typeof document !== 'undefined' && !document.hidden) return;
  const iosRemote = remoteReady && nativePlatform === 'ios' && Boolean(readStoredToken());
  if (nativeLocal && !iosRemote) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: [
          {
            id: hashId(notice.id),
            title: notice.title || '澳賣GOT',
            body: notice.body || '',
            schedule: { at: new Date(Date.now() + 400) },
          },
        ],
      });
      return;
    } catch (err) {
      console.warn('local notification failed', err);
    }
  }
  if (iosRemote) return;
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(notice.title || '澳賣GOT', { body: notice.body || '', tag: notice.id });
    } catch {
      /* in-app toast still runs */
    }
  }
}

async function poll() {
  if (!isLoggedIn()) return;
  const session = sessionGeneration();
  let notices = [];
  try {
    notices = await refreshNotices();
  } catch {
    return;
  }
  if (session !== sessionGeneration() || !isLoggedIn()) return;
  let cursor = readCursor();
  const fresh = (notices || [])
    .filter((n) => !n.read && Number(n.createdAt) > cursor)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const notice of fresh) {
    if (session !== sessionGeneration() || !isLoggedIn()) return;
    cursor = Math.max(cursor, Number(notice.createdAt) || cursor);
    if (onArrive) onArrive(notice);
    showSystemNotice(notice);
  }
  if (fresh.length) writeCursor(cursor);
}

export function watchNotices({ onNotice } = {}) {
  onArrive = typeof onNotice === 'function' ? onNotice : null;
  readCursor();
  if (timer) clearInterval(timer);
  poll();
  timer = setInterval(poll, 25000);
  if (!watchNotices.bound) {
    watchNotices.bound = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll();
    });
  }
}

export function stopNotices() {
  if (timer) clearInterval(timer);
  timer = 0;
  onArrive = null;
}
