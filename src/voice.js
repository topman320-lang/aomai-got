/** Chat voice notes. Pure helpers so the composer and tests share one limit. */
export const MAX_VOICE_SECONDS = 60;
export const VOICE_SAMPLE_RATE = 16000;

const RECORDER_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mpeg',
];

export function formatVoiceDuration(seconds) {
  const n = Math.max(0, Math.min(MAX_VOICE_SECONDS * 2, Math.round(Number(seconds) || 0)));
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function preferredRecorderMime(isSupported) {
  if (typeof isSupported !== 'function') return '';
  return (
    RECORDER_MIMES.find((type) => {
      try {
        return Boolean(isSupported(type));
      } catch {
        return false;
      }
    }) || ''
  );
}

export function voiceErrorMessage(err) {
  const name = String(err?.name || '');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return '請允許使用麥克風才能錄音';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return '找不到麥克風';
  }
  return '無法開始錄音';
}

/** Only our stored uploads may become an <audio> src. Blob previews stay in memory. */
export function playableAudioSrc(value, apiBase = '') {
  const raw = String(value || '').trim();
  if (!raw || /^(blob:|data:|javascript:)/i.test(raw)) return '';
  let path = '';
  if (raw.startsWith('/uploads/')) path = raw.split('?')[0].split('#')[0];
  else {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (!url.pathname.startsWith('/uploads/')) return '';
      path = url.pathname;
    } catch {
      return '';
    }
  }
  if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(path)) return '';
  if (!/\.(webm|mp4|mp3|ogg|wav)$/i.test(path)) return '';
  const base = String(apiBase || '').replace(/\/$/, '');
  return `${base}${path}`;
}

export function mixToMono(audioBuffer) {
  const length = audioBuffer?.length || 0;
  const channels = audioBuffer?.numberOfChannels || 0;
  const out = new Float32Array(length);
  if (!length || !channels || typeof audioBuffer.getChannelData !== 'function') return out;
  const scale = 1 / channels;
  for (let c = 0; c < channels; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) out[i] += data[i] * scale;
  }
  return out;
}

export function resampleMono(samples, fromRate, toRate, maxSeconds = MAX_VOICE_SECONDS) {
  const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const srcRate = Number(fromRate) || toRate;
  const dstRate = Number(toRate) || VOICE_SAMPLE_RATE;
  const cap = Math.max(1, Math.floor(dstRate * maxSeconds));
  if (!input.length || srcRate <= 0 || dstRate <= 0) return new Float32Array(0);
  if (srcRate === dstRate) return input.subarray(0, Math.min(input.length, cap));
  const ratio = srcRate / dstRate;
  const n = Math.min(cap, Math.max(0, Math.round(input.length / ratio)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const start = Math.min(input.length - 1, Math.floor(i * ratio));
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    out[i] = sum / (end - start);
  }
  return out;
}

const KNOWN_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
]);

/** Container sniff for recordings whose FileReader type is empty or octet-stream. */
export function sniffAudioMime(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x41 &&
    b[10] === 0x56 &&
    b[11] === 0x45
  ) {
    return 'audio/wav';
  }
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'audio/mp4';
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return '';
}

/** Keep a known audio type. Otherwise relabel the data URL from the file header. */
export function coerceAudioDataUrl(dataUrl, bytes) {
  const raw = String(dataUrl || '');
  const header = /^data:([^,]*)/i.exec(raw);
  if (!header) return '';
  const mime = header[1].split(';')[0].trim().toLowerCase();
  if (KNOWN_AUDIO_MIMES.has(mime)) return raw;
  const sniffed = sniffAudioMime(bytes);
  if (!sniffed) return raw;
  const comma = raw.indexOf(',');
  if (comma < 0) return raw;
  return `data:${sniffed};base64${raw.slice(comma)}`;
}

/** 16-bit mono PCM WAV. Browsers that record WebM or MP4 can both play this. */
export function encodeVoiceWav(samples, sampleRate = VOICE_SAMPLE_RATE) {
  const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const rate = Math.max(1, sampleRate >>> 0);
  const dataLen = input.length * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataLen, true);
  let offset = 44;
  for (let i = 0; i < input.length; i += 1) {
    let sample = input[i];
    if (sample > 1) sample = 1;
    else if (sample < -1) sample = -1;
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}
