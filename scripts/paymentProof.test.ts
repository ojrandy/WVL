// Tests for the proof-of-payment rules (update.md G.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_OPEN_PROOFS, PAYER_NAME_MAX, PROOF_REFERENCE_MAX, REJECT_REASON_MAX, cleanRejectReason, proofRefusal, validateProofFields } from '../src/shared/paymentProof.ts';

const ctx = { methodIds: ['acc-1', 'acc-2'], currency: 'USD' };
const good = { methodId: 'acc-2', payerName: '  Ada   Obi ', amountSent: '120.00', reference: ' TX 123 ' };

test('proof fields: a good proof is normalised', () => {
  const r = validateProofFields(good, ctx);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { methodId: 'acc-2', payerName: 'Ada Obi', amountSent: 120, reference: 'TX 123' });
  const noRef = validateProofFields({ ...good, reference: '   ', amountSent: 99.5 }, ctx);
  assert.ok(noRef.ok && noRef.value.reference === null && noRef.value.amountSent === 99.5);
});

test('proof fields: the account must be one of this request\'s', () => {
  for (const methodId of ['acc-3', '', undefined, 1]) {
    const r = validateProofFields({ ...good, methodId }, ctx);
    assert.ok(!r.ok && r.errors.methodId === 'Choose the payment method you used.');
  }
});

test('proof fields: payer name, amount and reference messages', () => {
  const missing = validateProofFields({ methodId: 'acc-1' }, ctx);
  assert.ok(!missing.ok);
  assert.equal(missing.errors.payerName, 'Enter the name on the payment.');
  assert.equal(missing.errors.amountSent, 'Enter the amount you sent.');
  assert.equal(missing.errors.reference, undefined);

  const long = validateProofFields({ ...good, payerName: 'a'.repeat(PAYER_NAME_MAX + 1), reference: 'r'.repeat(PROOF_REFERENCE_MAX + 1) }, ctx);
  assert.ok(!long.ok);
  assert.equal(long.errors.payerName, `Keep it under ${PAYER_NAME_MAX} characters.`);
  assert.equal(long.errors.reference, `Keep it under ${PROOF_REFERENCE_MAX} characters.`);

  for (const amountSent of ['0', '-5', '1e3', '12,000', '$120', 'abc', '120.555', 1e13]) {
    const r = validateProofFields({ ...good, amountSent }, ctx);
    assert.ok(!r.ok && r.errors.amountSent === 'Enter the amount as a number, e.g. 120.00.', String(amountSent));
  }
});

test('proof fields: decimals follow the request currency', () => {
  assert.ok(!validateProofFields({ ...good, amountSent: '12000.5' }, { ...ctx, currency: 'JPY' }).ok);
  assert.ok(validateProofFields({ ...good, amountSent: '12000' }, { ...ctx, currency: 'JPY' }).ok);
  assert.ok(validateProofFields({ ...good, amountSent: '36.500' }, { ...ctx, currency: 'KWD' }).ok);
});

test('proofRefusal: only while awaiting payment, fewer than the open cap', () => {
  assert.equal(proofRefusal('AWAITING_PAYMENT', 0), null);
  assert.equal(proofRefusal('AWAITING_PAYMENT', MAX_OPEN_PROOFS - 1), null);
  assert.equal(proofRefusal('AWAITING_PAYMENT', MAX_OPEN_PROOFS), 'TOO_MANY_OPEN');
  for (const status of ['UNDER_REVIEW', 'PAID', 'CANCELLED', null, undefined, '']) {
    assert.equal(proofRefusal(status, 0), 'NOT_ACCEPTING');
  }
});

test('cleanRejectReason: one line, 3–300 characters', () => {
  assert.equal(cleanRejectReason('  Wrong\n  amount  '), 'Wrong amount');
  assert.equal(cleanRejectReason('abc'), 'abc');
  assert.equal(cleanRejectReason('x'.repeat(REJECT_REASON_MAX)), 'x'.repeat(REJECT_REASON_MAX));
  for (const bad of ['', '  ab ', 'x'.repeat(REJECT_REASON_MAX + 1), undefined, null, 42]) assert.equal(cleanRejectReason(bad), null);
});
