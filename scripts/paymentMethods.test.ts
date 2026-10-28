// Tests for the payment method registry and validators (update.md D.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_TYPES,
  customerMethodView,
  getPaymentMethod,
  validatePaymentDetails,
} from '../src/shared/paymentMethods.ts';
import {
  validateAccountNumber,
  validateCashtag,
  validateCryptoAddress,
  validateEmail,
  validateHandle,
  validateHttpsUrl,
  validateIban,
  validatePhone,
  validateRoutingNumber,
  validateSortCode,
  validateSwift,
  validateText,
} from '../src/shared/paymentValidation.ts';

const value = (r: { ok: boolean; value?: string }) => (r.ok ? r.value : null);

test('registry: 17 types from update.md §4, keys match, no gift cards', () => {
  assert.equal(PAYMENT_METHOD_TYPES.length, 17);
  for (const type of PAYMENT_METHOD_TYPES) {
    const method = PAYMENT_METHODS[type];
    assert.equal(method.type, type);
    assert.ok(method.label && method.iconKey && method.fields.length);
    const names = method.fields.map((f) => f.name);
    assert.equal(new Set(names).size, names.length, `${type}: duplicate field`);
    for (const group of method.eitherOr ?? []) {
      for (const name of group) {
        const field = method.fields.find((f) => f.name === name);
        assert.ok(field, `${type}: either/or names unknown field ${name}`);
        assert.equal(field!.required, false, `${type}: either/or field ${name} must be optional`);
      }
    }
  }
  assert.equal(Object.keys(PAYMENT_METHODS).length, 17);
  assert.ok(!PAYMENT_METHOD_TYPES.some((t) => /gift/i.test(t)));
  assert.equal(getPaymentMethod('gift_card'), null);
  assert.equal(getPaymentMethod('__proto__'), null);
});

test('text, email, url', () => {
  assert.equal(value(validateText('  Jane   Doe ')), 'Jane Doe');
  assert.equal(validateText('a\nb').ok, false);
  assert.equal(validateText('x'.repeat(121)).ok, false);
  assert.equal(validateText('x'.repeat(200), 200).ok, true);

  assert.equal(value(validateEmail(' pay@example.com ')), 'pay@example.com');
  for (const bad of ['pay@', 'pay@example', 'pay example@x.com', '@example.com', 'a@b.c', 'a@b..com']) {
    assert.equal(validateEmail(bad).ok, false, bad);
  }

  assert.equal(value(validateHttpsUrl('https://paypal.me/jane', ['paypal.me', 'paypal.com'])), 'https://paypal.me/jane');
  assert.equal(validateHttpsUrl('https://www.paypal.com/paypalme/jane', ['paypal.me', 'paypal.com']).ok, true);
  assert.equal(validateHttpsUrl('https://paypal.me.evil.com/x', ['paypal.me']).ok, false);
  assert.equal(validateHttpsUrl('https://evilpaypal.me/x', ['paypal.me']).ok, false);
  for (const bad of ['http://paypal.me/x', 'javascript:alert(1)', 'paypal.me/x', 'https://localhost/x', 'https://u:p@pay.example.com/']) {
    assert.equal(validateHttpsUrl(bad).ok, false, bad);
  }
});

test('phone', () => {
  assert.equal(value(validatePhone('+44 20 7946 0958')), '+44 20 7946 0958');
  assert.equal(value(validatePhone('(212) 555-0100', 'US')), '+1 212 555 0100');
  assert.equal(validatePhone('+44 20 7946 0958', 'US').ok, false);
  assert.equal(validatePhone('12', undefined).ok, false);
  assert.equal(validatePhone('call me', undefined).ok, false);
});

test('IBAN mod-97, sort code, routing checksum, SWIFT', () => {
  assert.equal(value(validateIban('gb82 west 1234 5698 7654 32')), 'GB82WEST12345698765432');
  assert.equal(value(validateIban('DE89370400440532013000')), 'DE89370400440532013000');
  assert.equal(validateIban('GB82WEST12345698765433').ok, false);
  assert.equal(validateIban('GB82').ok, false);

  assert.equal(value(validateSortCode('123456')), '12-34-56');
  assert.equal(value(validateSortCode('12 34 56')), '12-34-56');
  assert.equal(validateSortCode('12-34-5').ok, false);

  assert.equal(value(validateRoutingNumber('021000021')), '021000021');
  assert.equal(value(validateRoutingNumber('011000015')), '011000015');
  assert.equal(validateRoutingNumber('021000022').ok, false);
  assert.equal(validateRoutingNumber('02100002').ok, false);

  assert.equal(value(validateSwift('deutdeff')), 'DEUTDEFF');
  assert.equal(value(validateSwift('NWBK GB2L XXX')), 'NWBKGB2LXXX');
  assert.equal(validateSwift('DEUTDEF').ok, false);
  assert.equal(validateSwift('1EUTDEFF').ok, false);
});

