// Tests for payment request rules (update.md E.0, E.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PAYMENT_CURRENCY,
  DISPLAY_CURRENCIES,
  PAYMENT_CURRENCIES,
  fitsCurrencyDecimals,
  isPaymentCurrency,
} from '../src/shared/currency.ts';

test('currencies: the 12 from D-7, USD first and the default, separate from the display list', () => {
  assert.deepEqual(PAYMENT_CURRENCIES.map((c) => c.code),
    ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'JPY', 'SGD', 'HKD', 'AED', 'KWD']);
  assert.equal(DEFAULT_PAYMENT_CURRENCY, 'USD');
  assert.equal(PAYMENT_CURRENCIES[0].code, DEFAULT_PAYMENT_CURRENCY);
  assert.ok(isPaymentCurrency('KWD'));
  for (const code of ['NGN', 'usd', '', null, undefined, 1]) assert.equal(isPaymentCurrency(code), false);
  assert.deepEqual([...DISPLAY_CURRENCIES], ['USD', 'NGN', 'GBP', 'EUR']);
});

test('decimals: 0 for JPY, 3 for KWD, 2 for the rest', () => {
  assert.ok(fitsCurrencyDecimals(120, 'USD'));
  assert.ok(fitsCurrencyDecimals(120.5, 'USD'));
  assert.ok(fitsCurrencyDecimals(120.55, 'EUR'));
  assert.equal(fitsCurrencyDecimals(120.555, 'GBP'), false);
  assert.ok(fitsCurrencyDecimals(12000, 'JPY'));
  assert.equal(fitsCurrencyDecimals(12000.5, 'JPY'), false);
  assert.ok(fitsCurrencyDecimals(36.5, 'KWD'));
  assert.ok(fitsCurrencyDecimals(36.125, 'KWD'));
  assert.equal(fitsCurrencyDecimals(36.1255, 'KWD'), false);
  assert.ok(fitsCurrencyDecimals(1_000_000_000, 'USD'));
  assert.equal(fitsCurrencyDecimals(NaN, 'USD'), false);
  assert.equal(fitsCurrencyDecimals(Infinity, 'USD'), false);
});
