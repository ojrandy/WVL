// Proof of payment (update.md §5 payment_proofs, Phase G). Shared by the browser and the server:
// the track page's proof form and POST /api/track/:id/payment-proof apply the same rules, and the
// admin Payments page reads the AdminPaymentProof shape. Public copy is in CONTENT.md §6.8.

import { MAX_PAYMENT_AMOUNT, type PaymentRequestAccount, type PaymentStatus } from './paymentRequest.js';
import { fitsCurrencyDecimals, type PaymentCurrency } from './currency.js';

export const PROOF_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type ProofStatus = typeof PROOF_STATUSES[number];

/** Proofs waiting for review on one request before more are refused (update.md §6). */
export const MAX_OPEN_PROOFS = 3;
// Not in the spec; set with G.2, owner to confirm (update.md §8).
export const PAYER_NAME_MAX = 100;
export const PROOF_REFERENCE_MAX = 120;

// Rejection reason, shown to the customer on the track page (update.md §6, G.6).
export const REJECT_REASON_MIN = 3;
export const REJECT_REASON_MAX = 300;

/** The reason on one line, or null when it's empty, too short or too long. */
export function cleanRejectReason(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const reason = input.replace(/\s+/g, ' ').trim();
  return reason.length >= REJECT_REASON_MIN && reason.length <= REJECT_REASON_MAX ? reason : null;
}

export const REJECT_REASON_ERROR = `Enter a reason (${REJECT_REASON_MIN}–${REJECT_REASON_MAX} characters).`;

export type ProofErrorCode = 'NOT_ACCEPTING' | 'TOO_MANY_OPEN' | 'RATE_LIMITED';

/** The customer-facing messages for the route's error codes (CONTENT.md §6.8). */
export const PROOF_ERROR_MESSAGES: Record<ProofErrorCode | 'FAILED', string> = {
  NOT_ACCEPTING: "This payment isn't accepting proofs right now. Refresh the page to see its latest status.",
  TOO_MANY_OPEN: "We already have proofs waiting for review for this payment. We'll check those first.",
  RATE_LIMITED: 'Too many attempts. Please try again later.',
  FAILED: "Your proof wasn't sent. Please try again.",
};

export const PROOF_IMAGE_MESSAGES = {
  missing: 'Add a screenshot of your payment.',
  notImage: 'Only JPG, PNG, WebP or HEIC images can be sent.',
  unreadable: "This image couldn't be read. Try saving it as JPG or PNG first.",
  tooLarge: 'This image is still over 2 MB after compression.',
} as const;

/** Why a request can't take a proof right now, or null when it can. */
export function proofRefusal(paymentStatus: string | null | undefined, openProofs: number): ProofErrorCode | null {
  if (paymentStatus !== 'AWAITING_PAYMENT') return 'NOT_ACCEPTING';
  if (openProofs >= MAX_OPEN_PROOFS) return 'TOO_MANY_OPEN';
  return null;
}

export interface ProofFields {
  methodId: string;
  payerName: string;
  amountSent: number;
  reference: string | null;
}

export type ProofFieldsResult =
  | { ok: true; value: ProofFields }
  | { ok: false; errors: Partial<Record<keyof ProofFields, string>> };

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const oneLine = (input: unknown) => (typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '');

/**
 * Checks the proof form's text fields (the screenshot is checked on its own: compressed in the
 * browser, by content on the server). `methodIds` are the request's account ids; the chosen one must
 * be among them. The amount is a plain decimal in the request's currency, with its decimals.
 */
export function validateProofFields(
  input: unknown,
  context: { methodIds: readonly string[]; currency: string },
): ProofFieldsResult {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const errors: Partial<Record<keyof ProofFields, string>> = {};

  const methodId = typeof source.methodId === 'string' ? source.methodId : '';
  if (!context.methodIds.includes(methodId)) errors.methodId = 'Choose the payment method you used.';

  const payerName = oneLine(source.payerName);
  if (!payerName) errors.payerName = 'Enter the name on the payment.';
  else if (payerName.length > PAYER_NAME_MAX) errors.payerName = `Keep it under ${PAYER_NAME_MAX} characters.`;
  else if (CONTROL_CHARS.test(payerName)) errors.payerName = 'Enter the name on the payment.';

  const rawAmount = typeof source.amountSent === 'number' ? String(source.amountSent) : oneLine(source.amountSent);
  const amountSent = /^\d+(\.\d+)?$/.test(rawAmount) ? Number(rawAmount) : NaN;
  if (!rawAmount) errors.amountSent = 'Enter the amount you sent.';
  else if (!(amountSent > 0) || amountSent > MAX_PAYMENT_AMOUNT || !fitsCurrencyDecimals(amountSent, context.currency as PaymentCurrency)) {
    errors.amountSent = 'Enter the amount as a number, e.g. 120.00.';
  }

  const reference = oneLine(source.reference);
  if (reference.length > PROOF_REFERENCE_MAX) errors.reference = `Keep it under ${PROOF_REFERENCE_MAX} characters.`;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { methodId, payerName, amountSent, reference: reference || null } };
}

/** A proof as the admin API returns it (G.5). The file is reached through `fileUrl` only. */
export interface AdminPaymentProof {
  id: string;
  trackingNumber: string;
  status: ProofStatus;
  payerName: string;
  amountSent: number | null;
  reference: string | null;
  /** Rejection reason (shown to the customer). */
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** The account the customer said they used, as it was when the proof was sent. */
  method: PaymentRequestAccount | null;
  /** The request the proof belongs to, as it is now. */
  payment: {
    amount: number;
    currency: PaymentCurrency;
    chargeReason: string;
    status: PaymentStatus;
  };
  fileUrl: string;
}

export interface ProofCounts {
  SUBMITTED: number;
  APPROVED: number;
  REJECTED: number;
  ALL: number;
}
