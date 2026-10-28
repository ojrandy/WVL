import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Maximize2, Receipt, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import type { AdminPaymentProof, ProofCounts, ProofStatus } from '../../shared/paymentProof';
import { getPaymentMethod } from '../../shared/paymentMethods';
import { ProofFacts, PROOF_STATUS_LABELS, formatProofTime } from '../components/ProofFacts';
import { ProofViewer } from '../components/ProofViewer';
import { ProofReviewControls } from '../components/ProofReviewControls';
import './MessagesView.css';
import './PaymentsView.css';

// Admin Payments page (update.md G.5, labels CONTENT.md §6.8): the proofs of payment customers
// send from the track page, newest first, filtered by status (Submitted by default) and by the
// console's search box. Screenshots load through the admin-only file route.

type Filter = ProofStatus | 'ALL';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

const EMPTY_COUNTS: ProofCounts = { SUBMITTED: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };

interface PaymentsViewProps {
  searchQuery: string;
  onOpenShipmentDetail: (trackingNumber: string) => void;
  /** After an approve or reject, so the console's proof counts refresh. */
  onProofsChanged?: () => void;
}

export const PaymentsView: React.FC<PaymentsViewProps> = ({ searchQuery, onOpenShipmentDetail, onProofsChanged }) => {
  const [filter, setFilter] = useState<Filter>('SUBMITTED');
  const [proofs, setProofs] = useState<AdminPaymentProof[]>([]);
  const [counts, setCounts] = useState<ProofCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState('');
  const noticeRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (status: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getPaymentProofs(status);
      setProofs(data.proofs);
      setCounts(data.counts);
    } catch (err: any) {
      setError(err?.message || 'server error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return proofs;
    return proofs.filter((p) => [
      p.trackingNumber, p.payerName, p.reference, p.payment.chargeReason, p.method?.label,
      p.method ? getPaymentMethod(p.method.type)?.label : null,
    ].some((field) => field?.toLowerCase().includes(q)));
  }, [proofs, searchQuery]);

  const openViewer = (proof: AdminPaymentProof, opener: HTMLElement) => {
    openerRef.current = opener;
    setViewerId(proof.id);
  };
  const closeViewer = () => {
    setViewerId(null);
    openerRef.current?.focus();
  };
  const viewerProof = viewerId ? proofs.find((p) => p.id === viewerId) ?? null : null;

  // A reviewed proof shows its new state at once; the list then reloads (it may leave the filter).
  // Focus goes to the message, since the card or viewer that held it may be gone.
  const handleReviewed = (updated: AdminPaymentProof, message: string) => {
    setProofs((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setViewerId(null);
    setNotice(message);
    requestAnimationFrame(() => noticeRef.current?.focus());
    load(filter);
    onProofsChanged?.();
  };

  return (
    <div className="sdl-messages-workspace sdl-payments-workspace animate-fade-in">
      <div className="messages-toolbar">
        <div className="messages-filters" role="tablist" aria-label="Filter payment proofs">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              className={`messages-filter-btn ${filter === f.value ? 'active' : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label} <span className="font-mono">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="messages-refresh-btn" onClick={() => load(filter)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="messages-error">
          <AlertTriangle size={16} />
          <span>The proofs couldn't be loaded: {error}.</span>
          <button type="button" className="sdl-payments-retry" onClick={() => load(filter)}>Try again</button>
        </div>
      )}

      {notice && (
        <div ref={noticeRef} className="sdl-payments-notice" role="status" tabIndex={-1}>
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {loading && proofs.length === 0 && !error && <p className="sdl-payments-loading">Loading proofs…</p>}

      {!loading && !error && visible.length === 0 && (
        <div className="messages-empty">
          <Receipt size={28} />
          <strong>{proofs.length === 0 ? 'No proofs here' : 'No proofs match'}</strong>
          <p>{proofs.length === 0 ? 'Proofs customers send from the tracking page appear here.' : 'Try another filter or clear the search.'}</p>
        </div>
      )}

      <div className="sdl-proof-list">
        {visible.map((p) => (
          <article key={p.id} className={`sdl-proof-card is-${p.status.toLowerCase()}`} aria-labelledby={`proof-${p.id}-title`}>
            <button
              type="button"
              className="sdl-proof-thumb"
              onClick={(e) => openViewer(p, e.currentTarget)}
              aria-label={`View screenshot: ${p.trackingNumber}`}
            >
              <img src={p.fileUrl} alt={`Payment screenshot from ${p.payerName}`} width={112} height={112} loading="lazy" />
            </button>
            <div className="sdl-proof-main">
              <div className="sdl-proof-head">
                <strong id={`proof-${p.id}-title`} className="font-mono">{p.trackingNumber}</strong>
                <span className={`sdl-proof-pill is-${p.status.toLowerCase()}`}>{PROOF_STATUS_LABELS[p.status]}</span>
                <small>{formatProofTime(p.createdAt)}</small>
              </div>
              <ProofFacts proof={p} />
              <div className="sdl-proof-actions">
                <button type="button" className="message-action" onClick={(e) => openViewer(p, e.currentTarget)}>
                  <Maximize2 size={14} /><span>View screenshot</span>
                </button>
                <button type="button" className="message-action" onClick={() => onOpenShipmentDetail(p.trackingNumber)}>
                  <ExternalLink size={14} /><span>View shipment</span>
                </button>
              </div>
              <ProofReviewControls proof={p} onReviewed={handleReviewed} />
            </div>
          </article>
        ))}
      </div>

      {viewerProof && (
        <ProofViewer proof={viewerProof} onClose={closeViewer}>
          <ProofReviewControls proof={viewerProof} onReviewed={handleReviewed} />
        </ProofViewer>
      )}
    </div>
  );
};
