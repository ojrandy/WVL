// A shipment's payment request (update.md §5 shipment_payments, E.1). Shared by the browser and the
// server: the admin editor checks a draft with validatePaymentRequest before saving, and the server
// checks it again on PUT. publicPaymentView builds what /api/track/:id shows the customer.
// Admin messages are in CONTENT.md §6.7 / §6.8.

import { fitsCurrencyDecimals, getPaymentCurrency, type PaymentCurrency } from './currency.js';
import {
  customerMethodView,
  validatePaymentDetails,
  type CustomerMethodView,
  type PaymentAccount,
  type PaymentMethodType,
} from './paymentMethods.js';

export const PAYMENT_STATUSES = ['AWAITING_PAYMENT', 'UNDER_REVIEW', 'PAID', 'CANCELLED'] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

export const MAX_PAYMENT_ACCOUNTS = 10;
export const MAX_PAYMENT_AMOUNT = 999_999_999_999;
export const CHARGE_REASON_MIN = 3;
export const CHARGE_REASON_MAX = 200;
export const CUSTOMER_NOTE_MAX = 300;
export const ACCOUNT_LABEL_MAX = 60;
export const ACCOUNT_INSTRUCTIONS_MAX = 500;

/** A stored account: its type is always a registry key once validated. */
export interface PaymentRequestAccount extends PaymentAccount {
  type: PaymentMethodType;
  label: string | null;
  instructions: string | null;
}

/** The admin-written part of a request: what PUT /api/shipments/:id/payment takes. */
export interface PaymentRequestData {
  amount: number;
  currency: PaymentCurrency;
  chargeReason: string;
  /** Calendar date YYYY-MM-DD, no time zone. */
  dueDate: string | null;
  customerNote: string | null;
  /** documents.id of an INVOICE of the same shipment (checked by the server). */
  invoiceDocumentId: string | null;
  methods: PaymentRequestAccount[];
}

/** The full request as the admin API returns it. */
export interface AdminPaymentRequest extends PaymentRequestData {
  id: string;
  trackingNumber: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

/**
 * The latest proof's state for the track page (update.md G.4): its status and time, and the
 * rejection reason only when it was rejected. Never the payer, amount, reference or file.
 */
export interface PublicProofStatus {
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  reason: string | null;
}

/** What the track page gets (update.md §6). Never the invoice id or anything internal. */
export interface PublicPayment {
  amount: number;
  currency: PaymentCurrency;
  chargeReason: string;
  dueDate: string | null;
  status: PaymentStatus;
  customerNote: string | null;
  paidAt: string | null;
  methods: CustomerMethodView[];
  /** The latest proof sent for this request, or null. */
  proof: PublicProofStatus | null;
}

export type PaymentRequestResult =
  | { ok: true; value: PaymentRequestData }
  | { ok: false; errors: Record<string, string> };

// Control characters other than line breaks never belong in free text.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const newAccountId = () => globalThis.crypto.randomUUID();

/** Single-line text, spaces collapsed. */
function singleLine(input: unknown): string {
  return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '';
}

/** Multi-line text: line breaks kept (at most one blank line), spaces collapsed within lines. */
function multiLine(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** A plain decimal ("120", "120.50", 120.5). Exponents, commas, words and signs are not amounts. */
function parseAmount(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(input)) return Number(input);
  return null;
}

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is refused). */
export function isCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return y >= 2000 && y <= 2100 && date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Checks and normalises a payment request. Errors are keyed by field (`amount`, `currency`,
 * `chargeReason`, `dueDate`, `customerNote`, `invoiceDocumentId`, `methods`) and, for an account, by
 * `methods.<index>.<field>` (`type`, `label`, `instructions` or a registry field name).
 * Accounts keep a valid id they already have, so the customer's choice (and a proof naming it)
 * survives edits; new or duplicate ids get a fresh one. The server passes `keepIds` (the ids already
 * saved on this request), so it alone mints ids: any other id a client sends is replaced (D-13).
 */
