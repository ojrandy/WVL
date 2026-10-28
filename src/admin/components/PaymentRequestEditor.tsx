import React, { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Eye, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { PAYMENT_CURRENCIES, getPaymentCurrency } from '../../shared/currency';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_TYPES,
  customerMethodView,
  getPaymentMethod,
  validatePaymentDetails,
  type CustomerMethodView,
  type PaymentField,
} from '../../shared/paymentMethods';
import {
  ACCOUNT_INSTRUCTIONS_MAX,
  ACCOUNT_LABEL_MAX,
  CHARGE_REASON_MAX,
  CUSTOMER_NOTE_MAX,
  MAX_PAYMENT_ACCOUNTS,
  formatDueDate,
  formatPaymentAmount,
} from '../../shared/paymentRequest';
import { PaymentIcon } from '../../components/PaymentIcon';
import { PaymentMethodCard } from '../../components/PaymentMethodCard';
import { newDraftAccountId, type PaymentAccountDraft, type PaymentRequestDraft } from './paymentRequestDraft';
import './PaymentRequestEditor.css';

// The payment request form (update.md E.2): amount, currency, reason, optional due date, invoice
// link and note, and this shipment's accounts. Controlled: the parent keeps the draft and decides
// when to save (Create Shipment after the ID exists, ShipmentPaymentPanel on its own). A live
// preview shows the customer view with PaymentMethodCard. Labels are CONTENT.md §6.8 (admin).

export interface InvoiceOption {
  id: string;
  label: string;
}

interface PaymentRequestEditorProps {
  value: PaymentRequestDraft;
  onChange: (next: PaymentRequestDraft) => void;
  /** Field errors from validatePaymentRequest or the server, keyed as it keys them. */
  errors?: Record<string, string>;
  /** INVOICE documents of this shipment; the link field is shown only when there are some. */
  invoices?: InvoiceOption[];
}

type Wizard = { queue: string[]; index: number };

function blankAccount(type: string): PaymentAccountDraft {
  return { id: newDraftAccountId(), type, label: '', details: {}, instructions: '' };
}

function accountTitle(account: PaymentAccountDraft) {
  return account.label.trim() || getPaymentMethod(account.type)?.label || 'Payment method';
}

/** First filled-in field, as a one-line reminder in the account list. */
function accountSummary(account: PaymentAccountDraft) {
  const method = getPaymentMethod(account.type);
  const field = method?.fields.find((f) => !f.options && account.details[f.name]?.trim());
  return field ? account.details[field.name].trim() : '';
}

function inputType(field: PaymentField) {
  if (field.kind === 'email') return 'email';
  if (field.kind === 'url') return 'url';
  if (field.kind === 'phone') return 'tel';
  return 'text';
}

const MONO_KINDS = new Set(['crypto', 'iban', 'swift', 'routing', 'sortCode', 'accountNumber']);

