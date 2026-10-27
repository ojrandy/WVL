import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Eye, EyeOff, ArrowUp, ArrowDown, Trash2, Upload, X, Loader2, Camera } from 'lucide-react';
import { api } from '../../services/api';
import { compressImage, ImageCompressError, isAcceptedImageFile } from '../../services/imageCompress';
import type { AdminShipmentImage } from '../../types/shipment';
import { legacyPhotoUrls } from '../../shared/legacyPhotos';
import './ShipmentImagesPanel.css';

// Package photos for one existing shipment (update.md C.3). Every action is saved on its own
// through the admin image routes, independent of the surrounding shipment form; the panel never
// submits that form (Enter in its fields is caught here).
const MAX_IMAGES = 20; // matches MAX_IMAGES_PER_SHIPMENT in server/routes/shipmentImages.ts
const MAX_CAPTION = 120;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

const COMPRESS_ERRORS: Record<string, string> = {
  NOT_IMAGE: 'Only JPG, PNG, WebP or HEIC photos can be added.',
  DECODE_FAILED: "This photo couldn't be read. Try saving it as JPG or PNG first.",
  TOO_LARGE: 'This photo is still over 2 MB after compression.',
};

interface PendingImage {
  key: string;
  name: string;
  base64: string;
  previewUrl: string;
  width: number;
  height: number;
  caption: string;
}

interface ShipmentImagesPanelProps {
  trackingNumber: string;
  /** shipments.photos_json values, shown read-only after the captioned photos (C.7). */
  legacyPhotos?: unknown;
}

