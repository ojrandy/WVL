import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import './PackageImageViewer.css';

// Full-screen package photo viewer (update.md C.6, labels CONTENT.md §6.6). Lazy-loaded by
// PackageGallery. Esc closes, ←/→ wrap, Tab stays inside, body scroll is locked while open and
// focus goes back to the thumbnail that opened it (the gallery does that in onClose).
export interface ViewerImage {
  url: string;
  caption: string;
  width: number;
  height: number;
}

interface PackageImageViewerProps {
  images: ViewerImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const PackageImageViewer: React.FC<PackageImageViewerProps> = ({ images, index, onIndexChange, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = images.length;
  const image = images[index];

  const go = (delta: number) => onIndexChange((index + delta + count) % count);

  useEffect(() => {
    closeRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowLeft' && count > 1) {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight' && count > 1) {
      e.preventDefault();
      go(1);
    } else if (e.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
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

  // Portalled to <body> so no transformed ancestor on the page can clip or out-stack it.
  return createPortal(
    <div
      ref={dialogRef}
      className="sdl-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Package photos"
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sdl-viewer-bar">
        <span className="sdl-viewer-counter" aria-live="polite">Photo {index + 1} of {count}</span>
        <button ref={closeRef} type="button" className="sdl-viewer-btn" onClick={onClose} aria-label="Close photo viewer">
          <X size={22} aria-hidden="true" />
        </button>
      </div>

      <figure className="sdl-viewer-figure" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <img key={image.url} src={image.url} alt={image.caption} width={image.width} height={image.height} />
        <figcaption>{image.caption}</figcaption>
      </figure>

      {count > 1 && (
        <>
          <button type="button" className="sdl-viewer-btn sdl-viewer-nav is-prev" onClick={() => go(-1)} aria-label="Previous photo">
            <ChevronLeft size={28} aria-hidden="true" />
          </button>
          <button type="button" className="sdl-viewer-btn sdl-viewer-nav is-next" onClick={() => go(1)} aria-label="Next photo">
            <ChevronRight size={28} aria-hidden="true" />
          </button>
        </>
      )}
    </div>,
    document.body
  );
};

export default PackageImageViewer;
