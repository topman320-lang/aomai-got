import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** One-time email verification links stay valid for 48 hours. */
export const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;

export const VERIFY_SUBJECT = '請認證你嘅澳賣GOT帳戶 / Verify your 澳賣GOT account';

/** Approved copy. Chinese block, then the link, then the English block, then the same link. */
export const VERIFY_ZH = `歡迎加入澳賣GOT（MoGOT）！
多謝你註冊——澳門街坊二手，價錢可以傾。
請撳下面認證連結，啟用你嘅帳戶，之後就可以刊登同出價。`;

export const VERIFY_EN = `Welcome to 澳賣GOT (MoGOT)!
Thanks for signing up — Macau neighborhood second-hand, where prices are negotiable.
Please tap the verification link below to activate your account, then you can list and make offers.`;

export const RESET_SUBJECT = '重設你嘅澳賣GOT密碼 / Reset your 澳賣GOT password';

export const RESET_ZH = `你申請重設澳賣GOT（MoGOT）嘅密碼。
請撳下面個掣設定新密碼。連結 30 分鐘內有效，而且只用得一次。
如果你冇申請，可以不理呢封信，你嘅密碼唔會改變。`;

export const RESET_EN = `You asked to reset the password for your 澳賣GOT (MoGOT) account.
Tap the button below to choose a new password. The link expires in 30 minutes and can only be used once.
If you did not request this, you can ignore this email and your password will stay the same.`;

export const RESET_CTA_ZH = '重設密碼';
export const RESET_CTA_EN = 'Reset password';

export const DEFAULT_MAIL_FROM = '澳賣GOT <noreply@aomai-got.onrender.com>';

export const RESEND_EMAIL_LIMIT = 5;
export const RESEND_IP_LIMIT = 30;
export const RESEND_WINDOW_MS = 60 * 60 * 1000;

const rateBuckets = new Map();

export function isTestEnv(env = process.env) {
  return env.NODE_ENV === 'test';
}

export function isProductionEnv(env = process.env) {
  return env.NODE_ENV === 'production';
}

export function mailFrom(env = process.env) {
  const from = String(env.MAIL_FROM || '').trim();
  return from || DEFAULT_MAIL_FROM;
}

/** Resend wins when both providers are configured. */
export function mailTransportKind(env = process.env) {
  if (String(env.RESEND_API_KEY || '').trim()) return 'resend';
  if (String(env.SMTP_URL || '').trim()) return 'smtp';
  return '';
}

/**
 * Production must have a real transporter. Tests skip sending.
 * Local development without mail still creates the account and logs the link.
 */
export function assertCanSendMail(env = process.env) {
  if (isTestEnv(env) || mailTransportKind(env) || !isProductionEnv(env)) return;
  const err = new Error('MAIL_NOT_CONFIGURED');
  err.code = 'MAIL_NOT_CONFIGURED';
  throw err;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function verifyLinkHtml(url) {
  const safe = escapeHtml(url);
  return `<p style="margin:16px 0 24px"><a href="${safe}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:4px;font-weight:600;word-break:break-all">${safe}</a></p>`;
}

function paragraphHtml(text) {
  return String(text)
    .split('\n')
    .map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`)
    .join('\n');
}

function actionLinkHtml(url, label) {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  return `<p style="margin:16px 0 8px"><a href="${safeUrl}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:4px;font-weight:600;font-size:16px;line-height:20px">${safeLabel}</a></p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all"><a href="${safeUrl}">${safeUrl}</a></p>`;
}

export function verificationMail({ url }) {
  const link = String(url || '').trim();
  const text = `${VERIFY_ZH}\n${link}\n\n${VERIFY_EN}\n${link}`;
  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Noto Sans TC',sans-serif;color:#111111;line-height:1.7;font-size:15px">
${VERIFY_ZH.split('\n').map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`).join('\n')}
${verifyLinkHtml(link)}
${VERIFY_EN.split('\n').map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`).join('\n')}
${verifyLinkHtml(link)}
</body>
</html>`;
  return { subject: VERIFY_SUBJECT, text, html };
}

/** Password-reset mail: Chinese, then English, each with the same one-time link. */
export function passwordResetMail({ url }) {
  const link = String(url || '').trim();
  const text = `${RESET_ZH}\n${RESET_CTA_ZH}：${link}\n\n${RESET_EN}\n${RESET_CTA_EN}: ${link}`;
  const html = `<!DOCTYPE html>
<html lang="zh-Hant" dir="ltr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(RESET_SUBJECT)}</title>
</head>
<body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Noto Sans TC',sans-serif;color:#111111;line-height:1.7;font-size:16px">
<div lang="zh-Hant" dir="ltr" style="display:none;max-height:0;overflow:hidden;mso-hide:all">呢條連結 30 分鐘內有效。</div>
<div lang="en" dir="ltr" style="display:none;max-height:0;overflow:hidden;mso-hide:all">This link expires in 30 minutes.</div>
<div lang="zh-Hant" dir="ltr">
<h1 style="font-size:22px;line-height:1.3;margin:0 0 12px">重設密碼</h1>
${paragraphHtml(RESET_ZH)}
${actionLinkHtml(link, RESET_CTA_ZH)}
</div>
<div lang="en" dir="ltr">
<h1 style="font-size:22px;line-height:1.3;margin:0 0 12px">Reset your password</h1>
${paragraphHtml(RESET_EN)}
${actionLinkHtml(link, RESET_CTA_EN)}
</div>
</body>
</html>`;
  return { subject: RESET_SUBJECT, text, html };
}

function rememberOutbox(message, env) {
  const file = String(env.MAIL_OUTBOX || '').trim();
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(message)}\n`);
}