export const PaymentRequestEditor: React.FC<PaymentRequestEditorProps> = ({ value, onChange, errors = {}, invoices = [] }) => {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PaymentAccountDraft | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const currency = getPaymentCurrency(value.currency) ?? PAYMENT_CURRENCIES[0];
  const step = currency.minorDigits === 0 ? '1' : (1 / 10 ** currency.minorDigits).toFixed(currency.minorDigits);
  const remaining = MAX_PAYMENT_ACCOUNTS - value.methods.length;
  const set = (patch: Partial<PaymentRequestDraft>) => onChange({ ...value, ...patch });

  const fieldError = (name: string) => errors[name];
  const describe = (name: string, hasError: boolean) => (hasError ? { 'aria-invalid': true, 'aria-describedby': fid(`${name}-err`) } : {});

  // --- Accounts -------------------------------------------------------------------------------

  const openPicker = () => {
    setSelected([]);
    setPickerOpen(true);
    setWizard(null);
    setForm(null);
    setEditingId(null);
  };

  const toggleType = (type: string) => {
    setSelected((list) => list.includes(type)
      ? list.filter((t) => t !== type)
      : list.length < remaining ? [...list, type] : list);
  };

  const startWizard = () => {
    if (selected.length === 0) return;
    setPickerOpen(false);
    setWizard({ queue: selected, index: 0 });
    setForm(blankAccount(selected[0]));
    setFormErrors({});
  };

  const advance = (w: Wizard) => {
    const next = w.index + 1;
    if (next >= w.queue.length) {
      setWizard(null);
      setForm(null);
    } else {
      setWizard({ ...w, index: next });
      setForm(blankAccount(w.queue[next]));
    }
    setFormErrors({});
  };

  /** Checks the account form; returns the account with normalised details, or null. */
  const checkForm = (): PaymentAccountDraft | null => {
    if (!form) return null;
    const result = validatePaymentDetails(form.type, form.details);
    const errs: Record<string, string> = result.ok ? {} : { ...result.errors };
    if (form.label.trim().length > ACCOUNT_LABEL_MAX) errs.label = `Keep it under ${ACCOUNT_LABEL_MAX} characters.`;
    if (form.instructions.trim().length > ACCOUNT_INSTRUCTIONS_MAX) errs.instructions = `Keep it under ${ACCOUNT_INSTRUCTIONS_MAX} characters.`;
    setFormErrors(errs);
    if (!result.ok || Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      window.setTimeout(() => document.getElementById(fid(`acc-${first}`))?.focus(), 0);
      return null;
    }
    return { ...form, details: result.details };
  };

  const addFromWizard = () => {
    if (!wizard) return;
    const account = checkForm();
    if (!account) return;
    onChange({ ...value, methods: [...value.methods, account] });
    advance(wizard);
  };

  const saveEdit = () => {
    const account = checkForm();
    if (!account) return;
    onChange({ ...value, methods: value.methods.map((m) => (m.id === account.id ? account : m)) });
    setEditingId(null);
    setForm(null);
  };

  const cancelForm = () => {
    setWizard(null);
    setEditingId(null);
    setForm(null);
    setFormErrors({});
  };

  const editAccount = (account: PaymentAccountDraft) => {
    setPickerOpen(false);
    setWizard(null);
    setEditingId(account.id);
    setForm({ ...account, details: { ...account.details } });
    setFormErrors({});
  };

  const moveAccount = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.methods.length) return;
    const methods = [...value.methods];
    [methods[index], methods[target]] = [methods[target], methods[index]];
    onChange({ ...value, methods });
  };

  const removeAccount = (account: PaymentAccountDraft) => {
    if (!window.confirm(`Remove ${accountTitle(account)} from this payment request?`)) return;
    onChange({ ...value, methods: value.methods.filter((m) => m.id !== account.id) });
    if (editingId === account.id) cancelForm();
  };

  // --- Preview --------------------------------------------------------------------------------

  const previewMethods = useMemo(() => value.methods
    .map((m) => customerMethodView({ ...m, label: m.label || null, instructions: m.instructions || null }))
    .filter((m): m is CustomerMethodView => m !== null), [value.methods]);
  const formPreview = form ? customerMethodView({ ...form, label: form.label || null, instructions: form.instructions || null }) : null;
  const amountNumber = Number(value.amount);
  const amountText = value.amount.trim() && Number.isFinite(amountNumber) && amountNumber > 0
    ? formatPaymentAmount(amountNumber, currency.code)
    : `${currency.code} —`;

  // Enter in a single-line field must never submit the shipment form around the editor.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
  };

  const formMethod = form ? getPaymentMethod(form.type) : null;
  const formHeading = form && formMethod
    ? wizard
      ? `Account ${wizard.index + 1} of ${wizard.queue.length} · ${formMethod.label}`
      : `Edit ${formMethod.label}`
    : '';

  return (
    <div className="sdl-payreq" onKeyDown={onKeyDown}>
      <div className="sdl-payreq-layout">
        <div className="sdl-payreq-main">
          <div className="sdl-payreq-grid">
            <div className="sdl-payreq-field">
              <label htmlFor={fid('amount')}>Amount (required)</label>
              <input
                id={fid('amount')}
                type="number"
                inputMode="decimal"
                min={0}
                step={step}
                value={value.amount}
                placeholder={currency.minorDigits === 0 ? '12000' : `120.${'0'.repeat(currency.minorDigits)}`}
                onChange={(e) => set({ amount: e.target.value })}
                {...describe('amount', !!fieldError('amount'))}
              />
              {fieldError('amount') && <span id={fid('amount-err')} className="sdl-payreq-error">{fieldError('amount')}</span>}
            </div>
            <div className="sdl-payreq-field">
              <label htmlFor={fid('currency')}>Currency</label>
              <select id={fid('currency')} value={currency.code} onChange={(e) => set({ currency: e.target.value as PaymentRequestDraft['currency'] })} {...describe('currency', !!fieldError('currency'))}>
                {PAYMENT_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} – {c.name}</option>)}
              </select>
              {fieldError('currency') && <span id={fid('currency-err')} className="sdl-payreq-error">{fieldError('currency')}</span>}
            </div>
          </div>

          <div className="sdl-payreq-field">
            <label htmlFor={fid('chargeReason')}>What is this payment for? (required)</label>
            <input
              id={fid('chargeReason')}
              type="text"
              maxLength={CHARGE_REASON_MAX}
              value={value.chargeReason}
              placeholder="e.g. Customs duty – Invoice WVL-INV-104233"
              onChange={(e) => set({ chargeReason: e.target.value })}
              {...describe('chargeReason', !!fieldError('chargeReason'))}
            />
            <span className="sdl-payreq-count">{value.chargeReason.length}/{CHARGE_REASON_MAX}</span>
            {fieldError('chargeReason') && <span id={fid('chargeReason-err')} className="sdl-payreq-error">{fieldError('chargeReason')}</span>}
          </div>

          <div className="sdl-payreq-grid">
            <div className="sdl-payreq-field">
              <label htmlFor={fid('dueDate')}>Due date (optional)</label>
              <input id={fid('dueDate')} type="date" value={value.dueDate} onChange={(e) => set({ dueDate: e.target.value })} {...describe('dueDate', !!fieldError('dueDate'))} />
              {fieldError('dueDate') && <span id={fid('dueDate-err')} className="sdl-payreq-error">{fieldError('dueDate')}</span>}
            </div>
            {(invoices.length > 0 || value.invoiceDocumentId) && (
              <div className="sdl-payreq-field">
                <label htmlFor={fid('invoice')}>Linked invoice (optional)</label>
                <select id={fid('invoice')} value={value.invoiceDocumentId} onChange={(e) => set({ invoiceDocumentId: e.target.value })} {...describe('invoiceDocumentId', !!fieldError('invoiceDocumentId'))}>
                  <option value="">No linked invoice</option>
                  {invoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.label}</option>)}
                  {value.invoiceDocumentId && !invoices.some((i) => i.id === value.invoiceDocumentId) && (
                    <option value={value.invoiceDocumentId}>{value.invoiceDocumentId}</option>
                  )}
                </select>
                {fieldError('invoiceDocumentId') && <span id={fid('invoiceDocumentId-err')} className="sdl-payreq-error">{fieldError('invoiceDocumentId')}</span>}
              </div>
            )}
          </div>

          <div className="sdl-payreq-field">
            <label htmlFor={fid('customerNote')}>Note for the customer (optional)</label>
            <textarea
              id={fid('customerNote')}
              rows={2}
              maxLength={CUSTOMER_NOTE_MAX}
              value={value.customerNote}
              onChange={(e) => set({ customerNote: e.target.value })}
              {...describe('customerNote', !!fieldError('customerNote'))}
            />
            <span className="sdl-payreq-count">{value.customerNote.length}/{CUSTOMER_NOTE_MAX}</span>
            {fieldError('customerNote') && <span id={fid('customerNote-err')} className="sdl-payreq-error">{fieldError('customerNote')}</span>}
          </div>

          <section className="sdl-payreq-accounts" aria-labelledby={fid('accounts-title')}>
            <div className="sdl-payreq-accounts-head">
              <h4 id={fid('accounts-title')}>Payment methods ({value.methods.length}/{MAX_PAYMENT_ACCOUNTS})</h4>
              {!pickerOpen && !form && remaining > 0 && (
                <button type="button" className="sdl-payreq-btn is-primary" onClick={openPicker}>
                  <Plus size={14} aria-hidden="true" /> Add payment methods
                </button>
              )}
            </div>
            {fieldError('methods') && <p className="sdl-payreq-error" role="alert">{fieldError('methods')}</p>}

            {value.methods.length === 0 && !pickerOpen && !form && (
              <p className="sdl-payreq-empty">No payment methods yet. Add at least one.</p>
            )}

            {value.methods.length > 0 && (
              <ul className="sdl-payreq-list">
                {value.methods.map((account, index) => {
                  const accountErrors = Object.entries(errors).filter(([k]) => k.startsWith(`methods.${index}.`)).map(([, v]) => v);
                  const method = getPaymentMethod(account.type);
                  return (
                    <li key={account.id} className={`sdl-payreq-item${accountErrors.length ? ' has-error' : ''}${editingId === account.id ? ' is-editing' : ''}`}>
                      <span className="sdl-payreq-item-icon"><PaymentIcon type={account.type} size={22} /></span>
                      <div className="sdl-payreq-item-body">
                        <strong>{accountTitle(account)}</strong>
                        <span>{account.label.trim() && method ? `${method.label} · ` : ''}{accountSummary(account)}</span>
                        {accountErrors.length > 0 && <span className="sdl-payreq-error">Check this account: {accountErrors[0]}</span>}
                      </div>
                      <div className="sdl-payreq-item-actions">
                        <button type="button" className="sdl-payreq-btn" onClick={() => editAccount(account)} aria-label={`Edit ${accountTitle(account)}`}>
                          <Pencil size={14} aria-hidden="true" /> <span>Edit</span>
                        </button>
                        <button type="button" className="sdl-payreq-btn" onClick={() => moveAccount(index, -1)} disabled={index === 0} aria-label={`Move ${accountTitle(account)} earlier`}>
                          <ArrowUp size={14} aria-hidden="true" />
                        </button>
                        <button type="button" className="sdl-payreq-btn" onClick={() => moveAccount(index, 1)} disabled={index === value.methods.length - 1} aria-label={`Move ${accountTitle(account)} later`}>
                          <ArrowDown size={14} aria-hidden="true" />
                        </button>
                        <button type="button" className="sdl-payreq-btn is-danger" onClick={() => removeAccount(account)} aria-label={`Remove ${accountTitle(account)}`}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {pickerOpen && (
              <div className="sdl-payreq-picker" role="group" aria-labelledby={fid('picker-title')}>
                <p id={fid('picker-title')} className="sdl-payreq-picker-title">Choose payment methods</p>
                <p className="sdl-payreq-hint">
                  Offer 3–5 methods your customer can use. At least 1.
                </p>
                <p className="sdl-payreq-hint" aria-live="polite">
                  {selected.length} selected · {remaining - selected.length} {remaining - selected.length === 1 ? 'slot' : 'slots'} left
                </p>
                <div className="sdl-payreq-tiles">
                  {PAYMENT_METHOD_TYPES.map((type) => {
                    const on = selected.includes(type);
                    const full = !on && selected.length >= remaining;
                    return (
                      <button
                        key={type}
                        type="button"
                        className={`sdl-payreq-tile${on ? ' is-on' : ''}`}
                        aria-pressed={on}
                        disabled={full}
                        onClick={() => toggleType(type)}
                      >
                        <span className={`sdl-payreq-tile-check${on ? ' is-on' : ''}`} aria-hidden="true">{on && <Check size={12} />}</span>
                        <PaymentIcon type={type} size={22} />
                        <span className="sdl-payreq-tile-name">{PAYMENT_METHODS[type].label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="sdl-payreq-row-actions">
                  <button type="button" className="sdl-payreq-btn is-primary" onClick={startWizard} disabled={selected.length === 0}>
                    Continue with {selected.length} {selected.length === 1 ? 'method' : 'methods'}
                  </button>
                  <button type="button" className="sdl-payreq-btn" onClick={() => setPickerOpen(false)}>Cancel</button>
                </div>
              </div>
            )}

            {form && formMethod && (
              <div className="sdl-payreq-form" role="group" aria-labelledby={fid('form-title')}>
                <p id={fid('form-title')} className="sdl-payreq-form-title">
                  <PaymentIcon type={form.type} size={20} /> {formHeading}
                </p>
                {(formMethod.eitherOr ?? []).map((group) => (
                  <p key={group.join('|')} className="sdl-payreq-hint">
                    Fill in {group.map((n) => formMethod.fields.find((f) => f.name === n)?.label ?? n).join(' or ')}.
                  </p>
                ))}
                <div className="sdl-payreq-form-fields">
                  {formMethod.fields.map((field) => {
                    const err = formErrors[field.name];
                    const id = fid(`acc-${field.name}`);
                    const common = {
                      id,
                      value: form.details[field.name] ?? '',
                      ...(err ? { 'aria-invalid': true, 'aria-describedby': `${id}-err` } : {}),
                    };
                    const update = (v: string) => setForm({ ...form, details: { ...form.details, [field.name]: v } });
                    return (
                      <div key={field.name} className="sdl-payreq-field">
                        <label htmlFor={id}>{field.label}{field.required ? ' (required)' : ''}</label>
                        {field.options ? (
                          <select {...common} onChange={(e) => update(e.target.value)}>
                            <option value="">Choose…</option>
                            {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input
                            {...common}
                            type={inputType(field)}
                            className={MONO_KINDS.has(field.kind) ? 'is-mono' : undefined}
                            placeholder={field.placeholder}
                            autoComplete="off"
                            autoCapitalize={MONO_KINDS.has(field.kind) || field.kind === 'email' || field.kind === 'url' ? 'off' : undefined}
                            spellCheck={false}
                            onChange={(e) => update(e.target.value)}
                          />
                        )}
                        {err && <span id={`${id}-err`} className="sdl-payreq-error">{err}</span>}
                      </div>
                    );
                  })}
                  <div className="sdl-payreq-field">
                    <label htmlFor={fid('acc-label')}>Display label (optional)</label>
                    <input
                      id={fid('acc-label')}
                      type="text"
                      maxLength={ACCOUNT_LABEL_MAX}
                      value={form.label}
                      placeholder="e.g. Business account"
                      onChange={(e) => setForm({ ...form, label: e.target.value })}
                      {...(formErrors.label ? { 'aria-invalid': true, 'aria-describedby': fid('acc-label-err') } : {})}
                    />
                    {formErrors.label && <span id={fid('acc-label-err')} className="sdl-payreq-error">{formErrors.label}</span>}
                  </div>
                  <div className="sdl-payreq-field is-wide">
                    <label htmlFor={fid('acc-instructions')}>Instructions for the customer (optional)</label>
                    <textarea
                      id={fid('acc-instructions')}
                      rows={2}
                      maxLength={ACCOUNT_INSTRUCTIONS_MAX}
                      value={form.instructions}
                      onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                      {...(formErrors.instructions ? { 'aria-invalid': true, 'aria-describedby': fid('acc-instructions-err') } : {})}
                    />
                    {formErrors.instructions && <span id={fid('acc-instructions-err')} className="sdl-payreq-error">{formErrors.instructions}</span>}
                  </div>
                </div>
                <div className="sdl-payreq-row-actions">
                  {wizard ? (
                    <>
                      <button type="button" className="sdl-payreq-btn is-primary" onClick={addFromWizard}>
                        {wizard.index + 1 < wizard.queue.length ? 'Add and continue' : 'Add account'}
                      </button>
                      <button type="button" className="sdl-payreq-btn" onClick={() => advance(wizard)}>Skip</button>
                      <button type="button" className="sdl-payreq-btn" onClick={cancelForm}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="sdl-payreq-btn is-primary" onClick={saveEdit}>Save account</button>
                      <button type="button" className="sdl-payreq-btn" onClick={cancelForm}>Cancel</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="sdl-payreq-preview" aria-labelledby={fid('preview-title')}>
          <p id={fid('preview-title')} className="sdl-payreq-preview-title"><Eye size={13} aria-hidden="true" /> Customer preview</p>
          <div className="sdl-payreq-preview-summary">
            <span className="sdl-payreq-preview-label">Amount due</span>
            <strong className="sdl-payreq-preview-amount">{amountText}</strong>
            {value.chargeReason.trim() && <span className="sdl-payreq-preview-reason">For: {value.chargeReason.trim()}</span>}
            {value.dueDate && formatDueDate(value.dueDate) && <span className="sdl-payreq-preview-due">Due {formatDueDate(value.dueDate)}</span>}
            {value.customerNote.trim() && <p className="sdl-payreq-preview-note">{value.customerNote.trim()}</p>}
          </div>
          {previewMethods.length === 0 && !formPreview ? (
            <p className="sdl-payreq-empty"><Wallet size={13} aria-hidden="true" /> Add a payment method to see the customer view.</p>
          ) : (
            <div className="sdl-payreq-preview-cards">
              {previewMethods.map((m) => (editingId === m.id && formPreview
                ? <div key={m.id} className="sdl-payreq-preview-draft"><PaymentMethodCard method={formPreview} /></div>
                : <PaymentMethodCard key={m.id} method={m} />))}
              {wizard && formPreview && formPreview.fields.length > 0 && (
                <div className="sdl-payreq-preview-draft">
                  <PaymentMethodCard key={`draft-${form!.id}`} method={formPreview} />
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default PaymentRequestEditor;
