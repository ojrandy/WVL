// Payment method types (update.md §4): the single registry used by server validation, the admin
// editor and the track page. Adding a method later means adding one entry here.
// Names, labels, warnings and notes are the CONTENT.md §6.7 copy. Gift cards are not a method (D-1).

import {
  formatIban,
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
  type CryptoCoin,
  type ValidationResult,
} from './paymentValidation.js';

export type PaymentFieldKind =
  | 'text' | 'email' | 'url' | 'phone' | 'crypto' | 'iban' | 'sortCode' | 'routing' | 'swift' | 'cashtag' | 'handle'
  | 'accountNumber';

export interface PaymentFieldOption {
  value: string;
  label: string;
}

export interface PaymentField {
  name: string;
  label: string;
  required: boolean;
  kind: PaymentFieldKind;
  /** A fixed choice (network, account type); the value must be one of these. Shown by its label. */
  options?: readonly PaymentFieldOption[];
  /** The customer card shows a Copy button for this field. */
  copyable: boolean;
  placeholder?: string;
  /** text: maximum length (default 120). */
  maxLength?: number;
  /** url: allowed hosts (subdomains included). */
  hosts?: readonly string[];
  /** phone: accept numbers of this country only. */
  region?: 'US';
  /** accountNumber: allowed digit count. */
  digits?: readonly [number, number];
  /** crypto: the coin; the network comes from the method's `network` field. */
  coin?: CryptoCoin;
}

export interface PaymentLink {
  url: string;
  label: string;
}

export type PaymentDetails = Record<string, string>;

export const PAYMENT_METHOD_TYPES = [
  'paypal', 'bitcoin', 'usdt', 'ethereum', 'zelle', 'cashapp', 'venmo', 'applepay', 'googlepay', 'us_bank', 'uk_bank',
  'intl_wire', 'wise', 'revolut', 'card_link', 'western_union', 'moneygram',
] as const;
export type PaymentMethodType = typeof PAYMENT_METHOD_TYPES[number];

export interface PaymentMethodDefinition {
  type: PaymentMethodType;
  /** Method name shown next to the icon. */
  label: string;
  /** Simple Icons slug (src/assets/payment-icons) or a generic key: landmark, globe, credit-card. */
  iconKey: string;
  fields: readonly PaymentField[];
  /** Groups of field names where at least one must be filled in (PayPal email or link). */
  eitherOr?: readonly (readonly string[])[];
  /** The button on the customer card (Open PayPal, Pay by card…), from validated details. */
  link?: (details: PaymentDetails) => PaymentLink | null;
  /** What the QR code encodes, if the method has one. */
  qr?: (details: PaymentDetails) => string | null;
  /** A warning shown above the details (crypto network). */
  warning?: (details: PaymentDetails) => string | null;
  /** A fixed note for the customer (Western Union MTCN). */
  note?: string;
}

const NAME_FIELD: PaymentField = { name: 'name', label: 'Name', required: false, kind: 'text', copyable: true };

const BTC_NETWORKS = [
  { value: 'bitcoin', label: 'Bitcoin (on-chain)' },
  { value: 'lightning', label: 'Lightning' },
] as const;
const USDT_NETWORKS = [
  { value: 'TRC20', label: 'Tron (TRC20)' },
  { value: 'ERC20', label: 'Ethereum (ERC20)' },
  { value: 'BEP20', label: 'BNB Smart Chain (BEP20)' },
  { value: 'POLYGON', label: 'Polygon' },
  { value: 'SOLANA', label: 'Solana' },
] as const;
const ETH_NETWORKS = [
  { value: 'ethereum', label: 'Ethereum mainnet' },
  { value: 'arbitrum', label: 'Arbitrum One' },
  { value: 'optimism', label: 'OP Mainnet (Optimism)' },
  { value: 'base', label: 'Base' },
] as const;

