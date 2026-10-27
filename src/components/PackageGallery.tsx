import React from 'react';
import type { PublicShipmentImage } from '../types/shipment';
import './PackageGallery.css';

// Package photos on the Track Result page (update.md C.5, copy CONTENT.md §6.6). Renders nothing
// without photos. Phones: one column, caption under each photo. From 768px: one row band at a low
// fixed height, 1 / 2 / 3 columns by count.
interface PackageGalleryProps {
  images: PublicShipmentImage[];
}

export const PackageGallery: React.FC<PackageGalleryProps> = ({ images }) => {
  if (images.length === 0) return null;
  const cols = Math.min(images.length, 3);

  return (
    <section className="sdl-gallery-card" aria-labelledby="track-photos-title">
      <div className="sdl-gallery-head">
        <h3 id="track-photos-title" className="card-section-title">Package photos</h3>
        <span className="sdl-gallery-count">{images.length === 1 ? '1 photo' : `${images.length} photos`}</span>
      </div>
      <p className="sdl-gallery-intro">Photos of your package added by our team.</p>
      <ul className={`sdl-gallery-grid sdl-gallery-cols-${cols}`}>
        {images.map((img, i) => {
          const caption = img.caption || `Package photo ${i + 1}`;
          return (
            <li key={img.url} className="sdl-gallery-item">
              <figure>
                <img
                  src={img.url}
                  alt={caption}
                  width={img.width ?? 1600}
                  height={img.height ?? 1200}
                  loading="lazy"
                  decoding="async"
                />
                <figcaption>{caption}</figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