test('cashtag, handle, account number', () => {
  assert.equal(value(validateCashtag('jane_doe')), '$jane_doe');
  assert.equal(value(validateCashtag('$Jane1')), '$Jane1');
  assert.equal(validateCashtag('$12345').ok, false);
  assert.equal(validateCashtag('$a-b').ok, false);

  assert.equal(value(validateHandle('jane.doe')), '@jane.doe');
  assert.equal(value(validateHandle('@Jane-Doe_1')), '@Jane-Doe_1');
  assert.equal(validateHandle('@a').ok, false);
  assert.equal(validateHandle('@-jane').ok, false);

  assert.equal(value(validateAccountNumber('1234 5678', 8, 8)), '12345678');
  assert.equal(validateAccountNumber('1234567', 8, 8).ok, false);
  assert.equal(validateAccountNumber('12AB5678', 8, 8).ok, false);
  assert.deepEqual(validateAccountNumber('1', 4, 17), { ok: false, error: 'Enter 4 to 17 digits.' });
});

test('crypto addresses by coin and network', () => {
  const good: [Parameters<typeof validateCryptoAddress>[0], string, string][] = [
    ['BTC', 'bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    ['BTC', 'bitcoin', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
    ['BTC', 'bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ['BTC', 'bitcoin', 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'],
    ['BTC', 'lightning', 'jane@walletofsatoshi.com'],
    ['ETH', 'ethereum', '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe'],
    ['ETH', 'base', '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe'],
    ['USDT', 'TRC20', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
    ['USDT', 'BEP20', '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe'],
    ['USDT', 'SOLANA', '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T'],
  ];
  for (const [coin, network, address] of good) {
    assert.equal(validateCryptoAddress(coin, network, address).ok, true, `${coin} ${network} ${address}`);
  }
  assert.equal(value(validateCryptoAddress('BTC', 'bitcoin', 'BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ')),
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');

  const bad: [Parameters<typeof validateCryptoAddress>[0], string, string][] = [
    ['BTC', 'bitcoin', '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe'],
    ['BTC', 'bitcoin', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5md'],
    ['BTC', 'bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN0'],
    ['BTC', 'lightning', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    ['ETH', 'ethereum', '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BA'],
    ['USDT', 'TRC20', '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe'],
    ['USDT', 'ERC20', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
    ['USDT', 'NOPE', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
  ];
  for (const [coin, network, address] of bad) {
    assert.equal(validateCryptoAddress(coin, network, address).ok, false, `${coin} ${network} ${address}`);
  }
  assert.deepEqual(validateCryptoAddress('USDT', 'TRC20', 'nope', 'Tron (TRC20)'),
    { ok: false, error: 'Enter a valid USDT address for Tron (TRC20).' });
});

test('validatePaymentDetails: required fields, either/or, unknown keys dropped, normalised', () => {
  assert.deepEqual(validatePaymentDetails('gift_card', {}), { ok: false, errors: { type: 'Unknown payment method.' } });

  assert.deepEqual(validatePaymentDetails('paypal', { accountName: 'Jane' }), {
    ok: false, errors: { email: 'Enter PayPal email or PayPal.me link.' },
  });
  assert.deepEqual(validatePaymentDetails('paypal', { email: ' pay@example.com ', extra: 'x', link: '  ' }), {
    ok: true, details: { email: 'pay@example.com' },
  });

  const uk = validatePaymentDetails('uk_bank', { accountName: 'Jane Doe', bankName: 'Barclays', sortCode: '200000', accountNumber: '5566 7788' });
  assert.deepEqual(uk, { ok: true, details: { accountName: 'Jane Doe', bankName: 'Barclays', sortCode: '20-00-00', accountNumber: '55667788' } });

  const missing = validatePaymentDetails('us_bank', { accountName: 'Jane', routingNumber: '021000022', accountType: 'gold' });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.errors.bankName, 'Bank name is required.');
    assert.equal(missing.errors.accountNumber, 'Account number is required.');
    assert.equal(missing.errors.routingNumber, 'Enter a valid 9-digit US routing number.');
    assert.equal(missing.errors.accountType, 'Choose an option.');
  }

  const wire = validatePaymentDetails('intl_wire', { beneficiary: 'WVL', bankName: 'Bank', swift: 'DEUTDEFF', country: 'Germany' });
  assert.equal(wire.ok, false);
  if (!wire.ok) assert.equal(wire.errors.iban, 'Enter IBAN or Account number.');

  // Non-object input and non-string values are treated as empty.
  assert.equal(validatePaymentDetails('card_link', null).ok, false);
  assert.equal(validatePaymentDetails('card_link', { url: 42 }).ok, false);
  assert.equal(validatePaymentDetails('card_link', ['https://pay.example.com']).ok, false);
});

test('validatePaymentDetails: crypto address checked against the chosen network', () => {
  assert.deepEqual(validatePaymentDetails('usdt', { network: 'TRC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }), {
    ok: true, details: { network: 'TRC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
  });
  const wrong = validatePaymentDetails('usdt', { network: 'ERC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' });
  assert.deepEqual(wrong, { ok: false, errors: { address: 'Enter a valid USDT address for Ethereum (ERC20).' } });
  const noNetwork = validatePaymentDetails('bitcoin', { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' });
  assert.deepEqual(noNetwork, { ok: false, errors: { network: 'Network is required.' } });
});

test('validatePaymentDetails: Zelle phone must be a US number', () => {
  assert.equal(validatePaymentDetails('zelle', { phone: '+44 20 7946 0958', recipientName: 'Jane' }).ok, false);
  assert.deepEqual(validatePaymentDetails('zelle', { phone: '2125550100', recipientName: 'Jane' }), {
    ok: true, details: { phone: '+1 212 555 0100', recipientName: 'Jane' },
  });
});

test('customerMethodView: fields in registry order, option labels, IBAN grouped, link/QR/warning/note', () => {
  const wire = customerMethodView({
    id: 'a1', type: 'intl_wire', label: '  ', instructions: ' Use the tracking ID as reference. ',
    details: { country: 'Germany', swift: 'DEUTDEFF', iban: 'DE89370400440532013000', bankName: 'Deutsche Bank', beneficiary: 'WVL', secret: 'x' },
  });
  assert.ok(wire);
  assert.equal(wire!.title, 'International wire (SWIFT / IBAN)');
  assert.deepEqual(wire!.fields.map((f) => f.name), ['beneficiary', 'bankName', 'iban', 'swift', 'country']);
  const iban = wire!.fields.find((f) => f.name === 'iban')!;
  assert.equal(iban.value, 'DE89 3704 0044 0532 0130 00');
  assert.equal(iban.copyValue, 'DE89370400440532013000');
  assert.equal(wire!.instructions, 'Use the tracking ID as reference.');
  assert.equal(wire!.link, null);
  assert.equal(wire!.qr, null);

  const usdt = customerMethodView({ id: 'a2', type: 'usdt', label: 'Tether wallet', details: { network: 'TRC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' } });
  assert.equal(usdt!.title, 'Tether wallet');
  assert.equal(usdt!.methodLabel, 'USDT (Tether)');
  assert.deepEqual(usdt!.fields[0], { name: 'network', label: 'Network', value: 'Tron (TRC20)', copyValue: 'TRC20', copyable: false });
  assert.equal(usdt!.qr, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  assert.equal(usdt!.warning, 'Send only USDT on the Tron (TRC20) network. Funds sent on another network can be lost.');

  const cash = customerMethodView({ id: 'a3', type: 'cashapp', details: { cashtag: '$jane' } });
  assert.deepEqual(cash!.link, { url: 'https://cash.app/$jane', label: 'Open Cash App' });
  assert.equal(cash!.qr, 'https://cash.app/$jane');

  const venmo = customerMethodView({ id: 'a4', type: 'venmo', details: { username: '@jane-doe' } });
  assert.deepEqual(venmo!.link, { url: 'https://venmo.com/u/jane-doe', label: 'Open Venmo' });

  const wu = customerMethodView({ id: 'a5', type: 'western_union', details: { receiverName: 'Jane', country: 'US', city: 'Austin' } });
  assert.match(wu!.note!, /MTCN/);
  assert.equal(wu!.warning, null);
});

test('customerMethodView: unknown types give null; a hand-edited unsafe link is not shown', () => {
  assert.equal(customerMethodView({ id: 'x', type: 'gift_card', details: {} }), null);
  const card = customerMethodView({ id: 'y', type: 'card_link', details: { url: 'javascript:alert(1)' } });
  assert.equal(card!.link, null);
});

test('every type: valid sample details round-trip into a customer view', () => {
  const samples: Record<string, Record<string, string>> = {
    paypal: { link: 'https://paypal.me/jane' },
    bitcoin: { network: 'bitcoin', address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
    usdt: { network: 'ERC20', address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe' },
    ethereum: { network: 'ethereum', address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe' },
    zelle: { email: 'pay@example.com', recipientName: 'Jane' },
    cashapp: { cashtag: 'jane' },
    venmo: { username: 'jane' },
    applepay: { email: 'pay@example.com' },
    googlepay: { phone: '+1 212 555 0100' },
    us_bank: { accountName: 'Jane', bankName: 'Chase', routingNumber: '021000021', accountNumber: '123456789', accountType: 'checking' },
    uk_bank: { accountName: 'Jane', bankName: 'Barclays', sortCode: '20-00-00', accountNumber: '55667788' },
    intl_wire: { beneficiary: 'Jane', bankName: 'Bank', accountNumber: '12345678', swift: 'DEUTDEFF', country: 'Germany' },
    wise: { wisetag: '@jane' },
    revolut: { revtag: 'jane' },
    card_link: { url: 'https://checkout.example.com/pay/abc' },
    western_union: { receiverName: 'Jane', country: 'United States', city: 'Austin' },
    moneygram: { receiverName: 'Jane', country: 'United States', city: 'Austin' },
  };
  assert.deepEqual(Object.keys(samples).sort(), [...PAYMENT_METHOD_TYPES].sort());
  for (const type of PAYMENT_METHOD_TYPES) {
    const result = validatePaymentDetails(type, samples[type]);
    assert.equal(result.ok, true, `${type}: ${JSON.stringify(result)}`);
    if (!result.ok) continue;
    const view = customerMethodView({ id: type, type, details: result.details });
    assert.ok(view && view.fields.length > 0, type);
  }
});
