/** Focal crop for a listing photo inside an object-fit: cover frame.
 * x and y are object-position percentages. z is extra zoom on top of cover.
 * A missing frame, or 50% / 50% at zoom 1, is the centered cover the site already uses. */

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function roundTo(n, places) {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

export function normalizePhotoFrame(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const zRaw = raw.z == null || raw.z === '' ? 1 : Number(raw.z);
  if (!Number.isFinite(zRaw)) return null;
  const frame = {
    x: roundTo(clamp(x, 0, 100), 1),
    y: roundTo(clamp(y, 0, 100), 1),
    z: roundTo(clamp(zRaw, MIN_ZOOM, MAX_ZOOM), 2),
  };
  if (frame.x === 50 && frame.y === 50 && frame.z === 1) return null;
  return frame;
}

export function concreteFrame(frame) {
  return normalizePhotoFrame(frame) || { x: 50, y: 50, z: 1 };
}

/** CSS declarations for a cropped <img>. Empty means the centered cover default. */
export function photoFrameCss(frame) {
  const custom = normalizePhotoFrame(frame);
  if (!custom) return { objectPosition: '', transform: '', transformOrigin: '' };
  const origin = `${custom.x}% ${custom.y}%`;
  return {
    objectPosition: origin,
    transform: custom.z > 1 ? `scale(${custom.z})` : '',
    transformOrigin: custom.z > 1 ? origin : '',
  };
}

export function photoFrameStyle(frame) {
  const css = photoFrameCss(frame);
  return [
    css.objectPosition ? `object-position:${css.objectPosition}` : '',
    css.transform ? `transform:${css.transform}` : '',
    css.transformOrigin ? `transform-origin:${css.transformOrigin}` : '',
  ]
    .filter(Boolean)
    .join(';');
}

/** How much of a cover-cropped image sticks out of the frame, in pixels. */
export function coverBox(frameW, frameH, imageW, imageH, zoom = 1) {
  const fw = Number(frameW);
  const fh = Number(frameH);
  const iw = Number(imageW);
  const ih = Number(imageH);
  const z = clamp(Number.isFinite(Number(zoom)) ? Number(zoom) : 1, MIN_ZOOM, MAX_ZOOM);
  if (![fw, fh, iw, ih].every((n) => Number.isFinite(n) && n > 0)) {
    return { overflowX: 0, overflowY: 0, usedW: 0, usedH: 0 };
  }
  const cover = Math.max(fw / iw, fh / ih);
  const usedW = iw * cover * z;
  const usedH = ih * cover * z;
  return {
    usedW,
    usedH,
    overflowX: Math.max(0, usedW - fw),
    overflowY: Math.max(0, usedH - fh),
  };
}

/** Move the visible area. dx/dy follow the finger, in frame pixels. */
export function shiftFrame(frame, dx, dy, box) {
  const f = concreteFrame(frame);
  const overflowX = Number(box?.overflowX) || 0;
  const overflowY = Number(box?.overflowY) || 0;
  let x = f.x;
  let y = f.y;
  if (overflowX > 0.5 && dx) x = f.x - (dx / overflowX) * 100;
  if (overflowY > 0.5 && dy) y = f.y - (dy / overflowY) * 100;
  return normalizePhotoFrame({ x, y, z: f.z });
}

export function zoomFrame(frame, factor) {
  const f = concreteFrame(frame);
  const next = Number(factor);
  if (!Number.isFinite(next) || next <= 0) return normalizePhotoFrame(f);
  return normalizePhotoFrame({ x: f.x, y: f.y, z: f.z * next });
}

/** Keep each frame with the photo it belongs to, skipping empty slots. */
export function listingShots(photos, frames) {
  const list = Array.isArray(photos) ? photos : [];
  const aligned = Array.isArray(frames) ? frames : [];
  const shots = [];
  list.forEach((src, i) => {
    if (!src) return;
    shots.push({ src: String(src), frame: normalizePhotoFrame(aligned[i]) });
  });
  return shots;
}

export function presentPhotoFrames(frames, count) {
  const n = Math.max(0, Number(count) || 0);
  const list = Array.isArray(frames) ? frames : [];
  return Array.from({ length: n }, (_, i) => normalizePhotoFrame(list[i]));
}