export function validatePaymentRequest(
  input: unknown,
  options: { newId?: () => string; keepIds?: ReadonlySet<string> } = {},
): PaymentRequestResult {
  const makeId = options.newId ?? newAccountId;
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const errors: Record<string, string> = {};

  const currencyInfo = getPaymentCurrency(source.currency);
  if (!currencyInfo) errors.currency = 'Choose a currency.';

  const parsedAmount = parseAmount(source.amount);
  const amount = parsedAmount ?? NaN;
  const rawAmount = typeof source.amount === 'string' ? source.amount.trim() : source.amount;
  if (rawAmount === '' || rawAmount === undefined || rawAmount === null) {
    errors.amount = 'Enter the amount.';
  } else if (parsedAmount === null && !String(rawAmount).startsWith('-')) {
    errors.amount = 'Enter the amount as a number, e.g. 120.00.';
  } else if (!(amount > 0)) {
    errors.amount = 'Enter an amount greater than 0.';
  } else if (amount > MAX_PAYMENT_AMOUNT) {
    errors.amount = 'Enter a smaller amount.';
  } else if (currencyInfo && !fitsCurrencyDecimals(amount, currencyInfo.code)) {
    errors.amount = currencyInfo.minorDigits === 0
      ? `${currencyInfo.code} amounts can't have decimals.`
      : `Use at most ${currencyInfo.minorDigits} decimals for ${currencyInfo.code}.`;
  }

  const chargeReason = singleLine(source.chargeReason);
  if (chargeReason.length < CHARGE_REASON_MIN || chargeReason.length > CHARGE_REASON_MAX) {
    errors.chargeReason = `Say what the payment is for (${CHARGE_REASON_MIN}–${CHARGE_REASON_MAX} characters).`;
  } else if (CONTROL_CHARS.test(String(source.chargeReason))) {
    errors.chargeReason = 'Remove line breaks and special characters.';
  }

  const dueDateRaw = singleLine(source.dueDate);
  if (dueDateRaw && !isCalendarDate(dueDateRaw)) errors.dueDate = 'Enter a real date.';

  const customerNote = multiLine(source.customerNote);
  if (customerNote.length > CUSTOMER_NOTE_MAX) errors.customerNote = `Keep it under ${CUSTOMER_NOTE_MAX} characters.`;
  else if (CONTROL_CHARS.test(customerNote)) errors.customerNote = 'Remove special characters.';

  const invoiceDocumentId = singleLine(source.invoiceDocumentId);
  if (invoiceDocumentId && !/^[A-Za-z0-9_-]{1,80}$/.test(invoiceDocumentId)) {
    errors.invoiceDocumentId = 'Choose an invoice of this shipment.';
  }

  const rawMethods = Array.isArray(source.methods) ? source.methods : [];
  if (rawMethods.length < 1) errors.methods = 'Add at least one payment method.';
  else if (rawMethods.length > MAX_PAYMENT_ACCOUNTS) errors.methods = `Add at most ${MAX_PAYMENT_ACCOUNTS} payment methods.`;

  const seenIds = new Set<string>();
  const methods: PaymentRequestAccount[] = [];
  rawMethods.slice(0, MAX_PAYMENT_ACCOUNTS).forEach((raw, index) => {
    const account = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const key = (field: string) => `methods.${index}.${field}`;

    const details = validatePaymentDetails(account.type, account.details);
    if (!details.ok) {
      for (const [field, message] of Object.entries(details.errors)) errors[key(field)] = message;
    }

    const label = singleLine(account.label);
    if (label.length > ACCOUNT_LABEL_MAX) errors[key('label')] = `Keep it under ${ACCOUNT_LABEL_MAX} characters.`;
    else if (CONTROL_CHARS.test(String(account.label ?? ''))) errors[key('label')] = 'Remove line breaks and special characters.';

    const instructions = multiLine(account.instructions);
    if (instructions.length > ACCOUNT_INSTRUCTIONS_MAX) errors[key('instructions')] = `Keep it under ${ACCOUNT_INSTRUCTIONS_MAX} characters.`;
    else if (CONTROL_CHARS.test(instructions)) errors[key('instructions')] = 'Remove special characters.';

    let id = typeof account.id === 'string' && ACCOUNT_ID.test(account.id) ? account.id : '';
    if (!id || seenIds.has(id) || (options.keepIds && !options.keepIds.has(id))) id = makeId();
    seenIds.add(id);

    if (details.ok) {
      methods.push({
        id,
        type: account.type as PaymentMethodType,
        label: label || null,
        details: details.details,
        instructions: instructions || null,
      });
    }
  });

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      amount,
      currency: currencyInfo!.code,
      chargeReason,
      dueDate: dueDateRaw || null,
      customerNote: customerNote || null,
      invoiceDocumentId: invoiceDocumentId || null,
      methods,
    },
  };
}

