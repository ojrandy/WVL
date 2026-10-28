// Proof of payment (update.md §5 payment_proofs, Phase G). Shared by the browser and the server:
// the track page's proof form and POST /api/track/:id/payment-proof apply the same rules, and the
// admin Payments page reads the AdminPaymentProof shape. Public copy is in CONTENT.md §6.8.

import type { PaymentRequestAccount, PaymentStatus } from './paymentRequest.js';
import type { PaymentCurrency } from './currency.js';

export const PROOF_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type ProofStatus = typeof PROOF_STATUSES[number];

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