function cryptoFields(coin: CryptoCoin, networks: readonly PaymentFieldOption[]): PaymentField[] {
  return [
    { name: 'network', label: 'Network', required: true, kind: 'text', options: networks, copyable: false },
    { name: 'address', label: 'Wallet address', required: true, kind: 'crypto', coin, copyable: true },
  ];
}

function networkWarning(coin: CryptoCoin, networks: readonly PaymentFieldOption[]) {
  return (details: PaymentDetails) => {
    const network = networks.find((n) => n.value === details.network);
    return network ? `Send only ${coin} on the ${network.label} network. Funds sent on another network can be lost.` : null;
  };
}

const linkTo = (label: string, url: (details: PaymentDetails) => string | null) =>
  (details: PaymentDetails): PaymentLink | null => {
    const href = url(details);
    return href ? { url: href, label } : null;
  };

const paypalLink = linkTo('Open PayPal', (d) => d.link || null);
const cashAppLink = linkTo('Open Cash App', (d) => (d.cashtag ? `https://cash.app/${d.cashtag}` : null));
const venmoLink = linkTo('Open Venmo', (d) =>
  d.username ? `https://venmo.com/u/${encodeURIComponent(d.username.replace(/^@/, ''))}` : null);
const cardLink = linkTo('Pay by card', (d) => d.url || null);

const RECEIVER_FIELDS: PaymentField[] = [
  { name: 'receiverName', label: 'Receiver full name', required: true, kind: 'text', copyable: true },
  { name: 'country', label: 'Receiver country', required: true, kind: 'text', maxLength: 60, copyable: true },
  { name: 'city', label: 'Receiver city', required: true, kind: 'text', maxLength: 80, copyable: true },
];

