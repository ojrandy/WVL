import React, { Suspense, lazy, useRef, useState } from 'react';
import type { PublicShipmentImage } from '../types/shipment';
import type { ViewerImage } from './PackageImageViewer';
import './PackageGallery.css';

// The viewer is its own chunk, fetched the first time a photo is opened.
const PackageImageViewer = lazy(() => import('./PackageImageViewer'));

// Package photos on the Track Result page (update.md C.5, copy CONTENT.md §6.6). Renders nothing
// without photos. Phones: one column, caption under each photo. From 768px: one row band at a low
// fixed height, 1 / 2 / 3 columns by count. Each photo opens the full-screen viewer (C.6).
interface PackageGalleryProps {
  images: PublicShipmentImage[];
}

export const PackageGallery: React.FC<PackageGalleryProps> = ({ images }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  if (images.length === 0) return null;
  const cols = Math.min(images.length, 3);

  const items: ViewerImage[] = images.map((img, i) => ({
    url: img.url,
    caption: img.caption || `Package photo ${i + 1}`,
    width: img.width ?? 1600,
    height: img.height ?? 1200,
  }));

  const close = () => {
    const index = openIndex;
    setOpenIndex(null);
    if (index !== null) thumbRefs.current[index]?.focus();
  };

  return (
    <section className="sdl-gallery-card" aria-labelledby="track-photos-title">
      <div className="sdl-gallery-head">
        <h3 id="track-photos-title" className="card-section-title">Package photos</h3>
        <span className="sdl-gallery-count">{images.length === 1 ? '1 photo' : `${images.length} photos`}</span>
      </div>
      <p className="sdl-gallery-intro">Photos of your package added by our team.</p>
      <ul className={`sdl-gallery-grid sdl-gallery-cols-${cols}`}>
        {items.map((img, i) => (
          <li key={img.url} className="sdl-gallery-item">
            <figure>
              <button
                type="button"
                className="sdl-gallery-open"
                ref={(el) => { thumbRefs.current[i] = el; }}
                onClick={() => setOpenIndex(i)}
                aria-label={`Open photo: ${img.caption}`}
              >
                <img src={img.url} alt={img.caption} width={img.width} height={img.height} loading="lazy" decoding="async" />
              </button>
              <figcaption>{img.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
      {openIndex !== null && (
        <Suspense fallback={null}>
          <PackageImageViewer images={items} index={openIndex} onIndexChange={setOpenIndex} onClose={close} />
        </Suspense>
      )}
    </section>
  );
};
