import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Info, QrCode } from 'lucide-react';
import type { CustomerMethodView } from '../shared/paymentMethods';
import { PaymentIcon } from './PaymentIcon';
import './PaymentMethodCard.css';

interface PaymentMethodCardProps {
  method: CustomerMethodView;
  /**
   * Called after a field is copied, with its label, so the page can show its own toast. Without it the
   * card announces "{Field} copied" itself.
   */
  onCopied?: (fieldLabel: string) => void;
}

const COPIED_MS = 2000;

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea method (permission denied, older browsers).
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  } catch {
    return false;
  }
}

// The customer view of one payment account (update.md D.3): icon + name, each field with Copy, the
// link button, the network warning or note, the courier's instructions and a QR code on request.
// Used by the track page and the admin preview. Copy is from CONTENT.md §6.7.
export const PaymentMethodCard: React.FC<PaymentMethodCardProps> = ({ method, onCopied }) => {
  const uid = useId();
  const titleId = `${uid}-title`;
  const qrId = `${uid}-qr`;
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const copiedTimer = useRef<number>();

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // The QR library is its own chunk, fetched only when a QR code is first opened.
  useEffect(() => {
    if (!qrOpen || !method.qr || qrDataUrl) return;
    let cancelled = false;
    setQrFailed(false);
    import('qrcode')
      .then((QRCode) => QRCode.toDataURL(method.qr!, { width: 360, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } }))
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrFailed(true); });
    return () => { cancelled = true; };
  }, [qrOpen, method.qr, qrDataUrl]);

  useEffect(() => { setQrDataUrl(null); }, [method.qr]);

  const handleCopy = async (name: string, label: string, value: string) => {
    const done = await copyText(value);
    window.clearTimeout(copiedTimer.current);
    if (!done) {
      setCopiedField(null);
      setAnnouncement('Couldn\'t copy. Select the text and copy it instead.');
      return;
    }
    setCopiedField(name);
    if (onCopied) onCopied(label);
    else setAnnouncement(`${label} copied`);
    copiedTimer.current = window.setTimeout(() => {
      setCopiedField(null);
      setAnnouncement('');
    }, COPIED_MS);
  };

  return (
    <article className="sdl-paycard" aria-labelledby={titleId}>
      <header className="sdl-paycard-head">
        <span className="sdl-paycard-icon">
          <PaymentIcon type={method.type} size={26} />
        </span>
        <div className="sdl-paycard-titles">
          <h3 id={titleId} className="sdl-paycard-title">{method.title}</h3>
          {method.title !== method.methodLabel && <p className="sdl-paycard-method">{method.methodLabel}</p>}
        </div>
      </header>

      {method.warning && (
        <p className="sdl-paycard-warning">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{method.warning}</span>
        </p>
      )}

      <dl className="sdl-paycard-fields">
        {method.fields.map((field) => (
          <div className="sdl-paycard-field" key={field.name}>
            <dt>{field.label}</dt>
            <dd>
              <span className="sdl-paycard-value">{field.value}</span>
              {field.copyable && (
                <button
                  type="button"
                  className={`sdl-paycard-copy${copiedField === field.name ? ' is-copied' : ''}`}
                  aria-label={`Copy ${field.label}`}
                  onClick={() => handleCopy(field.name, field.label, field.copyValue)}
                >
                  {copiedField === field.name
                    ? <><Check size={14} aria-hidden="true" /> Copied</>
                    : <><Copy size={14} aria-hidden="true" /> Copy</>}
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {method.link && (
        <a className="sdl-btn-primary sdl-paycard-link" href={method.link.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={16} aria-hidden="true" />
          {method.link.label}
        </a>
      )}

      {method.note && (
        <p className="sdl-paycard-note">
          <Info size={16} aria-hidden="true" />
          <span>{method.note}</span>
        </p>
      )}

      {method.instructions && (
        <div className="sdl-paycard-instructions">
          <h4>Instructions</h4>
          <p>{method.instructions}</p>
        </div>
      )}

      {method.qr && (
        <div className="sdl-paycard-qr">
          <button
            type="button"
            className="sdl-paycard-qr-toggle"
            aria-expanded={qrOpen}
            aria-controls={qrId}
            onClick={() => setQrOpen((open) => !open)}
          >
            <QrCode size={16} aria-hidden="true" />
            {qrOpen ? 'Hide QR code' : 'Show QR code'}
          </button>
          <div id={qrId} className="sdl-paycard-qr-box" hidden={!qrOpen}>
            {qrOpen && (qrDataUrl
              ? <img src={qrDataUrl} width={180} height={180} alt={`QR code for ${method.title}`} />
              : <span className="sdl-paycard-qr-status">{qrFailed ? 'Couldn\'t load the QR code.' : 'Loading QR code…'}</span>)}
          </div>
        </div>
      )}

      <span className="sdl-paycard-sr" role="status" aria-live="polite">{announcement}</span>
    </article>
  );
};

export default PaymentMethodCard;
