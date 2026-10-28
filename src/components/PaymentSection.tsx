import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, CircleCheck, Clock, Receipt, ShieldCheck, Wallet } from 'lucide-react';
import { formatDueDate, formatPaymentAmount, type PublicPayment } from '../shared/paymentRequest';
import type { CustomerMethodView } from '../shared/paymentMethods';
import { PaymentIcon } from './PaymentIcon';
import { PaymentMethodCard } from './PaymentMethodCard';
import { PaymentTab } from './PaymentTab';
import './PaymentSection.css';

// The proof form (G.3) is its own chunk too: fetched only once its tab is first opened.
const PaymentProofForm = lazy(() => import('./PaymentProofForm'));

// The payment section on the Track Result page (update.md F.2–F.4, copy CONTENT.md §6.8). Its own
// chunk: the page loads it only for a shipment with a payment request. A cancelled request never
// reaches the page (/api/track gives null, D-12).

const STATUS_LABELS: Record<string, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  UNDER_REVIEW: 'Proof under review',
  PAID: 'Paid',
};

const TOAST_MS = 2000;
const GRID_QUERY = '(min-width: 768px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** "Nov 30, 2026" in the viewer's own time zone, for a stored timestamp. */
function formatPaidDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Oct 28, 2026 at 2:05 PM" in the viewer's own time zone. */
function formatReceived(value: string): { date: string; time: string } | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

interface AccountsProps {
  methods: CustomerMethodView[];
  onCopied: (fieldLabel: string) => void;
}