export const PAYMENT_METHODS: Record<PaymentMethodType, PaymentMethodDefinition> = {
  paypal: {
    type: 'paypal',
    label: 'PayPal',
    iconKey: 'paypal',
    fields: [
      { name: 'email', label: 'PayPal email', required: false, kind: 'email', copyable: true },
      { name: 'link', label: 'PayPal.me link', required: false, kind: 'url', hosts: ['paypal.me', 'paypal.com'], copyable: true, placeholder: 'https://paypal.me/yourname' },
      { name: 'accountName', label: 'Account name', required: false, kind: 'text', copyable: true },
    ],
    eitherOr: [['email', 'link']],
    link: paypalLink,
    qr: (d) => d.link || null,
  },
  bitcoin: {
    type: 'bitcoin',
    label: 'Bitcoin (BTC)',
    iconKey: 'bitcoin',
    fields: cryptoFields('BTC', BTC_NETWORKS),
    qr: (d) => d.address || null,
    warning: networkWarning('BTC', BTC_NETWORKS),
  },
  usdt: {
    type: 'usdt',
    label: 'USDT (Tether)',
    iconKey: 'tether',
    fields: cryptoFields('USDT', USDT_NETWORKS),
    qr: (d) => d.address || null,
    warning: networkWarning('USDT', USDT_NETWORKS),
  },
  ethereum: {
    type: 'ethereum',
    label: 'Ethereum (ETH)',
    iconKey: 'ethereum',
    fields: cryptoFields('ETH', ETH_NETWORKS),
    qr: (d) => d.address || null,
    warning: networkWarning('ETH', ETH_NETWORKS),
  },
  zelle: {
    type: 'zelle',
    label: 'Zelle',
    iconKey: 'zelle',
    fields: [
      { name: 'email', label: 'Zelle email', required: false, kind: 'email', copyable: true },
      { name: 'phone', label: 'Zelle phone (US)', required: false, kind: 'phone', region: 'US', copyable: true },
      { name: 'recipientName', label: 'Recipient name', required: true, kind: 'text', copyable: true },
    ],
    eitherOr: [['email', 'phone']],
  },
  cashapp: {
    type: 'cashapp',
    label: 'Cash App',
    iconKey: 'cashapp',
    fields: [{ name: 'cashtag', label: '$Cashtag', required: true, kind: 'cashtag', copyable: true, placeholder: '$name' }, NAME_FIELD],
    link: cashAppLink,
    qr: (d) => cashAppLink(d)?.url ?? null,
  },
  venmo: {
    type: 'venmo',
    label: 'Venmo',
    iconKey: 'venmo',
    fields: [{ name: 'username', label: 'Venmo username', required: true, kind: 'handle', copyable: true, placeholder: '@name' }, NAME_FIELD],
    link: venmoLink,
    qr: (d) => venmoLink(d)?.url ?? null,
  },
  applepay: {
    type: 'applepay',
    label: 'Apple Pay / Apple Cash',
    iconKey: 'applepay',
    fields: [
      { name: 'phone', label: 'Phone', required: false, kind: 'phone', copyable: true },
      { name: 'email', label: 'Email', required: false, kind: 'email', copyable: true },
      NAME_FIELD,
    ],
    eitherOr: [['phone', 'email']],
  },
  googlepay: {
    type: 'googlepay',
    label: 'Google Pay',
    iconKey: 'googlepay',
    fields: [
      { name: 'phone', label: 'Phone', required: false, kind: 'phone', copyable: true },
      { name: 'email', label: 'Email', required: false, kind: 'email', copyable: true },
      NAME_FIELD,
    ],
    eitherOr: [['phone', 'email']],
  },
  us_bank: {
    type: 'us_bank',
    label: 'US bank transfer (ACH / wire)',
    iconKey: 'landmark',
    fields: [
      { name: 'accountName', label: 'Account name', required: true, kind: 'text', copyable: true },
      { name: 'bankName', label: 'Bank name', required: true, kind: 'text', copyable: true },
      { name: 'routingNumber', label: 'Routing number (ABA)', required: true, kind: 'routing', copyable: true },
      { name: 'accountNumber', label: 'Account number', required: true, kind: 'accountNumber', digits: [4, 17], copyable: true },
      {
        name: 'accountType', label: 'Account type', required: false, kind: 'text', copyable: false,
        options: [{ value: 'checking', label: 'Checking' }, { value: 'savings', label: 'Savings' }],
      },
      { name: 'bankAddress', label: 'Bank address', required: false, kind: 'text', maxLength: 200, copyable: true },
    ],
  },
  uk_bank: {
    type: 'uk_bank',
    label: 'UK bank transfer (Faster Payments)',
    iconKey: 'landmark',
    fields: [
      { name: 'accountName', label: 'Account name', required: true, kind: 'text', copyable: true },
      { name: 'bankName', label: 'Bank name', required: true, kind: 'text', copyable: true },
      { name: 'sortCode', label: 'Sort code', required: true, kind: 'sortCode', copyable: true, placeholder: '12-34-56' },
      { name: 'accountNumber', label: 'Account number', required: true, kind: 'accountNumber', digits: [8, 8], copyable: true },
    ],
  },
  intl_wire: {
    type: 'intl_wire',
    label: 'International wire (SWIFT / IBAN)',
    iconKey: 'globe',
    fields: [
      { name: 'beneficiary', label: 'Beneficiary name', required: true, kind: 'text', copyable: true },
      { name: 'bankName', label: 'Bank name', required: true, kind: 'text', copyable: true },
      { name: 'iban', label: 'IBAN', required: false, kind: 'iban', copyable: true },
      { name: 'accountNumber', label: 'Account number', required: false, kind: 'accountNumber', digits: [4, 34], copyable: true },
      { name: 'swift', label: 'SWIFT / BIC', required: true, kind: 'swift', copyable: true },
      { name: 'bankAddress', label: 'Bank address', required: false, kind: 'text', maxLength: 200, copyable: true },
      { name: 'country', label: 'Bank country', required: true, kind: 'text', maxLength: 60, copyable: true },
    ],
    eitherOr: [['iban', 'accountNumber']],
  },
  wise: {
    type: 'wise',
    label: 'Wise',
    iconKey: 'wise',
    fields: [
      { name: 'email', label: 'Wise email', required: false, kind: 'email', copyable: true },
      { name: 'wisetag', label: 'Wisetag', required: false, kind: 'handle', copyable: true, placeholder: '@name' },
      NAME_FIELD,
    ],
    eitherOr: [['email', 'wisetag']],
  },
  revolut: {
    type: 'revolut',
    label: 'Revolut',
    iconKey: 'revolut',
    fields: [
      { name: 'revtag', label: 'Revtag', required: false, kind: 'handle', copyable: true, placeholder: '@name' },
      { name: 'phone', label: 'Phone', required: false, kind: 'phone', copyable: true },
      NAME_FIELD,
    ],
    eitherOr: [['revtag', 'phone']],
  },
  card_link: {
    type: 'card_link',
    label: 'Card payment link',
    iconKey: 'credit-card',
    fields: [{ name: 'url', label: 'Payment link', required: true, kind: 'url', copyable: true, placeholder: 'https://' }],
    link: cardLink,
    qr: (d) => d.url || null,
  },
  western_union: {
    type: 'western_union',
    label: 'Western Union',
    iconKey: 'westernunion',
    fields: RECEIVER_FIELDS,
    note: 'After sending, enter the MTCN (Money Transfer Control Number) as the reference when you send your proof of payment.',
  },
  moneygram: {
    type: 'moneygram',
    label: 'MoneyGram',
    iconKey: 'moneygram',
    fields: RECEIVER_FIELDS,
    note: 'After sending, enter the MoneyGram reference number as the reference when you send your proof of payment.',
  },
};

