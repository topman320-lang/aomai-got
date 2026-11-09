import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('iOS Info.plist has camera, microphone, and photo library purpose strings', () => {
  const plist = fs.readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
  assert.match(plist, /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]+<\/string>/);
  assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]+<\/string>/);
  assert.match(plist, /<key>NSPhotoLibraryUsageDescription<\/key>\s*<string>[^<]+<\/string>/);
  assert.match(plist, /拍照/);
  assert.match(plist, /麥克風/);
  assert.match(plist, /相簿/);
});
