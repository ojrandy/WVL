import React, { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Save, Trash2, Wallet } from 'lucide-react';
import { api } from '../../services/api';
import { formatDueDate, formatPaymentAmount, validatePaymentRequest, type AdminPaymentRequest, type PaymentStatus, type PaymentStatusAction } from '../../shared/paymentRequest';
import { getPaymentMethod } from '../../shared/paymentMethods';
import { PaymentIcon } from '../../components/PaymentIcon';
import { PaymentRequestEditor, type InvoiceOption } from './PaymentRequestEditor';
import { draftFromRequest, emptyPaymentDraft, type PaymentRequestDraft } from './paymentRequestDraft';
import './ShipmentPaymentPanel.css';

// The payment request of one existing shipment, in Edit Shipment (update.md E.4). Saved on its own
// through the admin payment routes, independent of the shipment form around it ("Save Changes"
// never touches it). Labels are CONTENT.md §6.8 (admin).

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  UNDER_REVIEW: 'Proof under review',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

// Status changes (E.5), each confirmed first. The server re-checks the transition.
const STATUS_ACTIONS: Record<PaymentStatusAction, { confirm: string; done: string }> = {
  cancel: {
    confirm: 'Cancel this payment request? The tracking page stops showing it until you reopen it.',
    done: 'Payment request cancelled.',
  },
  mark_paid: {
    confirm: 'Mark this payment request as paid? Use this when the payment was confirmed outside the tracking page. A linked invoice is marked paid too.',
    done: 'Payment request marked as paid.',
  },
  reopen: {
    confirm: 'Reopen this payment request? It goes back to awaiting payment, and a linked invoice that was marked paid goes back to pending.',
    done: 'Payment request reopened.',
  },
};

interface ShipmentPaymentPanelProps {
  trackingNumber: string;
}

