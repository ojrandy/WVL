// Tests for the admin-path matcher (update.md §3, Phase A).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_PATH, isAdminPathname } from '../src/config/brand.ts';

test('ADMIN_PATH is a slash-wrapped single segment', () => {
  assert.equal(ADMIN_PATH, '/private-user/');
});

test('isAdminPathname: the path itself and anything under it', () => {
  assert.equal(isAdminPathname('/private-user'), true);
  assert.equal(isAdminPathname('/private-user/'), true);
  assert.equal(isAdminPathname('/private-user/anything'), true);
});

test('isAdminPathname: look-alikes and public paths are not admin', () => {
  for (const p of ['/', '', '/private-userx', '/private-userx/', '/Private-User/', '/PRIVATE-USER',
    '/private', '/admin', '/x/private-user/', '//private-user/']) {
    assert.equal(isAdminPathname(p), false, p);
  }
});
