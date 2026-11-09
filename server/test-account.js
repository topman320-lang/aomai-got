import assert from 'node:assert/strict';

/** Spawn env for API tests. Skips real mail and exposes the one-time token. */
export function testServerEnv(extra = {}) {
  return {
    NODE_ENV: 'test',
    SMTP_URL: '',
    RESEND_API_KEY: '',
    MAIL_FROM: '',
    MAIL_OUTBOX: '',
    PUBLIC_BASE: '',
    RENDER_EXTERNAL_URL: '',
    ...extra,
  };
}

/** Register, open the verification link, then log in. Returns the session payload. */
export async function registerAndLogin(base, { name, email, password = 'secret1' }) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const createdText = await res.text();
  assert.equal(res.status, 201, createdText);
  const created = JSON.parse(createdText);
  assert.equal(created.token, undefined);
  assert.equal(typeof created.verificationToken, 'string');
  const verify = await fetch(`${base}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: created.verificationToken }),
  });
  assert.equal(verify.status, 200, await verify.text());
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginText = await login.text();
  assert.equal(login.status, 200, loginText);
  return JSON.parse(loginText);
}