export const ShipmentImagesPanel: React.FC<ShipmentImagesPanelProps> = ({ trackingNumber, legacyPhotos }) => {
  const legacy = legacyPhotoUrls(legacyPhotos);
  const [images, setImages] = useState<AdminShipmentImage[]>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [processing, setProcessing] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const applyList = useCallback((list: AdminShipmentImage[]) => {
    setImages(list);
    setCaptions(Object.fromEntries(list.map(img => [img.id, img.caption])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      applyList(await api.getShipmentImages(trackingNumber));
      setMessage(null);
    } catch (err: any) {
      setMessage({ tone: 'error', text: `Photos couldn't be loaded: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [trackingNumber, applyList]);

  useEffect(() => { load(); }, [load]);

  const run = async (key: string, action: () => Promise<AdminShipmentImage[]>, done?: string) => {
    setBusy(key);
    try {
      applyList(await action());
      setMessage(done ? { tone: 'info', text: done } : null);
      return true;
    } catch (err: any) {
      setMessage({ tone: 'error', text: err.message || 'The change could not be saved.' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const remaining = MAX_IMAGES - images.length - pending.length - processing;

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const accepted = list.slice(0, Math.max(remaining, 0));
    if (accepted.length < list.length) {
      setMessage({ tone: 'error', text: `A shipment can have at most ${MAX_IMAGES} photos; ${list.length - accepted.length} not added.` });
    } else {
      setMessage(null);
    }
    for (const file of accepted) {
      if (!isAcceptedImageFile(file)) {
        setMessage({ tone: 'error', text: `${file.name}: ${COMPRESS_ERRORS.NOT_IMAGE}` });
        continue;
      }
      setProcessing(n => n + 1);
      try {
        const img = await compressImage(file);
        setPending(p => [...p, {
          key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          base64: img.base64,
          previewUrl: `data:${img.mimeType};base64,${img.base64}`,
          width: img.width,
          height: img.height,
          caption: '',
        }]);
      } catch (err) {
        const code = err instanceof ImageCompressError ? err.code : 'DECODE_FAILED';
        console.error('[photos] compression failed:', err);
        setMessage({ tone: 'error', text: `${file.name}: ${COMPRESS_ERRORS[code]}` });
      } finally {
        setProcessing(n => n - 1);
      }
    }
  };

  const savePending = async (item: PendingImage) => {
    const caption = item.caption.trim();
    if (!caption) {
      setMessage({ tone: 'error', text: 'Give the photo a name before saving it.' });
      return;
    }
    const ok = await run(item.key, () => api.uploadShipmentImage(trackingNumber, {
      image: item.base64, caption, width: item.width, height: item.height,
    }), 'Photo saved.');
    if (ok) setPending(p => p.filter(x => x.key !== item.key));
  };

  const saveCaption = (img: AdminShipmentImage) => {
    const caption = (captions[img.id] ?? '').trim();
    if (caption === img.caption) return;
    if (!caption) {
      setCaptions(c => ({ ...c, [img.id]: img.caption }));
      setMessage({ tone: 'error', text: 'A photo name is required; the previous name was kept.' });
      return;
    }
    run(img.id, () => api.updateShipmentImage(trackingNumber, img.id, { caption }), 'Name saved.');
  };

  const move = (index: number, delta: number) => {
    const ids = images.map(img => img.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(ids[target], () => api.reorderShipmentImages(trackingNumber, ids));
  };

  const remove = (img: AdminShipmentImage) => {
    if (!window.confirm(`Delete the photo "${img.caption}"? This can't be undone.`)) return;
    run(img.id, () => api.deleteShipmentImage(trackingNumber, img.id), 'Photo deleted.');
  };

  // Enter inside the panel must never submit the shipment form around it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
  };

  return (
    <div className="sdl-photos-panel" onKeyDown={onKeyDown}>
      <div className="sdl-photos-head">
        <Camera size={13} className="text-accent" />
        <span>Package photos ({images.length}/{MAX_IMAGES})</span>
      </div>
      <p className="sdl-photos-hint">
        Shown on the public tracking page when visible. Each photo needs a name, e.g. "iPhone 15 – sealed at origin". Changes save straight away.
      </p>

      <label
        className={`sdl-photos-drop${dragOver ? ' is-over' : ''}${remaining <= 0 ? ' is-disabled' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (remaining > 0) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (remaining > 0) addFiles(e.dataTransfer.files); }}
      >
        <ImagePlus size={20} aria-hidden="true" />
        <span>{remaining > 0 ? <>Drag photos here or <u>choose files</u></> : `Photo limit reached (${MAX_IMAGES})`}</span>
        <small>JPG, PNG, WebP or HEIC · resized and location data removed before upload</small>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={remaining <= 0}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
        />
      </label>

      <div className="sdl-photos-status" role="status" aria-live="polite">
        {processing > 0 && <span className="sdl-photos-msg"><Loader2 size={13} className="sdl-photos-spin" /> Preparing {processing} photo{processing > 1 ? 's' : ''}…</span>}
        {message && <span className={`sdl-photos-msg is-${message.tone}`}>{message.text}</span>}
      </div>

      {pending.length > 0 && (
        <ul className="sdl-photos-list">
          {pending.map((item, i) => (
            <li key={item.key} className="sdl-photos-item is-pending">
              <img src={item.previewUrl} alt="" width={item.width} height={item.height} className="sdl-photos-thumb" />
              <div className="sdl-photos-body">
                <label htmlFor={`photo-new-${item.key}`}>Photo name (required) · {item.name}</label>
                <input
                  id={`photo-new-${item.key}`}
                  type="text"
                  value={item.caption}
                  maxLength={MAX_CAPTION}
                  autoFocus={i === 0}
                  placeholder="e.g. iPhone 15 – sealed at origin"
                  onChange={(e) => setPending(p => p.map(x => x.key === item.key ? { ...x, caption: e.target.value } : x))}
                  onKeyDown={(e) => { if (e.key === 'Enter') savePending(item); }}
                />
              </div>
              <div className="sdl-photos-actions">
                <button type="button" className="sdl-photos-btn is-primary" onClick={() => savePending(item)} disabled={busy !== null || !item.caption.trim()}>
                  {busy === item.key ? <Loader2 size={14} className="sdl-photos-spin" /> : <Upload size={14} />}
                  <span>Save photo</span>
                </button>
                <button type="button" className="sdl-photos-btn" onClick={() => setPending(p => p.filter(x => x.key !== item.key))} disabled={busy === item.key} aria-label={`Discard ${item.name}`}>
                  <X size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {loading ? (
        <p className="sdl-photos-empty"><Loader2 size={13} className="sdl-photos-spin" /> Loading photos…</p>
      ) : images.length === 0 && pending.length === 0 ? (
        <p className="sdl-photos-empty">No photos yet.</p>
      ) : (
        <ul className="sdl-photos-list">
          {images.map((img, index) => (
            <li key={img.id} className={`sdl-photos-item${img.isPublic ? '' : ' is-hidden'}`}>
              <img src={img.fileUrl} alt={img.caption} width={img.width ?? undefined} height={img.height ?? undefined} loading="lazy" className="sdl-photos-thumb" />
              <div className="sdl-photos-body">
                <label htmlFor={`photo-${img.id}`}>Photo {index + 1} name{img.isPublic ? '' : ' · hidden from customers'}</label>
                <input
                  id={`photo-${img.id}`}
                  type="text"
                  value={captions[img.id] ?? ''}
                  maxLength={MAX_CAPTION}
                  onChange={(e) => setCaptions(c => ({ ...c, [img.id]: e.target.value }))}
                  onBlur={() => saveCaption(img)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveCaption(img); }}
                />
              </div>
              <div className="sdl-photos-actions">
                <button
                  type="button"
                  className="sdl-photos-btn"
                  aria-pressed={img.isPublic}
                  title={img.isPublic ? 'Visible to customers. Click to hide.' : 'Hidden from customers. Click to show.'}
                  onClick={() => run(img.id, () => api.updateShipmentImage(trackingNumber, img.id, { isPublic: !img.isPublic }), img.isPublic ? 'Photo hidden from customers.' : 'Photo visible to customers.')}
                  disabled={busy !== null}
                >
                  {img.isPublic ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span>{img.isPublic ? 'Visible' : 'Hidden'}</span>
                </button>
                <button type="button" className="sdl-photos-btn" onClick={() => move(index, -1)} disabled={busy !== null || index === 0} aria-label={`Move "${img.caption}" earlier`}>
                  <ArrowUp size={14} />
                </button>
                <button type="button" className="sdl-photos-btn" onClick={() => move(index, 1)} disabled={busy !== null || index === images.length - 1} aria-label={`Move "${img.caption}" later`}>
                  <ArrowDown size={14} />
                </button>
                <button type="button" className="sdl-photos-btn is-danger" onClick={() => remove(img)} disabled={busy !== null} aria-label={`Delete "${img.caption}"`}>
                  {busy === img.id ? <Loader2 size={14} className="sdl-photos-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {legacy.length > 0 && (
        <div className="sdl-photos-legacy">
          <span className="sdl-photos-legacy-title">Earlier photos (read-only)</span>
          <ul className="sdl-photos-legacy-grid">
            {legacy.map((url, i) => (
              <li key={`${i}-${url}`}>
                <img src={url} alt={`Shipment photo ${i + 1}`} width={96} height={72} loading="lazy" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
