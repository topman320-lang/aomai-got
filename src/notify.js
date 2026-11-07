import { DevicesApi } from './api.js';
import { isLoggedIn, refreshNotices } from './store.js';

const CURSOR_KEY = 'aomai-notice-cursor';

let timer = 0;
let nativeLocal = false;
let nativeHooked = false;
let onArrive = null;

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

export function notifyStatusText() {
  if (nativeLocal) return '已開啟本機通知';
  if (typeof Notification === 'undefined') return '應用內紅點';
  if (Notification.permission === 'granted') return '已開啟通知';
  if (Notification.permission === 'denied') return '瀏覽器已封鎖';
  return '未開啟';
}

async function setupNative(Capacitor) {
  const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  let localOk = false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    localOk = perm?.display === 'granted';
  } catch (err) {
    console.warn('local notifications unavailable', err);
  }
  if (!nativeHooked) {
    nativeHooked = true;
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const perm = await PushNotifications.requestPermissions();
      if (perm?.receive === 'granted') {
        const token = await new Promise((resolve) => {
          const timerId = setTimeout(() => resolve(''), 5000);
          PushNotifications.addListener('registration', (event) => {
            clearTimeout(timerId);
            resolve(String(event?.value || ''));
          });
          PushNotifications.addListener('registrationError', () => {
            clearTimeout(timerId);
            resolve('');
          });
          PushNotifications.register().catch(() => {
            clearTimeout(timerId);
            resolve('');
          });
        });
        if (token && isLoggedIn()) {
          await DevicesApi.register({ token, platform });
        }
      }
    } catch (err) {
      console.warn('push registration unavailable', err);
    }
  }
  return localOk;
}

/** Ask for permission. Web uses the Notifications API. Native also registers a device token when the plugin is present. */
export async function enableNotifications() {
  let native = false;
  try {
    const { Capacitor } = await import('@capacitor/core');
    native = Capacitor.isNativePlatform();
    if (native) nativeLocal = await setupNative(Capacitor);
  } catch {
    native = false;
  }
  let permission = 'unsupported';
  if (typeof Notification !== 'undefined') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission || 'denied';
    }
  }
  return {
    native,
    local: nativeLocal,
    permission,
    label: notifyStatusText(),
    remotePush: false,
  };
}

async function showSystemNotice(notice) {
  if (typeof document !== 'undefined' && !document.hidden) return;
  if (nativeLocal) {
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
  let notices = [];
  try {
    notices = await refreshNotices();
  } catch {
    return;
  }
  let cursor = readCursor();
  const fresh = (notices || [])
    .filter((n) => !n.read && Number(n.createdAt) > cursor)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const notice of fresh) {
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
