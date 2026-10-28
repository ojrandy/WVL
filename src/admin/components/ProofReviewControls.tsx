import React, { useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../../services/api';
import { REJECT_REASON_ERROR, REJECT_REASON_MAX, cleanRejectReason, type AdminPaymentProof } from '../../shared/paymentProof';

// Approve / Reject for a proof waiting for review (update.md G.6, labels CONTENT.md §6.8), on each
// Payments card and in the ProofViewer. Approving asks first; the "Payment confirmed" event box is
// ticked by default (D-8). Rejecting needs a reason, which the customer sees on the track page.

interface ProofReviewControlsProps {
  proof: AdminPaymentProof;
  /** Called with the reviewed proof and the message to show. */
  onReviewed: (proof: AdminPaymentProof, message: string) => void;
}

export const ProofReviewControls: React.FC<ProofReviewControlsProps> = ({ proof, onReviewed }) => {
  const id = useId();
  const [addEvent, setAddEvent] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);

  if (proof.status !== 'SUBMITTED') return null;
  // A proof left waiting on a request that was paid or cancelled meanwhile can only be rejected.
  const canApprove = proof.payment.status === 'AWAITING_PAYMENT' || proof.payment.status === 'UNDER_REVIEW';

  const fail = (err: any) => {
    setError(err?.status === 409 ? err.message : `The proof wasn't reviewed: ${(err?.message || 'server error').replace(/\.$/, '')}.`);
  };

  const approve = async () => {
    if (!window.confirm('Approve this proof? The payment request is marked as paid, and a linked invoice too.')) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.approvePaymentProof(proof.id, addEvent);
      onReviewed(updated, 'Proof approved. The payment request is now paid.');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const startReject = () => {
    setRejecting(true);
    setError('');
    requestAnimationFrame(() => reasonRef.current?.focus());
  };

  const cancelReject = () => {
    setRejecting(false);
    setReason('');
    setReasonError('');
    requestAnimationFrame(() => rejectRef.current?.focus());
  };

  const reject = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanRejectReason(reason);
    if (!clean) {
      setReasonError(REJECT_REASON_ERROR);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await api.rejectPaymentProof(proof.id, clean);
      onReviewed(updated, 'Proof rejected. The customer can send a new one.');
    } catch (err: any) {
      if (err?.errors?.reason) setReasonError(err.errors.reason);
      else fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sdl-proofreview">
      {error && (
        <p className="sdl-proofreview-error" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {!rejecting ? (
        <>
          {canApprove && (
            <label className="sdl-proofreview-check">
              <input type="checkbox" checked={addEvent} onChange={(e) => setAddEvent(e.target.checked)} disabled={busy} />
              <span>Add a "Payment confirmed" event to the tracking timeline</span>
            </label>
          )}
          <div className="sdl-proofreview-buttons">
            {canApprove && (
              <button type="button" className="message-action primary" onClick={approve} disabled={busy}>
                <CheckCircle2 size={14} /><span>Approve</span>
              </button>
            )}
            <button ref={rejectRef} type="button" className="message-action" onClick={startReject} disabled={busy}>
              <XCircle size={14} /><span>Reject</span>
            </button>
          </div>
        </>
      ) : (
        <form className="sdl-proofreview-reject" onSubmit={reject} noValidate>
          <label htmlFor={`${id}-reason`}>Reason for the customer (required)</label>
          <textarea
            ref={reasonRef}
            id={`${id}-reason`}
            rows={3}
            maxLength={REJECT_REASON_MAX}
            placeholder="e.g. The amount on the screenshot doesn't match."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (reasonError) setReasonError(cleanRejectReason(e.target.value) ? '' : REJECT_REASON_ERROR);
            }}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${id}-reason-error` : undefined}
            disabled={busy}
          />
          {reasonError && (
            <p id={`${id}-reason-error`} className="sdl-proofreview-error">
              <AlertCircle size={14} aria-hidden="true" />
              <span>{reasonError}</span>
            </p>
          )}
          <div className="sdl-proofreview-buttons">
            <button type="submit" className="message-action primary" disabled={busy}>
              <XCircle size={14} /><span>Reject proof</span>
            </button>
            <button type="button" className="message-action" onClick={cancelReject} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
