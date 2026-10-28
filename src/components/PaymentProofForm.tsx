import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, Loader2, Send } from 'lucide-react';
import { api } from '../services/api';
import { compressImage, ImageCompressError, type CompressedImage } from '../services/imageCompress';
import { getPaymentCurrency } from '../shared/currency';
import type { CustomerMethodView } from '../shared/paymentMethods';
import {
  PAYER_NAME_MAX,
  PROOF_ERROR_MESSAGES,
  PROOF_IMAGE_MESSAGES,
  PROOF_REFERENCE_MAX,
  validateProofFields,
} from '../shared/paymentProof';
import './PaymentProofForm.css';

// The customer's proof of payment on the track page (update.md G.3, copy CONTENT.md §6.8). Sits
// in the "Send proof of payment" tab while the request awaits payment. The same rules as
// POST /api/track/:id/payment-proof (validateProofFields); the screenshot is compressed and
// stripped of EXIF/GPS in the browser first (imageCompress, B.3).

type FieldName = 'methodId' | 'payerName' | 'amountSent' | 'reference' | 'image';
type Errors = Partial<Record<FieldName, string>>;

const FIELD_ORDER: FieldName[] = ['methodId', 'payerName', 'amountSent', 'reference', 'image'];
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

interface PaymentProofFormProps {
  trackingNumber: string;
  methods: CustomerMethodView[];
  amount: number;
  currency: string;
  onSent: (submittedAt: string) => void;
}

function compressMessage(err: unknown): string {
  if (err instanceof ImageCompressError) {
    if (err.code === 'NOT_IMAGE') return PROOF_IMAGE_MESSAGES.notImage;
    if (err.code === 'TOO_LARGE') return PROOF_IMAGE_MESSAGES.tooLarge;
  }
  return PROOF_IMAGE_MESSAGES.unreadable;
}

