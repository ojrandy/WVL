import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { AdminPaymentProof } from '../../shared/paymentProof';
import { ProofFacts } from './ProofFacts';
import '../../components/PackageImageViewer.css';

// Full-size payment screenshot with its facts (update.md G.5), styled like the track page's photo
// viewer. Esc or the backdrop closes it, Tab stays inside, body scroll is locked while open; the
// caller returns focus to whatever opened it. `children` holds the review controls (G.6).

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

interface ProofViewerProps {
  proof: AdminPaymentProof;
  onClose: () => void;
  children?: React.ReactNode;
}

export const ProofViewer: React.FC<ProofViewerProps> = ({ proof, onClose, children }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const titleId = `sdl-proofviewer-${proof.id}`;
  return createPortal(
    <div
      ref={dialogRef}
      className="sdl-viewer-overlay sdl-proofviewer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sdl-viewer-bar">
        <span id={titleId} className="sdl-viewer-counter">Payment proof · <span className="font-mono">{proof.trackingNumber}</span></span>
        <button ref={closeRef} type="button" className="sdl-viewer-btn" onClick={onClose} aria-label="Close">
          <X size={22} aria-hidden="true" />
        </button>
      </div>

      <div className="sdl-proofviewer-body">
        <div className="sdl-proofviewer-image">
          <img src={proof.fileUrl} alt={`Payment screenshot from ${proof.payerName}`} />
        </div>
        <aside className="sdl-proofviewer-side">
          <ProofFacts proof={proof} showAccountDetails />
          {children}
        </aside>
      </div>
    </div>,
    document.body
  );
};
