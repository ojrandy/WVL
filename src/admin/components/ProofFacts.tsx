import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { PaymentIcon } from '../../components/PaymentIcon';
import { customerMethodView, getPaymentMethod } from '../../shared/paymentMethods';
import { formatPaymentAmount } from '../../shared/paymentRequest';
import type { AdminPaymentProof } from '../../shared/paymentProof';
import { PAYMENT_STATUS_LABELS } from './ShipmentPaymentPanel';

// The facts of one payment proof (update.md G.5, labels CONTENT.md §6.8), shared by the Payments
// page cards, the full-size ProofViewer and the dashboard panel (H.2). The account comes from the
// snapshot taken when the proof was sent, so a later edit or removal doesn't change it.

export const PROOF_STATUS_LABELS: Record<AdminPaymentProof['status'], string> = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const formatProofTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export function proofAmountDiffers(proof: AdminPaymentProof): boolean {
  return proof.amountSent !== null && proof.amountSent !== proof.payment.amount;
}

/** "Business account · PayPal", or just the method name. */
export function proofAccountTitle(proof: AdminPaymentProof): string {
  const method = proof.method ? getPaymentMethod(proof.method.type)?.label ?? proof.method.type : '';
  if (!proof.method) return '—';
  return proof.method.label && proof.method.label !== method ? `${proof.method.label} · ${method}` : method;
}

interface ProofFactsProps {
  proof: AdminPaymentProof;
  /** Adds the account's details (number, address…) under its name. */
  showAccountDetails?: boolean;
}

export const ProofFacts: React.FC<ProofFactsProps> = ({ proof, showAccountDetails = false }) => {
  const differs = proofAmountDiffers(proof);
  const account = showAccountDetails && proof.method ? customerMethodView(proof.method) : null;
  return (
    <dl className="sdl-prooffacts">
      <div>
        <dt>Amount due</dt>
        <dd className="font-mono">{formatPaymentAmount(proof.payment.amount, proof.payment.currency)}</dd>
      </div>
      <div className={differs ? 'is-flagged' : undefined}>
        <dt>Amount sent</dt>
        <dd className="font-mono">
          {proof.amountSent === null ? '—' : formatPaymentAmount(proof.amountSent, proof.payment.currency)}
          {differs && (
            <span className="sdl-prooffacts-flag">
              <AlertTriangle size={13} aria-hidden="true" />
              Differs from the amount due
            </span>
          )}
        </dd>
      </div>
      <div className="is-wide">
        <dt>Account used</dt>
        <dd>
          <span className="sdl-prooffacts-account">
            {proof.method && <PaymentIcon type={proof.method.type} size={18} />}
            <span>{proofAccountTitle(proof)}</span>
          </span>
          {account && account.fields.length > 0 && (
            <span className="sdl-prooffacts-details">
              {account.fields.map((f) => (
                <span key={f.name}><small>{f.label}</small> <span className="font-mono">{f.value}</span></span>
              ))}
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt>Payer</dt>
        <dd>{proof.payerName}</dd>
      </div>
      <div>
        <dt>Reference</dt>
        <dd className={proof.reference ? 'font-mono' : 'is-muted'}>{proof.reference || 'None'}</dd>
      </div>
      <div className="is-wide">
        <dt>Payment for</dt>
        <dd>{proof.payment.chargeReason}</dd>
      </div>
      <div>
        <dt>Request</dt>
        <dd>
          <span className={`sdl-paypanel-pill is-${proof.payment.status.toLowerCase()}`}>
            {PAYMENT_STATUS_LABELS[proof.payment.status] ?? proof.payment.status}
          </span>
        </dd>
      </div>
      <div>
        <dt>Received</dt>
        <dd>{formatProofTime(proof.createdAt)}</dd>
      </div>
      {proof.reviewedAt && (
        <div>
          <dt>Reviewed</dt>
          <dd>{formatProofTime(proof.reviewedAt)}</dd>
        </div>
      )}
      {proof.status === 'REJECTED' && proof.adminNote && (
        <div className="is-wide">
          <dt>Rejection reason</dt>
          <dd>{proof.adminNote}</dd>
        </div>
      )}
    </dl>
  );
};
