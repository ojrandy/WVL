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
import { formatPaymentAmount, isPaymentVisibleToCustomer, nextPaymentStatus, publicPaymentView, validatePaymentRequest } from '../src/shared/paymentRequest.ts';

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

const paypal = { type: 'paypal', details: { email: 'pay@example.com', name: 'WVL Billing' } };
const btc = { type: 'bitcoin', details: { network: 'bitcoin', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' } };
const base = { amount: 120, currency: 'USD', chargeReason: 'Customs duty – Invoice WVL-INV-104233', methods: [paypal, btc] };
let counter = 0;
const newId = () => `new-${++counter}`;

test('validatePaymentRequest: accepts the §1 example and normalises it', () => {
  const r = validatePaymentRequest({ ...base, amount: '120.00', dueDate: '', customerNote: '  Pay  by Friday \r\n\r\n\r\n please ', invoiceDocumentId: '' }, { newId });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.equal(r.value.amount, 120);
  assert.equal(r.value.currency, 'USD');
  assert.equal(r.value.dueDate, null);
  assert.equal(r.value.invoiceDocumentId, null);
  assert.equal(r.value.customerNote, 'Pay by Friday\n\nplease');
  assert.deepEqual(r.value.methods.map((m) => m.type), ['paypal', 'bitcoin']);
  assert.ok(r.value.methods.every((m) => m.id.startsWith('new-')));
});

test('validatePaymentRequest: amount rules follow the currency', () => {
  const amountError = (amount: unknown, currency = 'USD') => {
    const r = validatePaymentRequest({ ...base, amount, currency });
    return r.ok ? null : r.errors.amount ?? null;
  };
  assert.equal(amountError(0), 'Enter an amount greater than 0.');
  assert.equal(amountError(-5), 'Enter an amount greater than 0.');
  assert.equal(amountError('-5'), 'Enter an amount greater than 0.');
  assert.equal(amountError(''), 'Enter the amount.');
  assert.equal(amountError('   '), 'Enter the amount.');
  assert.equal(amountError(undefined), 'Enter the amount.');
  for (const bad of ['12abc', '1e3', '1,200', '$120', 'Infinity', NaN, Infinity, {}]) {
    assert.equal(amountError(bad), 'Enter the amount as a number, e.g. 120.00.', String(bad));
  }
  assert.equal(amountError(' 120.50 '), null);
  assert.equal(amountError(1e13), 'Enter a smaller amount.');
  assert.equal(amountError(120.555), 'Use at most 2 decimals for USD.');
  assert.equal(amountError(12000.5, 'JPY'), "JPY amounts can't have decimals.");
  assert.equal(amountError(36.1255, 'KWD'), 'Use at most 3 decimals for KWD.');
  assert.equal(amountError(36.125, 'KWD'), null);
  assert.equal(amountError(1_000_000_000), null);
  const r = validatePaymentRequest({ ...base, currency: 'NGN' });
  assert.ok(!r.ok && r.errors.currency === 'Choose a currency.');
});

test('validatePaymentRequest: reason, due date, note, invoice id', () => {
  const errs = (patch: object) => { const r = validatePaymentRequest({ ...base, ...patch }); return r.ok ? {} : r.errors; };
  assert.ok(errs({ chargeReason: 'ab' }).chargeReason);
  assert.ok(errs({ chargeReason: undefined }).chargeReason);
  assert.ok(errs({ chargeReason: 'x'.repeat(201) }).chargeReason);
  assert.equal(errs({ chargeReason: 'x'.repeat(200) }).chargeReason, undefined);
  assert.ok(errs({ chargeReason: 'Duty\u0007fee' }).chargeReason);
  assert.equal(errs({ dueDate: '2026-11-30' }).dueDate, undefined);
  for (const dueDate of ['2026-02-30', '2026-13-01', '30/11/2026', '2026-11-30T00:00']) assert.ok(errs({ dueDate }).dueDate, dueDate);
  assert.ok(errs({ customerNote: 'x'.repeat(301) }).customerNote);
  assert.equal(errs({ customerNote: 'x'.repeat(300) }).customerNote, undefined);
  assert.ok(errs({ invoiceDocumentId: '../etc' }).invoiceDocumentId);
});

test('validatePaymentRequest: 1–10 accounts, each checked by the registry', () => {
  const errs = (methods: unknown) => { const r = validatePaymentRequest({ ...base, methods }); return r.ok ? {} : r.errors; };
  assert.equal(errs([]).methods, 'Add at least one payment method.');
  assert.equal(errs(undefined).methods, 'Add at least one payment method.');
  assert.equal(errs(Array(11).fill(paypal)).methods, 'Add at most 10 payment methods.');
  assert.deepEqual(errs(Array(10).fill(paypal)), {});
  assert.equal(errs([paypal, { type: 'giftcard', details: {} }])['methods.1.type'], 'Unknown payment method.');
  assert.ok(errs([{ type: 'paypal', details: {} }])['methods.0.email']);
  assert.ok(errs([{ ...btc, details: { network: 'bitcoin', address: 'not-an-address' } }])['methods.0.address']);
  assert.ok(errs([{ ...paypal, label: 'x'.repeat(61) }])['methods.0.label']);
  assert.ok(errs([{ ...paypal, instructions: 'x'.repeat(501) }])['methods.0.instructions']);
});

test('validatePaymentRequest: account ids are stable, duplicates and bad ids replaced, extra keys dropped', () => {
  const r = validatePaymentRequest({
    ...base,
    methods: [
      { ...paypal, id: 'keep-me', label: ' Business ', instructions: 'Add the tracking ID\nas the note', extra: 'x' },
      { ...btc, id: 'keep-me' },
      { ...btc, id: '<script>' },
      { ...paypal, details: { ...paypal.details, injected: 'x' } },
    ],
  }, { newId });
  assert.ok(r.ok);
  const [a, b, c, d] = r.value.methods;
  assert.equal(a.id, 'keep-me');
  assert.equal(a.label, 'Business');
  assert.equal(a.instructions, 'Add the tracking ID\nas the note');
  assert.equal((a as any).extra, undefined);
  assert.notEqual(b.id, 'keep-me');
  assert.notEqual(c.id, '<script>');
  assert.equal(d.label, null);
  assert.equal(d.details.injected, undefined);
});

test('publicPaymentView: only the given accounts, in order, no invoice id; paidAt only when PAID', () => {
  const r = validatePaymentRequest({ ...base, invoiceDocumentId: 'doc-secret-77' }, { newId });
  assert.ok(r.ok);
  const stored = { ...r.value, status: 'AWAITING_PAYMENT', paidAt: '2026-10-28T10:00:00Z' };
  const view = publicPaymentView({ ...stored, methods: [...stored.methods, { id: 'x', type: 'giftcard', details: {} }] });
  assert.deepEqual(Object.keys(view).sort(),
    ['amount', 'chargeReason', 'currency', 'customerNote', 'dueDate', 'methods', 'paidAt', 'proof', 'status']);
  assert.equal(view.proof, null);
  assert.deepEqual(view.methods.map((m) => m.type), ['paypal', 'bitcoin']);
  assert.equal(view.paidAt, null);
  assert.ok(!JSON.stringify(view).includes('doc-secret-77'));
  assert.equal(publicPaymentView({ ...stored, status: 'PAID' }).paidAt, '2026-10-28T10:00:00Z');
});

test('publicPaymentView: latest proof status and time; the reason only when rejected', () => {
  const r = validatePaymentRequest(base, { newId });
  assert.ok(r.ok);
  const stored = { ...r.value, status: 'UNDER_REVIEW', paidAt: null };
  const at = '2026-10-28T10:00:00.000Z';
  assert.deepEqual(publicPaymentView({ ...stored, latestProof: { status: 'SUBMITTED', createdAt: at, adminNote: 'internal' } }).proof,
    { status: 'SUBMITTED', submittedAt: at, reason: null });
  assert.deepEqual(publicPaymentView({ ...stored, status: 'AWAITING_PAYMENT', latestProof: { status: 'REJECTED', createdAt: at, adminNote: 'Amount does not match.' } }).proof,
    { status: 'REJECTED', submittedAt: at, reason: 'Amount does not match.' });
  assert.equal(publicPaymentView({ ...stored, status: 'PAID', latestProof: { status: 'APPROVED', createdAt: at, adminNote: 'x' } }).proof?.reason, null);
  assert.equal(publicPaymentView({ ...stored, status: 'CANCELLED', latestProof: { status: 'SUBMITTED', createdAt: at, adminNote: null } }).proof, null);
  assert.equal(publicPaymentView({ ...stored, latestProof: { status: 'BOGUS', createdAt: at, adminNote: null } }).proof, null);
});

test('formatPaymentAmount: code plus the currency\'s own decimals', () => {
  const plain = (s: string) => s.replace(/ /g, ' ');
  assert.equal(plain(formatPaymentAmount(120, 'USD')), 'USD 120.00');
  assert.equal(plain(formatPaymentAmount(120, 'CHF')), 'CHF 120.00');
  assert.equal(plain(formatPaymentAmount(12000, 'JPY')), 'JPY 12,000');
  assert.equal(plain(formatPaymentAmount(36.5, 'KWD')), 'KWD 36.500');
  assert.equal(plain(formatPaymentAmount(1_000_000_000, 'EUR')), 'EUR 1,000,000,000.00');
});

test('nextPaymentStatus: open requests cancel or get paid, closed ones reopen, nothing else', () => {
  assert.equal(nextPaymentStatus('AWAITING_PAYMENT', 'cancel'), 'CANCELLED');
  assert.equal(nextPaymentStatus('UNDER_REVIEW', 'cancel'), 'CANCELLED');
  assert.equal(nextPaymentStatus('AWAITING_PAYMENT', 'mark_paid'), 'PAID');
  assert.equal(nextPaymentStatus('UNDER_REVIEW', 'mark_paid'), 'PAID');
  assert.equal(nextPaymentStatus('PAID', 'reopen'), 'AWAITING_PAYMENT');
  assert.equal(nextPaymentStatus('CANCELLED', 'reopen'), 'AWAITING_PAYMENT');
  for (const [from, action] of [['PAID', 'cancel'], ['PAID', 'mark_paid'], ['CANCELLED', 'cancel'], ['CANCELLED', 'mark_paid'],
    ['AWAITING_PAYMENT', 'reopen'], ['UNDER_REVIEW', 'reopen'], ['AWAITING_PAYMENT', 'delete'], ['BOGUS', 'cancel']]) {
    assert.equal(nextPaymentStatus(from, action), null, `${from} ${action}`);
  }
});

test('publicPaymentView: a cancelled request carries no accounts', () => {
  const r = validatePaymentRequest(base, { newId });
  assert.ok(r.ok);
  const view = publicPaymentView({ ...r.value, status: 'CANCELLED', paidAt: null });
  assert.equal(view.status, 'CANCELLED');
  assert.deepEqual(view.methods, []);
});

test('validatePaymentRequest keepIds: only ids already saved survive, the rest are minted (D-13)', () => {
  const r = validatePaymentRequest({
    ...base,
    methods: [{ ...paypal, id: 'saved-1' }, { ...btc, id: 'client-chosen' }, { ...paypal }],
  }, { newId, keepIds: new Set(['saved-1']) });
  assert.ok(r.ok);
  assert.equal(r.value.methods[0].id, 'saved-1');
  assert.notEqual(r.value.methods[1].id, 'client-chosen');
  assert.ok(r.value.methods[1].id.startsWith('new-'));
  assert.ok(r.value.methods[2].id.startsWith('new-'));
  // A first save (nothing stored yet) mints every id.
  const first = validatePaymentRequest({ ...base, methods: [{ ...paypal, id: 'acc-123' }] }, { newId, keepIds: new Set() });
  assert.ok(first.ok && first.value.methods[0].id !== 'acc-123');
});

test('isPaymentVisibleToCustomer: cancelled and unknown statuses are hidden (D-12)', () => {
  for (const s of ['AWAITING_PAYMENT', 'UNDER_REVIEW', 'PAID']) assert.equal(isPaymentVisibleToCustomer(s), true, s);
  for (const s of ['CANCELLED', '', 'BOGUS']) assert.equal(isPaymentVisibleToCustomer(s), false, s);
});