export function isPaymentMethodType(value: unknown): value is PaymentMethodType {
  return typeof value === 'string' && (PAYMENT_METHOD_TYPES as readonly string[]).includes(value);
}

export function getPaymentMethod(type: unknown): PaymentMethodDefinition | null {
  return isPaymentMethodType(type) ? PAYMENT_METHODS[type] : null;
}

function validateField(field: PaymentField, raw: string, details: PaymentDetails, method: PaymentMethodDefinition): ValidationResult {
  if (field.options) {
    const option = field.options.find((o) => o.value === raw.trim());
    return option ? { ok: true, value: option.value } : { ok: false, error: 'Choose an option.' };
  }
  switch (field.kind) {
    case 'email': return validateEmail(raw);
    case 'url': return validateHttpsUrl(raw, field.hosts);
    case 'phone': return validatePhone(raw, field.region);
    case 'iban': return validateIban(raw);
    case 'sortCode': return validateSortCode(raw);
    case 'routing': return validateRoutingNumber(raw);
    case 'swift': return validateSwift(raw);
    case 'cashtag': return validateCashtag(raw);
    case 'handle': return validateHandle(raw);
    case 'accountNumber': return validateAccountNumber(raw, field.digits?.[0] ?? 4, field.digits?.[1] ?? 34);
    case 'crypto': {
      const networkField = method.fields.find((f) => f.name === 'network');
      const network = networkField?.options?.find((o) => o.value === details.network);
      // Without a valid network the network field carries the error; the address can't be checked yet.
      if (!network) return { ok: true, value: raw.trim() };
      return validateCryptoAddress(field.coin!, network.value, raw, network.label);
    }
    default: return validateText(raw, field.maxLength);
  }
}

export type PaymentDetailsResult =
  | { ok: true; details: PaymentDetails }
  | { ok: false; errors: Record<string, string> };

/**
 * Checks one account's details against its method type. Unknown keys are dropped, empty values left
 * out, and valid values normalised (IBAN compact, sort code NN-NN-NN, phone international, $/@ added).
 * Errors are keyed by field name (`type` for an unknown method).
 */
