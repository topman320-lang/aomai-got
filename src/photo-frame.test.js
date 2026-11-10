import assert from 'node:assert/strict';
import test from 'node:test';
import {
  concreteFrame,
  coverBox,
  listingShots,
  normalizePhotoFrame,
  photoFrameStyle,
  presentPhotoFrames,
  shiftFrame,
  zoomFrame,
} from './photo-frame.js';

test('a missing frame is the centered cover crop', () => {
  assert.equal(normalizePhotoFrame(null), null);
  assert.equal(normalizePhotoFrame(undefined), null);
  assert.equal(normalizePhotoFrame({ x: 50, y: 50, z: 1 }), null);
  assert.equal(normalizePhotoFrame({ x: '50', y: '50' }), null);
  assert.equal(photoFrameStyle(null), '');
  assert.equal(photoFrameStyle({ x: 50, y: 50, z: 1 }), '');
  assert.deepEqual(concreteFrame(null), { x: 50, y: 50, z: 1 });
});

test('a saved focal point becomes object-position, and zoom adds scale', () => {
  assert.equal(photoFrameStyle({ x: 0, y: 100, z: 1 }), 'object-position:0% 100%');
  assert.equal(
    photoFrameStyle({ x: 12.24, y: 80.04, z: 1.256 }),
    'object-position:12.2% 80%;transform:scale(1.26);transform-origin:12.2% 80%'
  );
  assert.deepEqual(normalizePhotoFrame({ x: -10, y: 140, z: 9, extra: 'nope' }), { x: 0, y: 100, z: 3 });
  assert.equal(normalizePhotoFrame({ x: 'left', y: 10 }), null);
  assert.equal(normalizePhotoFrame([]), null);
});

test('dragging follows the finger along the axis that cover actually crops', () => {
  const wide = coverBox(100, 100, 200, 100, 1);
  assert.ok(wide.overflowX > 40);
  assert.equal(wide.overflowY, 0);
  const panned = shiftFrame(null, 40, 30, wide);
  assert.ok(panned.x < 50);
  assert.equal(panned.y, 50);

  const tall = coverBox(100, 100, 100, 400, 1);
  assert.equal(tall.overflowX, 0);
  assert.ok(tall.overflowY > 40);
  const down = shiftFrame({ x: 20, y: 80, z: 1 }, 10, -20, tall);
  assert.equal(down.x, 20);
  assert.ok(down.y > 80);

  const centered = shiftFrame({ x: 80, y: 50, z: 1 }, 30, 0, { overflowX: 100, overflowY: 0 });
  assert.equal(centered, null);
  const edge = shiftFrame({ x: 5, y: 50, z: 1 }, 80, 0, { overflowX: 50, overflowY: 0 });
  assert.deepEqual(edge, { x: 0, y: 50, z: 1 });
  const stuck = shiftFrame({ x: 0, y: 100, z: 2 }, 30, -30, { overflowX: 40, overflowY: 40 });
  assert.equal(stuck.x, 0);
  assert.equal(stuck.y, 100);
  assert.equal(stuck.z, 2);
});

test('pinch zoom stays between cover and 3x and keeps the focal point', () => {
  assert.equal(zoomFrame(null, 1), null);
  assert.deepEqual(zoomFrame({ x: 10, y: 70, z: 1 }, 2), { x: 10, y: 70, z: 2 });
  assert.equal(zoomFrame({ x: 10, y: 70, z: 2 }, 0.4).z, 1);
  assert.equal(zoomFrame({ x: 50, y: 50, z: 2 }, 4).z, 3);
  const square = coverBox(80, 80, 80, 80, 1);
  assert.equal(square.overflowX, 0);
  assert.ok(coverBox(80, 80, 80, 80, 2).overflowX > 0);
});

test('frames stay with their photo when an empty slot is skipped', () => {
  const shots = listingShots(['/uploads/a.jpg', '', '/uploads/b.jpg'], [{ x: 10, y: 20, z: 1 }, { x: 1, y: 1, z: 2 }, null]);
  assert.deepEqual(shots, [
    { src: '/uploads/a.jpg', frame: { x: 10, y: 20, z: 1 } },
    { src: '/uploads/b.jpg', frame: null },
  ]);
  assert.deepEqual(presentPhotoFrames(undefined, 2), [null, null]);
  assert.deepEqual(presentPhotoFrames([{ x: 50, y: 50, z: 1 }, { x: 0, y: 0, z: 1.5 }], 2), [
    null,
    { x: 0, y: 0, z: 1.5 },
  ]);
});