/**
 * The customer's view of a stored request: only its own accounts, in the courier's order, each
 * through the registry's customer view (an account of an unknown type is left out). A cancelled
 * request isn't shown on the track page (F.4), so its accounts are left out too. `latestProof` is
 * the newest proof row of this request; only its status, time and (when rejected) reason pass.
 */
export function publicPaymentView(request: {
  amount: number;
  currency: string;
  chargeReason: string;
  dueDate: string | null;
  status: string;
  customerNote: string | null;
  paidAt: string | null;
  methods: readonly PaymentAccount[];
  latestProof?: { status: string; createdAt: string; adminNote: string | null } | null;
}): PublicPayment {
  const currency = getPaymentCurrency(request.currency)?.code ?? 'USD';
  const status = (PAYMENT_STATUSES as readonly string[]).includes(request.status) ? request.status as PaymentStatus : 'AWAITING_PAYMENT';
  return {
    amount: request.amount,
    currency,
    chargeReason: request.chargeReason,
    dueDate: request.dueDate,
    status,
    customerNote: request.customerNote,
    paidAt: status === 'PAID' ? request.paidAt : null,
    methods: status === 'CANCELLED'
      ? []
      : request.methods.map((m) => customerMethodView(m)).filter((m): m is CustomerMethodView => m !== null),
    proof: publicProofStatus(status, request.latestProof),
  };
}

function publicProofStatus(
  status: PaymentStatus,
  latest: { status: string; createdAt: string; adminNote: string | null } | null | undefined,
): PublicProofStatus | null {
  if (!latest || status === 'CANCELLED') return null;
  if (latest.status !== 'SUBMITTED' && latest.status !== 'APPROVED' && latest.status !== 'REJECTED') return null;
  return {
    status: latest.status,
    submittedAt: latest.createdAt,
    reason: latest.status === 'REJECTED' ? latest.adminNote : null,
  };
}

export const PAYMENT_STATUS_ACTIONS = ['cancel', 'mark_paid', 'reopen'] as const;
export type PaymentStatusAction = typeof PAYMENT_STATUS_ACTIONS[number];

/**
 * The admin status changes (update.md §6, E.5): an open request (awaiting payment or proof under
 * review) can be cancelled or marked paid; a paid or cancelled one can be reopened. Anything else
 * is null (the route answers 409).
 */
export function nextPaymentStatus(current: string, action: string): PaymentStatus | null {
  const open = current === 'AWAITING_PAYMENT' || current === 'UNDER_REVIEW';
  const closed = current === 'PAID' || current === 'CANCELLED';
  if (action === 'cancel' && open) return 'CANCELLED';
  if (action === 'mark_paid' && open) return 'PAID';
  if (action === 'reopen' && closed) return 'AWAITING_PAYMENT';
  return null;
}

/**
 * Whether the customer sees the request at all (update.md D-12). A cancelled request is not shown on
 * the track page, so /api/track gives null for it, exactly as for no request.
 */
export function isPaymentVisibleToCustomer(status: string): boolean {
  return status === 'AWAITING_PAYMENT' || status === 'UNDER_REVIEW' || status === 'PAID';
}

/** "Nov 30, 2026" for a stored YYYY-MM-DD due date, read as a calendar date (no time-zone shift). */
export function formatDueDate(value: string | null | undefined): string {
  if (!value || !isCalendarDate(value)) return '';
  const [y, m, d] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** "USD 120.00", "JPY 12,000", "KWD 36.500": the currency's own decimals, with its code (D-7). */
export function formatPaymentAmount(amount: number, currency: string): string {
  const info = getPaymentCurrency(currency);
  const digits = info?.minorDigits ?? 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: info?.code ?? currency,
      currencyDisplay: 'code',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(digits)}`;
  }
}