async function sendViaResend(message, env) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: mailFrom(env),
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const err = new Error(`Resend HTTP ${res.status}`);
    err.code = 'MAIL_FAILED';
    throw err;
  }
  return { ok: true, via: 'resend' };
}

async function sendViaSmtp(message, env) {
  const imported = await import('nodemailer');
  const nodemailer = imported.createTransport ? imported : imported.default;
  const transport = nodemailer.createTransport(String(env.SMTP_URL).trim());
  await transport.sendMail({
    from: mailFrom(env),
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { ok: true, via: 'smtp' };
}

/**
 * Send one message. Tests never touch the network. Production without a
 * transporter throws. Development without a transporter returns `{ devLog: true }`.
 */
export async function sendMail(message, env = process.env) {
  const record = {
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
  if (isTestEnv(env)) {
    rememberOutbox(record, env);
    return { ok: true, skipped: true };
  }
  const kind = mailTransportKind(env);
  if (!kind) {
    if (isProductionEnv(env)) {
      const err = new Error('MAIL_NOT_CONFIGURED');
      err.code = 'MAIL_NOT_CONFIGURED';
      throw err;
    }
    rememberOutbox(record, env);
    return { ok: true, skipped: true, devLog: true };
  }
  if (kind === 'resend') return sendViaResend(record, env);
  return sendViaSmtp(record, env);
}

/** Missing `emailVerified` is already verified, so existing accounts keep working. */
export function isEmailVerified(user) {
  return Boolean(user) && user.emailVerified !== false;
}

export function hashVerifyToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function issueEmailVerify(user, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('base64url');
  user.emailVerified = false;
  user.emailVerify = {
    hash: hashVerifyToken(token),
    expiresAt: now + VERIFY_TTL_MS,
  };
  return token;
}

export function consumeEmailVerify(user, token, now = Date.now()) {
  const stored = user?.emailVerify?.hash;
  if (typeof stored !== 'string' || typeof token !== 'string' || !token) {
    return { ok: false, matched: false };
  }
  const actual = Buffer.from(hashVerifyToken(token));
  const expected = Buffer.from(stored);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return { ok: false, matched: false };
  }
  const expiresAt = Number(user.emailVerify.expiresAt);
  if (!Number.isFinite(expiresAt) || now > expiresAt) {
    delete user.emailVerify;
    return { ok: false, matched: true, reason: 'EXPIRED' };
  }
  user.emailVerified = true;
  delete user.emailVerify;
  return { ok: true, matched: true };
}

export function allowRate(key, limit, windowMs, now = Date.now()) {
  const prev = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
  if (prev.length >= limit) {
    rateBuckets.set(key, prev);
    return false;
  }
  prev.push(now);
  rateBuckets.set(key, prev);
  return true;
}
