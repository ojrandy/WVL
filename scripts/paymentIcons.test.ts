// Tests that the generated payment icon module matches the SVGs and the registry (update.md D.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_COLOURS, ICON_DIR, renderIconModule } from './payment-icons.mjs';
import { PAYMENT_BRAND_ICONS } from '../src/assets/payment-icons/index.ts';
import { PAYMENT_METHODS } from '../src/shared/paymentMethods.ts';

const GENERIC_ICON_KEYS = ['landmark', 'globe', 'credit-card'];

test('index.ts is up to date with the SVGs (run `node scripts/payment-icons.mjs`)', () => {
  const onDisk = readFileSync(join(ICON_DIR, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(onDisk, renderIconModule());
});

test('every brand icon has a path and its §4 colour', () => {
  assert.deepEqual(Object.keys(PAYMENT_BRAND_ICONS).sort(), Object.keys(ICON_COLOURS).sort());
  for (const [slug, icon] of Object.entries(PAYMENT_BRAND_ICONS)) {
    assert.match(icon.path, /^M[\d\s.,MmLlHhVvCcSsQqTtAaZz-]+$/, slug);
    assert.equal(icon.color, (ICON_COLOURS as Record<string, string>)[slug]);
  }
});

test('every registry iconKey is a brand icon or a generic lucide key', () => {
  for (const method of Object.values(PAYMENT_METHODS)) {
    assert.ok(method.iconKey in PAYMENT_BRAND_ICONS || GENERIC_ICON_KEYS.includes(method.iconKey), `${method.type}: ${method.iconKey}`);
  }
});
