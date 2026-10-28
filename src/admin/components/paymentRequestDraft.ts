import { DEFAULT_PAYMENT_CURRENCY, type PaymentCurrency } from '../../shared/currency';
import type { AdminPaymentRequest } from '../../shared/paymentRequest';
import type { PaymentDetails } from '../../shared/paymentMethods';

// Form state for PaymentRequestEditor (update.md E.2): plain strings as typed, so a half-filled
// draft can live in Create Shipment before the tracking ID exists. validatePaymentRequest
// (src/shared/paymentRequest.ts) turns it into the saved shape, on the client and again on the server.

export interface PaymentAccountDraft {
  /** Stable id: kept from the saved request, or a temporary one the server replaces. */
  id: string;
  type: string;
  label: string;
  details: PaymentDetails;
  instructions: string;
}

export interface PaymentRequestDraft {
  amount: string;
  currency: PaymentCurrency;
  chargeReason: string;
  dueDate: string;
  customerNote: string;
  invoiceDocumentId: string;
  methods: PaymentAccountDraft[];
}

export function emptyPaymentDraft(): PaymentRequestDraft {
  return {
    amount: '',
    currency: DEFAULT_PAYMENT_CURRENCY,
    chargeReason: '',
    dueDate: '',
    customerNote: '',
    invoiceDocumentId: '',
    methods: [],
  };
}

export function draftFromRequest(request: AdminPaymentRequest): PaymentRequestDraft {
  return {
    amount: String(request.amount),
    currency: request.currency,
    chargeReason: request.chargeReason,
    dueDate: request.dueDate ?? '',
    customerNote: request.customerNote ?? '',
    invoiceDocumentId: request.invoiceDocumentId ?? '',
    methods: request.methods.map((m) => ({
      id: m.id,
      type: m.type,
      label: m.label ?? '',
      details: { ...m.details },
      instructions: m.instructions ?? '',
    })),
  };
}

/** True when nothing has been typed yet: Create Shipment treats that as "no payment request". */
export function isDraftEmpty(draft: PaymentRequestDraft): boolean {
  return !draft.amount.trim() && !draft.chargeReason.trim() && !draft.dueDate && !draft.customerNote.trim()
    && !draft.invoiceDocumentId && draft.methods.length === 0;
}

export const newDraftAccountId = () =>
  `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