// Phones: an accordion, one account open at a time, the first open. From 768px: a grid of cards.
const PaymentAccounts: React.FC<AccountsProps> = ({ methods, onCopied }) => {
  const grid = useMediaQuery(GRID_QUERY);
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  if (grid) {
    return (
      <ul className="sdl-payacc-grid">
        {methods.map((m) => (
          <li key={m.id}><PaymentMethodCard method={m} onCopied={onCopied} /></li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="sdl-payacc-list">
      {methods.map((m, i) => {
        const open = openIndex === i;
        const panelId = `sdl-payacc-${m.id}`;
        return (
          <li key={m.id} className={`sdl-payacc-item${open ? ' is-open' : ''}`}>
            <h4 className="sdl-payacc-heading">
              <button
                type="button"
                className="sdl-payacc-toggle"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenIndex(open ? null : i)}
              >
                <span className="sdl-payacc-icon"><PaymentIcon type={m.type} size={22} /></span>
                <span className="sdl-payacc-titles">
                  <span className="sdl-payacc-title">{m.title}</span>
                  {m.title !== m.methodLabel && <span className="sdl-payacc-method">{m.methodLabel}</span>}
                </span>
                <ChevronDown className="sdl-payacc-chevron" size={18} aria-hidden="true" />
              </button>
            </h4>
            <div id={panelId} className="sdl-payacc-panel" hidden={!open}>
              {open && <PaymentMethodCard method={m} onCopied={onCopied} showHeader={false} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

interface PaymentSectionProps {
  payment: PublicPayment;
  trackingNumber: string;
  /** A proof was accepted by the server; the page shows the request as under review at once. */
  onProofSent?: (submittedAt: string) => void;
}

export const PaymentSection: React.FC<PaymentSectionProps> = ({ payment, trackingNumber, onProofSent }) => {
  const [toast, setToast] = useState('');
  const [proofSent, setProofSent] = useState(false);
  const [proofTabOpened, setProofTabOpened] = useState(false);
  const toastTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const showToast = (fieldLabel: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(`${fieldLabel} copied`);
    toastTimer.current = window.setTimeout(() => setToast(''), TOAST_MS);
  };

  const paid = payment.status === 'PAID';
  const count = payment.methods.length;
  const optionsLine = count === 1 ? '1 payment option' : `Choose one of ${count} payment options`;
  const dueDate = formatDueDate(payment.dueDate);
  const paidDate = formatPaidDate(payment.paidAt);
  const statusClass = payment.status.toLowerCase().replace(/_/g, '-');
  // G.4: the latest proof's state. Under review shows when it was received; a rejected proof shows
  // the reason above the form, which is offered again (the request is back to awaiting payment).
  const underReview = payment.status === 'UNDER_REVIEW';
  const received = underReview && payment.proof?.status === 'SUBMITTED' ? formatReceived(payment.proof.submittedAt) : null;
  const rejected = payment.status === 'AWAITING_PAYMENT' && payment.proof?.status === 'REJECTED' && !proofSent ? payment.proof : null;

  return (
    <section className="sdl-payment-card" aria-labelledby="track-payment-title">
      <div className="sdl-payment-head">
        <h3 id="track-payment-title" className="card-section-title">Payment</h3>
        <span className={`sdl-payment-badge is-${statusClass}`}>{STATUS_LABELS[payment.status] ?? STATUS_LABELS.AWAITING_PAYMENT}</span>
      </div>

      <div className="sdl-payment-summary">
        <div className="sdl-payment-amount">
          <span className="sdl-payment-amount-label">Amount due</span>
          <span className="sdl-payment-amount-value">{formatPaymentAmount(payment.amount, payment.currency)}</span>
        </div>
        <p className="sdl-payment-reason">For: {payment.chargeReason}</p>
        {dueDate && !paid && <p className="sdl-payment-due">Due {dueDate}</p>}
        {payment.customerNote && <p className="sdl-payment-note">{payment.customerNote}</p>}
      </div>

      {paid && (
        <p className="sdl-payment-paid">
          <CircleCheck size={20} aria-hidden="true" />
          <span>
            <strong>Payment received</strong>
            {paidDate && <span> · Paid on {paidDate}</span>}
          </span>
        </p>
      )}

      {underReview && (
        <div className="sdl-payment-review" role="status">
          <Clock size={18} aria-hidden="true" />
          <span>
            <strong>Proof under review</strong>
            <span> {received ? `Received ${received.date} at ${received.time}. ` : ''}We'll update this page once it's checked.</span>
          </span>
        </div>
      )}

      {rejected && (
        <div className="sdl-payment-rejected">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            <strong>Proof not accepted{rejected.reason ? `: ${rejected.reason}` : ''}</strong>
            <span> Please check the details and send it again.</span>
          </span>
        </div>
      )}

      {!paid && (
        <p className="sdl-payment-safety">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Pay only to the accounts shown on this page for this shipment.</span>
        </p>
      )}

      {count > 0 && (
        <PaymentTab
          icon={<Wallet size={20} />}
          title={paid ? 'Show payment accounts' : 'How to pay'}
          subtitle={optionsLine}
        >
          <PaymentAccounts methods={payment.methods} onCopied={showToast} />
        </PaymentTab>
      )}

      {proofSent ? (
        <p className="sdl-proof-sent" role="status">
          <CircleCheck size={18} aria-hidden="true" />
          <span>Thank you. We've received your proof of payment and will check it shortly.</span>
        </p>
      ) : payment.status === 'AWAITING_PAYMENT' && count > 0 && (
        <PaymentTab
          icon={<Receipt size={20} />}
          title="Send proof of payment"
          subtitle="Already paid? Upload your receipt so we can confirm it."
          onToggle={(open) => { if (open) setProofTabOpened(true); }}
        >
          {proofTabOpened && (
            <Suspense fallback={null}>
              <PaymentProofForm
                trackingNumber={trackingNumber}
                methods={payment.methods}
                amount={payment.amount}
                currency={payment.currency}
                onSent={(submittedAt) => {
                  setProofSent(true);
                  onProofSent?.(submittedAt);
                }}
              />
            </Suspense>
          )}
        </PaymentTab>
      )}

      <div className={`sdl-payment-toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast}
      </div>
    </section>
  );
};

export default PaymentSection;
