import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aomai-voice-api-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;

function tinyWav() {
  const data = Buffer.alloc(32);
  const buf = Buffer.alloc(44 + data.length);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + data.length, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(data.length, 40);
  data.copy(buf, 44);
  return buf;
}

async function waitForHealth() {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
      last = `status ${res.status}`;
    } catch (err) {
      last = err?.message || String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`API did not start (${last})`);
}

test('voice messages follow the chat image trust model', async (t) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: path.join(tmp, 'data'),
      UPLOADS_DIR: path.join(tmp, 'uploads'),
      JWT_SECRET: 'voice-test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  t.after(() => {
    child.kill();
  });

  try {
    await waitForHealth();
  } catch (err) {
    child.kill();
    throw new Error(`${err.message}\n${logs}`);
  }

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@aomai.got', password: 'demo1234' }),
  });
  assert.equal(loginRes.status, 200);
  const login = await loginRes.json();
  const auth = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };

  const threadsRes = await fetch(`${base}/api/threads`, { headers: auth });
  assert.equal(threadsRes.status, 200);
  const { threads } = await threadsRes.json();
  assert.ok(threads.length > 0);
  const threadId = threads[0].id;

  const anon = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio: { data: `data:audio/wav;base64,${tinyWav().toString('base64')}`, duration: 2 },
    }),
  });
  assert.equal(anon.status, 401);

  const strangerRes = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '路人', email: 'stranger-voice@aomai.got', password: 'secret1' }),
  });
  assert.equal(strangerRes.status, 201);
  const stranger = await strangerRes.json();
  const forbidden = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${stranger.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio: { data: `data:audio/wav;base64,${tinyWav().toString('base64')}`, duration: 2 },
    }),
  });
  assert.equal(forbidden.status, 403);

  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const rejected = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ audio: { data: png, duration: 2 } }),
  });
  assert.equal(rejected.status, 400);
  const rejectedBody = await rejected.json();
  assert.equal(rejectedBody.error, 'INVALID_AUDIO');
  assert.match(rejectedBody.message, /音訊|語音/);

  const sent = await fetch(`${base}/api/threads/${threadId}/messages`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      text: '',
      audio: { data: `data:audio/wav;base64,${tinyWav().toString('base64')}`, duration: 2 },
    }),
  });
  assert.equal(sent.status, 201);
  const payload = await sent.json();
  assert.equal(payload.thread.preview, '語音訊息');
  assert.equal(payload.message.text, '');
  assert.equal(payload.message.audio.duration, 2);
  assert.match(payload.message.audio.url, /\/uploads\/aud-[a-f0-9]+\.wav$/);
  assert.equal(JSON.stringify(payload).includes('<script'), false);

  const file = await fetch(payload.message.audio.url);
  assert.equal(file.status, 200);
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.match(String(file.headers.get('content-type') || ''), /audio\/wav|audio\/wave|audio\/x-wav/);

  const again = await fetch(`${base}/api/threads/${threadId}`, { headers: auth });
  const stored = await again.json();
  const voice = stored.thread.messages.find((m) => m.id === payload.message.id);
  assert.ok(voice);
  assert.equal(voice.audio.duration, 2);
  assert.match(voice.audio.url, /\/uploads\/aud-/);
});