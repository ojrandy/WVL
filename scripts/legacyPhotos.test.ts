// Tests for the read-only legacy photo filter (update.md C.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyPhotoUrls, isSafePhotoUrl } from '../src/shared/legacyPhotos.ts';

test('legacyPhotoUrls keeps http(s), site-relative and data:image/ values, trimmed, in order', () => {
  assert.deepEqual(legacyPhotoUrls([
    'https://example.com/a.jpg',
    ' http://example.com/b.png ',
    '/images/c.webp',
    'data:image/jpeg;base64,AAAA',
  ]), [
    'https://example.com/a.jpg',
    'http://example.com/b.png',
    '/images/c.webp',
    'data:image/jpeg;base64,AAAA',
  ]);
});

test('legacyPhotoUrls drops unsafe or meaningless values', () => {
  assert.deepEqual(legacyPhotoUrls([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<b>x</b>',
    'vbscript:x',
    'ftp://example.com/a.jpg',
    '//evil.example/a.jpg',
    '/\\evil.example/a.jpg',
    'photo.jpg',
    '',
    '   ',
    42,
    null,
    { url: 'https://example.com/a.jpg' },
  ]), []);
});

test('legacyPhotoUrls accepts only arrays', () => {
  for (const input of [undefined, null, 'https://example.com/a.jpg', {}, 3]) {
    assert.deepEqual(legacyPhotoUrls(input), []);
  }
});

test('isSafePhotoUrl', () => {
  assert.equal(isSafePhotoUrl('https://example.com/x.jpg'), true);
  assert.equal(isSafePhotoUrl('DATA:image/png;base64,AA'), true);
  assert.equal(isSafePhotoUrl('data:image/svg+xml,<svg/>'), true);
  assert.equal(isSafePhotoUrl('data:,hello'), false);
});