export function validatePaymentDetails(type: unknown, input: unknown): PaymentDetailsResult {
  const method = getPaymentMethod(type);
  if (!method) return { ok: false, errors: { type: 'Unknown payment method.' } };
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};

  // Raw values first, so the address can be checked against the chosen network.
  const raw: PaymentDetails = {};
  for (const field of method.fields) {
    const value = source[field.name];
    if (typeof value === 'string' && value.trim()) raw[field.name] = value;
  }

  const details: PaymentDetails = {};
  const errors: Record<string, string> = {};
  for (const field of method.fields) {
    const value = raw[field.name];
    if (value === undefined) {
      if (field.required) errors[field.name] = `${field.label} is required.`;
      continue;
    }
    const result = validateField(field, value, raw, method);
    if (result.ok) details[field.name] = result.value;
    else errors[field.name] = result.error;
  }

  for (const group of method.eitherOr ?? []) {
    if (group.some((name) => raw[name] !== undefined)) continue;
    const labels = group.map((name) => method.fields.find((f) => f.name === name)?.label ?? name);
    errors[group[0]] = `Enter ${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}.`;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, details };
}

/** One payment account as stored on a shipment's payment request (update.md §5 methods_json). */
export interface PaymentAccount {
  id: string;
  type: string;
  /** Optional display label set by the courier, e.g. "Business account". */
  label?: string | null;
  details: PaymentDetails;
  instructions?: string | null;
}

export interface CustomerMethodField {
  name: string;
  label: string;
  /** As shown (IBAN in groups of four, option labels for choices). */
  value: string;
  /** What Copy puts on the clipboard. */
  copyValue: string;
  copyable: boolean;
}

/** What the customer sees for one account: the track response and the admin preview both use it. */
export interface CustomerMethodView {
  id: string;
  type: PaymentMethodType;
  /** Method name, e.g. "PayPal". */
  methodLabel: string;
  /** Courier's display label, or the method name. */
  title: string;
  iconKey: string;
  fields: CustomerMethodField[];
  link: PaymentLink | null;
  qr: string | null;
  warning: string | null;
  note: string | null;
  instructions: string | null;
}

/**
 * The customer view of one account, built from its stored details. Unknown method types give null
 * (the track page leaves them out). Only the registry's fields are shown, in registry order.
 */
export function customerMethodView(account: PaymentAccount): CustomerMethodView | null {
  const method = getPaymentMethod(account.type);
  if (!method) return null;
  const details: PaymentDetails = {};
  for (const field of method.fields) {
    const value = account.details?.[field.name];
    if (typeof value === 'string' && value.trim()) details[field.name] = value.trim();
  }

  const fields: CustomerMethodField[] = [];
  for (const field of method.fields) {
    const value = details[field.name];
    if (value === undefined) continue;
    const option = field.options?.find((o) => o.value === value);
    const shown = option ? option.label : field.kind === 'iban' ? formatIban(value) : value;
    fields.push({ name: field.name, label: field.label, value: shown, copyValue: value, copyable: field.copyable });
  }

  // Links and QR codes only ever carry https URLs or wallet addresses that passed validation on save;
  // re-checked here so a stored value edited by hand can't become a javascript: link.
  const link = method.link?.(details) ?? null;
  const safeLink = link && validateHttpsUrl(link.url).ok ? link : null;
  const label = typeof account.label === 'string' ? account.label.trim() : '';
  const instructions = typeof account.instructions === 'string' ? account.instructions.trim() : '';

  return {
    id: account.id,
    type: method.type,
    methodLabel: method.label,
    title: label || method.label,
    iconKey: method.iconKey,
    fields,
    link: safeLink,
    qr: method.qr?.(details) ?? null,
    warning: method.warning?.(details) ?? null,
    note: method.note ?? null,
    instructions: instructions || null,
  };
}
