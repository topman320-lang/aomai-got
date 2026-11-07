import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeVoiceWav,
  formatVoiceDuration,
  mixToMono,
  playableAudioSrc,
  preferredRecorderMime,
  resampleMono,
  voiceErrorMessage,
} from './voice.js';

test('voice duration is m:ss', () => {
  assert.equal(formatVoiceDuration(0), '0:00');
  assert.equal(formatVoiceDuration(5.4), '0:05');
  assert.equal(formatVoiceDuration(60), '1:00');
  assert.equal(formatVoiceDuration(Number.NaN), '0:00');
});

test('recorder prefers a mime the browser actually supports', () => {
  assert.equal(preferredRecorderMime(null), '');
  assert.equal(
    preferredRecorderMime((type) => type === 'audio/mp4'),
    'audio/mp4'
  );
  assert.equal(
    preferredRecorderMime((type) => type === 'audio/webm;codecs=opus'),
    'audio/webm;codecs=opus'
  );
});

test('microphone denial uses a Chinese message', () => {
  assert.equal(voiceErrorMessage({ name: 'NotAllowedError' }), '請允許使用麥克風才能錄音');
  assert.equal(voiceErrorMessage({ name: 'NotFoundError' }), '找不到麥克風');
  assert.equal(voiceErrorMessage({ name: 'AbortError' }), '無法開始錄音');
});

test('playable audio src stays on our uploads and drops scripts', () => {
  assert.equal(playableAudioSrc('/uploads/aud-abc.wav', 'http://127.0.0.1:8787'), 'http://127.0.0.1:8787/uploads/aud-abc.wav');
  assert.equal(
    playableAudioSrc('http://127.0.0.1:10000/uploads/aud-abc.webm?x=1', ''),
    '/uploads/aud-abc.webm'
  );
  assert.equal(playableAudioSrc('javascript:alert(1)'), '');
  assert.equal(playableAudioSrc('data:audio/wav;base64,AAAA'), '');
  assert.equal(playableAudioSrc('https://evil.example/steal.mp3', 'https://aomai.example'), '');
  assert.equal(playableAudioSrc('/uploads/../secret.wav'), '');
  assert.equal(playableAudioSrc('/uploads/img-abc.jpg'), '');
});

test('wav encoder writes a mono PCM header', () => {
  const wav = encodeVoiceWav(Float32Array.of(0, 0.5, -1), 16000);
  const text = Buffer.from(wav).toString('ascii', 0, 12);
  assert.equal(text.slice(0, 4), 'RIFF');
  assert.equal(text.slice(8, 12), 'WAVE');
  assert.equal(wav.length, 44 + 6);
});

test('resample keeps at most sixty seconds', () => {
  const samples = new Float32Array(16000 * 70);
  samples[0] = 0.25;
  const out = resampleMono(samples, 16000, 16000, 60);
  assert.equal(out.length, 16000 * 60);
  assert.equal(out[0], 0.25);
  const mixed = mixToMono({
    length: 2,
    numberOfChannels: 2,
    getChannelData(channel) {
      return channel === 0 ? Float32Array.of(1, 1) : Float32Array.of(1, -1);
    },
  });
  assert.equal(mixed[0], 1);
  assert.equal(mixed[1], 0);
});