export const ShipmentPaymentPanel: React.FC<ShipmentPaymentPanelProps> = ({ trackingNumber }) => {
  const [request, setRequest] = useState<AdminPaymentRequest | null>(null);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PaymentRequestDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [payment, docs] = await Promise.all([
        api.getShipmentPayment(trackingNumber),
        api.getDocuments({ docType: 'INVOICE' }).catch(() => []),
      ]);
      setRequest(payment);
      setInvoices(docs
        .filter((d) => d.docType === 'INVOICE' && d.shipmentTracking === trackingNumber)
        .map((d) => ({ id: d.id, label: `${d.id} · ${d.title}` })));
    } catch (err: any) {
      setLoadError(err?.message || 'the server did not respond');
    } finally {
      setLoading(false);
    }
  }, [trackingNumber]);

  useEffect(() => { load(); }, [load]);

  const startEdit = () => {
    setDraft(request ? draftFromRequest(request) : emptyPaymentDraft());
    setErrors({});
    setMessage(null);
  };

  const cancelEdit = () => {
    setDraft(null);
    setErrors({});
  };

  const save = async () => {
    if (!draft) return;
    const result = validatePaymentRequest(draft);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage({ tone: 'error', text: 'Check the highlighted fields.' });
      return;
    }
    setBusy(true);
    try {
      const saved = await api.saveShipmentPayment(trackingNumber, draft);
      setRequest(saved);
      setDraft(null);
      setErrors({});
      setMessage({ tone: 'info', text: 'Payment request saved.' });
    } catch (err: any) {
      if (err?.errors) setErrors(err.errors);
      setMessage({ tone: 'error', text: `The payment request wasn't saved: ${err?.message || 'the server did not respond'}.` });
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (action: PaymentStatusAction) => {
    if (!window.confirm(STATUS_ACTIONS[action].confirm)) return;
    setBusy(true);
    try {
      setRequest(await api.setShipmentPaymentStatus(trackingNumber, action));
      setMessage({ tone: 'info', text: STATUS_ACTIONS[action].done });
    } catch (err: any) {
      setMessage({ tone: 'error', text: `The status wasn't changed: ${err?.message || 'the server did not respond'}.` });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this payment request? Customers will no longer see it on the tracking page.')) return;
    setBusy(true);
    try {
      await api.deleteShipmentPayment(trackingNumber);
      setRequest(null);
      setDraft(null);
      setMessage({ tone: 'info', text: 'Payment request deleted.' });
    } catch (err: any) {
      setMessage({ tone: 'error', text: `The payment request wasn't deleted: ${err?.message || 'the server did not respond'}.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sdl-paypanel">
      <div className="sdl-paypanel-head">
        <Wallet size={13} className="text-accent" aria-hidden="true" />
        <span>Payment request</span>
        <span className="sdl-paypanel-public">Shown to the customer</span>
      </div>
      <p className="sdl-paypanel-hint">
        The amount, reason and payment accounts appear on this shipment's tracking page. Saved on its own, not by "Save Changes".
      </p>

      <div className="sdl-paypanel-status" role="status" aria-live="polite">
        {message && <span className={`sdl-paypanel-msg is-${message.tone}`}>{message.text}</span>}
      </div>

      {loading ? (
        <p className="sdl-paypanel-empty"><Loader2 size={13} className="sdl-paypanel-spin" aria-hidden="true" /> Loading payment request…</p>
      ) : loadError ? (
        <div className="sdl-paypanel-msg is-error sdl-paypanel-loaderr" role="alert">
          <span>The payment request couldn't be loaded: {loadError}.</span>
          <button type="button" className="sdl-payreq-btn" onClick={load}>
            <RefreshCw size={14} aria-hidden="true" /> <span>Try again</span>
          </button>
        </div>
      ) : draft ? (
        <>
          <PaymentRequestEditor value={draft} onChange={setDraft} errors={errors} invoices={invoices} />
          <div className="sdl-paypanel-actions">
            <button type="button" className="sdl-payreq-btn is-primary" onClick={save} disabled={busy}>
              {busy ? <Loader2 size={14} className="sdl-paypanel-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
              <span>{busy ? 'Saving…' : 'Save payment request'}</span>
            </button>
            <button type="button" className="sdl-payreq-btn" onClick={cancelEdit} disabled={busy}>Cancel</button>
          </div>
        </>
      ) : request ? (
        <div className="sdl-paypanel-summary">
          <div className="sdl-paypanel-summary-top">
            <strong className="sdl-paypanel-amount">{formatPaymentAmount(request.amount, request.currency)}</strong>
            <span className={`sdl-paypanel-pill is-${request.status.toLowerCase()}`}>{PAYMENT_STATUS_LABELS[request.status] ?? request.status}</span>
          </div>
          <span className="sdl-paypanel-line">For: {request.chargeReason}</span>
          {request.dueDate && <span className="sdl-paypanel-line">Due {formatDueDate(request.dueDate)}</span>}
          {request.invoiceDocumentId && <span className="sdl-paypanel-line">Linked invoice: {request.invoiceDocumentId}</span>}
          {request.status === 'PAID' && request.paidAt && (
            <span className="sdl-paypanel-line">Paid {new Date(request.paidAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          )}
          <ul className="sdl-paypanel-methods">
            {request.methods.map((m) => (
              <li key={m.id}>
                <PaymentIcon type={m.type} size={16} />
                <span>{m.label || getPaymentMethod(m.type)?.label || m.type}</span>
              </li>
            ))}
          </ul>
          <div className="sdl-paypanel-actions">
            <button type="button" className="sdl-payreq-btn" onClick={startEdit} disabled={busy}>
              <Pencil size={14} aria-hidden="true" /> <span>Edit payment request</span>
            </button>
            {(request.status === 'AWAITING_PAYMENT' || request.status === 'UNDER_REVIEW') && (
              <>
                <button type="button" className="sdl-payreq-btn" onClick={() => changeStatus('mark_paid')} disabled={busy}>
                  <CheckCircle2 size={14} aria-hidden="true" /> <span>Mark paid manually</span>
                </button>
                <button type="button" className="sdl-payreq-btn" onClick={() => changeStatus('cancel')} disabled={busy}>
                  <Ban size={14} aria-hidden="true" /> <span>Cancel request</span>
                </button>
              </>
            )}
            {(request.status === 'PAID' || request.status === 'CANCELLED') && (
              <button type="button" className="sdl-payreq-btn" onClick={() => changeStatus('reopen')} disabled={busy}>
                <RotateCcw size={14} aria-hidden="true" /> <span>Reopen</span>
              </button>
            )}
            <button type="button" className="sdl-payreq-btn is-danger" onClick={remove} disabled={busy}>
              <Trash2 size={14} aria-hidden="true" /> <span>Delete</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="sdl-paypanel-none">
          <p className="sdl-paypanel-empty">No payment request.</p>
          <button type="button" className="sdl-payreq-btn is-primary" onClick={startEdit}>
            <Plus size={14} aria-hidden="true" /> <span>Add payment request</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default ShipmentPaymentPanel;
