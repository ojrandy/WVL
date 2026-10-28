import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import type { AdminPaymentProof } from '../../shared/paymentProof';
import { formatPaymentAmount } from '../../shared/paymentRequest';
import { PaymentIcon } from '../../components/PaymentIcon';
import { formatProofTime, proofAccountTitle, proofAmountDiffers } from './ProofFacts';
import { ProofViewer } from './ProofViewer';
import { ProofReviewControls } from './ProofReviewControls';
import '../pages/MessagesView.css';
import '../pages/PaymentsView.css';
import './NewProofsPanel.css';

// "New payment proofs" on the dashboard (update.md H.2, labels CONTENT.md §6.8): up to six proofs
// waiting for review, newest first. A card opens the ProofViewer with Approve / Reject; a reviewed
// proof leaves the list and the console's count refreshes. Reloads whenever the polled count changes.

const MAX_CARDS = 6;

interface NewProofsPanelProps {
  /** The console's polled count (H.1); a change reloads the list. */
  submittedProofsCount: number;
  onOpenPayments: () => void;
  /** After an approve or reject, so the console's proof counts refresh. */
  onProofsChanged?: () => void;
}

export const NewProofsPanel: React.FC<NewProofsPanelProps> = ({ submittedProofsCount, onOpenPayments, onProofsChanged }) => {
  const [proofs, setProofs] = useState<AdminPaymentProof[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState('');
  const noticeRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getPaymentProofs('SUBMITTED');
      setProofs(data.proofs);
      setTotal(data.counts.SUBMITTED);
    } catch (err: any) {
      setError(err?.message || 'server error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [submittedProofsCount, load]);

  const openViewer = (proof: AdminPaymentProof, opener: HTMLElement) => {
    openerRef.current = opener;
    setViewerId(proof.id);
  };
  const closeViewer = () => {
    setViewerId(null);
    openerRef.current?.focus();
  };
  const viewerProof = viewerId ? proofs.find((p) => p.id === viewerId) ?? null : null;

  // The reviewed card leaves at once; focus goes to the message, since the card is gone.
  const handleReviewed = (updated: AdminPaymentProof, message: string) => {
    setProofs((prev) => prev.filter((p) => p.id !== updated.id));
    setTotal((n) => Math.max(0, n - 1));
    setViewerId(null);
    setNotice(message);
    requestAnimationFrame(() => noticeRef.current?.focus());
    onProofsChanged?.();
  };

  return (
    <section className="ops-section-card sdl-newproofs" aria-labelledby="sdl-newproofs-title">
      <div className="ops-table-header-block">
        <div className="table-title-group">
          <div className="table-title-row">
            <h2 id="sdl-newproofs-title" className="ops-section-title">New payment proofs</h2>
            {total > 0 && <span className="ops-shipment-count-pill is-alert">{total} to review</span>}
          </div>
        </div>
        <div className="table-controls-group">
          <button type="button" className="ops-btn-secondary sdl-newproofs-refresh" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button type="button" className="ops-btn-secondary" onClick={onOpenPayments}>
            All Payments →
          </button>
        </div>
      </div>

      <div className="sdl-newproofs-body">
        {notice && (
          <div ref={noticeRef} className="sdl-payments-notice" role="status" tabIndex={-1}>
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        {error && (
          <div className="messages-error">
            <AlertTriangle size={16} />
            <span>The proofs couldn't be loaded: {error}.</span>
            <button type="button" className="sdl-payments-retry" onClick={load}>Try again</button>
          </div>
        )}

        {loading && proofs.length === 0 && !error && <p className="sdl-payments-loading">Loading proofs…</p>}

        {!loading && !error && proofs.length === 0 && (
          <div className="ops-empty-panel sdl-newproofs-empty">
            <CheckCircle2 size={32} className="empty-panel-icon" />
            <h4>Nothing to review</h4>
            <p>New proofs of payment from tracking pages appear here.</p>
          </div>
        )}

        {proofs.length > 0 && (
          <ul className="sdl-newproofs-grid">
            {proofs.slice(0, MAX_CARDS).map((p) => {
              const differs = proofAmountDiffers(p);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="sdl-newproof-card"
                    onClick={(e) => openViewer(p, e.currentTarget)}
                    aria-label={`Review payment proof: ${p.trackingNumber}`}
                  >
                    <img
                      className="sdl-newproof-thumb"
                      src={p.fileUrl}
                      alt=""
                      width={64}
                      height={64}
                      loading="lazy"
                    />
                    <span className="sdl-newproof-main">
                      <span className="sdl-newproof-head">
                        <strong className="font-mono">{p.trackingNumber}</strong>
                        <small>{formatProofTime(p.createdAt)}</small>
                      </span>
                      <span className="sdl-newproof-amounts font-mono">
                        <span>Due {formatPaymentAmount(p.payment.amount, p.payment.currency)}</span>
                        <span className={differs ? 'is-flagged' : undefined}>
                          {differs && <AlertTriangle size={12} aria-hidden="true" />}
                          Sent {p.amountSent === null ? '—' : formatPaymentAmount(p.amountSent, p.payment.currency)}
                        </span>
                      </span>
                      <span className="sdl-newproof-method">
                        {p.method && <PaymentIcon type={p.method.type} size={16} />}
                        <span>{proofAccountTitle(p)}</span>
                      </span>
                      {p.reference && <span className="sdl-newproof-ref font-mono">Ref. {p.reference}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {viewerProof && (
        <ProofViewer proof={viewerProof} onClose={closeViewer}>
          <ProofReviewControls proof={viewerProof} onReviewed={handleReviewed} />
        </ProofViewer>
      )}
    </section>
  );
};