export const PaymentProofForm: React.FC<PaymentProofFormProps> = ({ trackingNumber, methods, amount, currency, onSent }) => {
  const id = useId();
  const digits = getPaymentCurrency(currency)?.minorDigits ?? 2;
  const [methodId, setMethodId] = useState(methods.length === 1 ? methods[0].id : '');
  const [payerName, setPayerName] = useState('');
  const [amountSent, setAmountSent] = useState(amount.toFixed(digits));
  const [reference, setReference] = useState('');
  const [image, setImage] = useState<CompressedImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [checked, setChecked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fieldRefs = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});

  // The chosen account may disappear when the courier edits the request; the poll brings that in.
  useEffect(() => {
    if (methodId && !methods.some((m) => m.id === methodId)) setMethodId(methods.length === 1 ? methods[0].id : '');
  }, [methods, methodId]);

  const validate = (values = { methodId, payerName, amountSent, reference }, img = image): Errors => {
    const result = validateProofFields(values, { methodIds: methods.map((m) => m.id), currency });
    const next: Errors = result.ok ? {} : { ...result.errors };
    if (!img) next.image = PROOF_IMAGE_MESSAGES.missing;
    return next;
  };

  // Once the form has been checked, errors follow every edit instead of waiting for the next send.
  const update = <K extends 'methodId' | 'payerName' | 'amountSent' | 'reference'>(field: K, value: string) => {
    const values = { methodId, payerName, amountSent, reference, [field]: value };
    if (field === 'methodId') setMethodId(value);
    if (field === 'payerName') setPayerName(value);
    if (field === 'amountSent') setAmountSent(value);
    if (field === 'reference') setReference(value);
    if (checked) setErrors(validate(values));
  };

  const focusFirst = (errs: Errors) => {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (first) fieldRefs.current[first]?.focus();
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setPreparing(true);
    setErrors((prev) => ({ ...prev, image: undefined }));
    try {
      const compressed = await compressImage(file);
      setImage(compressed);
      if (checked) setErrors(validate(undefined, compressed));
    } catch (err) {
      setErrors((prev) => ({ ...prev, image: compressMessage(err) }));
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeImage = () => {
    setImage(null);
    if (checked) setErrors((prev) => ({ ...prev, image: PROOF_IMAGE_MESSAGES.missing }));
    // Focus moves to "Choose screenshot", which replaces the preview on the next render.
    requestAnimationFrame(() => fieldRefs.current.image?.focus());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || preparing) return;
    setChecked(true);
    setFormError('');
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) {
      focusFirst(errs);
      return;
    }
    setSending(true);
    try {
      const result = await api.submitPaymentProof(trackingNumber, {
        methodId, payerName, amountSent, reference, image: image!.base64,
      });
      onSent(result.proof.submittedAt);
    } catch (err: any) {
      if (err?.status === 400 && err.errors) {
        const serverErrors: Errors = {};
        for (const f of FIELD_ORDER) if (err.errors[f]) serverErrors[f] = err.errors[f];
        setErrors(serverErrors);
        focusFirst(serverErrors);
      } else if (err?.code && err.code in PROOF_ERROR_MESSAGES) {
        setFormError(PROOF_ERROR_MESSAGES[err.code as keyof typeof PROOF_ERROR_MESSAGES]);
      } else {
        setFormError(PROOF_ERROR_MESSAGES.FAILED);
      }
    } finally {
      setSending(false);
    }
  };

  const fieldProps = (field: FieldName, hintId?: string) => ({
    id: `${id}-${field}`,
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': [hintId, errors[field] ? `${id}-${field}-error` : ''].filter(Boolean).join(' ') || undefined,
    ref: (el: HTMLElement | null) => { fieldRefs.current[field] = el; },
  });

  const errorLine = (field: FieldName) => errors[field] && (
    <p id={`${id}-${field}-error`} className="sdl-proof-error">
      <AlertCircle size={14} aria-hidden="true" />
      <span>{errors[field]}</span>
    </p>
  );

  return (
    <form className="sdl-proof-form" onSubmit={submit} noValidate>
      {formError && (
        <div className="sdl-proof-alert" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{formError}</span>
        </div>
      )}

      <div className="sdl-proof-field">
        <label htmlFor={`${id}-methodId`}>Payment method used</label>
        <select
          className="sdl-proof-input"
          value={methodId}
          onChange={(e) => update('methodId', e.target.value)}
          {...fieldProps('methodId')}
        >
          {methods.length !== 1 && <option value="">Choose…</option>}
          {methods.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title === m.methodLabel ? m.title : `${m.title} (${m.methodLabel})`}
            </option>
          ))}
        </select>
        {errorLine('methodId')}
      </div>

      <div className="sdl-proof-row">
        <div className="sdl-proof-field">
          <label htmlFor={`${id}-payerName`}>Your name (as on the payment)</label>
          <input
            className="sdl-proof-input"
            type="text"
            autoComplete="name"
            maxLength={PAYER_NAME_MAX}
            value={payerName}
            onChange={(e) => update('payerName', e.target.value)}
            {...fieldProps('payerName')}
          />
          {errorLine('payerName')}
        </div>

        <div className="sdl-proof-field">
          <label htmlFor={`${id}-amountSent`}>Amount sent ({currency})</label>
          <input
            className="sdl-proof-input font-mono"
            type="text"
            inputMode={digits === 0 ? 'numeric' : 'decimal'}
            autoComplete="off"
            value={amountSent}
            onChange={(e) => update('amountSent', e.target.value)}
            {...fieldProps('amountSent')}
          />
          {errorLine('amountSent')}
        </div>
      </div>

      <div className="sdl-proof-field">
        <label htmlFor={`${id}-reference`}>Reference <span className="sdl-proof-optional">(optional)</span></label>
        <input
          className="sdl-proof-input font-mono"
          type="text"
          autoComplete="off"
          maxLength={PROOF_REFERENCE_MAX}
          value={reference}
          onChange={(e) => update('reference', e.target.value)}
          {...fieldProps('reference', `${id}-reference-hint`)}
        />
        <p id={`${id}-reference-hint`} className="sdl-proof-hint">Transaction ID, MTCN or transaction hash</p>
        {errorLine('reference')}
      </div>

      <div className="sdl-proof-field">
        <span className="sdl-proof-label" id={`${id}-image-label`}>Screenshot of your payment</span>
        <p id={`${id}-image-hint`} className="sdl-proof-hint">JPG, PNG, WebP or HEIC · resized and location data removed before upload</p>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="sdl-proof-file"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => chooseFile(e.target.files?.[0])}
        />
        {image ? (
          <div className="sdl-proof-preview">
            <img
              src={`data:${image.mimeType};base64,${image.base64}`}
              alt="Screenshot of your payment"
              width={image.width}
              height={image.height}
            />
            <div className="sdl-proof-preview-actions">
              <button
                type="button"
                className="sdl-proof-btn"
                onClick={() => fileRef.current?.click()}
                disabled={preparing || sending}
                aria-label="Change screenshot"
                {...fieldProps('image')}
              >
                Change
              </button>
              <button type="button" className="sdl-proof-btn" onClick={removeImage} disabled={preparing || sending} aria-label="Remove screenshot">
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="sdl-proof-choose"
            onClick={() => fileRef.current?.click()}
            disabled={preparing || sending}
            aria-labelledby={`${id}-image-label ${id}-image-choose`}
            {...fieldProps('image', `${id}-image-hint`)}
          >
            {preparing ? <Loader2 size={18} className="sdl-proof-spin" aria-hidden="true" /> : <ImagePlus size={18} aria-hidden="true" />}
            <span id={`${id}-image-choose`}>Choose screenshot</span>
          </button>
        )}
        {errorLine('image')}
      </div>

      <button type="submit" className="sdl-btn-primary sdl-proof-submit" disabled={sending || preparing}>
        {sending ? <Loader2 size={18} className="sdl-proof-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
        <span>{sending ? 'Sending…' : 'Send proof of payment'}</span>
      </button>
    </form>
  );
};

export default PaymentProofForm;
