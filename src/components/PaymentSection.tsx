import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleCheck, ShieldCheck, Wallet } from 'lucide-react';
import { formatDueDate, formatPaymentAmount, type PublicPayment } from '../shared/paymentRequest';
import type { CustomerMethodView } from '../shared/paymentMethods';
import { PaymentIcon } from './PaymentIcon';
import { PaymentMethodCard } from './PaymentMethodCard';
import { PaymentTab } from './PaymentTab';
import './PaymentSection.css';

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
}

export const PaymentSection: React.FC<PaymentSectionProps> = ({ payment }) => {
  const [toast, setToast] = useState('');
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

      <div className={`sdl-payment-toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast}
      </div>
    </section>
  );
};

export default PaymentSection;
