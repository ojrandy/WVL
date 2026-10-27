// Browser-side image compression for uploads (update.md B.3). Every photo or proof is redrawn on a
// canvas before it is sent: longest side ≤ 1600px, WebP (JPEG on a white background where the
// browser can't encode WebP), stepped down in quality until it fits the server's 2 MB cap. The
// redraw keeps only pixels, so EXIF data, including GPS location, never leaves the device.

export const MAX_IMAGE_SIDE = 1600;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // matches MAX_UPLOAD_BYTES in server/uploads.ts

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45];

// HEIC/HEIF is accepted where the browser itself can decode it (Safari); elsewhere decoding
// fails and the caller gets DECODE_FAILED. Some browsers report HEIC with an empty type.
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const HEIC_NAME = /\.(heic|heif)$/i;

export type ImageCompressErrorCode = 'NOT_IMAGE' | 'DECODE_FAILED' | 'TOO_LARGE';

// The UI turns the code into its own copy (CONTENT.md); the message is for the console only.
export class ImageCompressError extends Error {
  constructor(public code: ImageCompressErrorCode, message: string) {
    super(message);
  }
}

export interface CompressedImage {
  base64: string;            // bare base64, no data: prefix
  mimeType: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  sizeBytes: number;
}

export function isAcceptedImageFile(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type) || (file.type === '' && HEIC_NAME.test(file.name));
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageCompressError('DECODE_FAILED', `The browser could not decode ${file.type || file.name}.`));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (!isAcceptedImageFile(file)) {
    throw new ImageCompressError('NOT_IMAGE', `Not an accepted image type: ${file.type || file.name}.`);
  }
  const img = await loadImage(file);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new ImageCompressError('DECODE_FAILED', 'The image has no size.');
  }

  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageCompressError('DECODE_FAILED', 'Canvas is not available.');

  // Browsers that can't encode WebP silently return PNG instead, so probe once and fall back to
  // JPEG. JPEG has no transparency, so that canvas gets a white background first.
  ctx.drawImage(img, 0, 0, width, height);
  let mimeType: CompressedImage['mimeType'] = 'image/webp';
  const probe = await toBlob(canvas, 'image/webp', QUALITY_STEPS[0]);
  if (!probe || probe.type !== 'image/webp') {
    mimeType = 'image/jpeg';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
  }

  for (const quality of QUALITY_STEPS) {
    const blob = quality === QUALITY_STEPS[0] && mimeType === 'image/webp'
      ? probe
      : await toBlob(canvas, mimeType, quality);
    if (blob && blob.type === mimeType && blob.size <= MAX_IMAGE_BYTES) {
      return { base64: await blobToBase64(blob), mimeType, width, height, sizeBytes: blob.size };
    }
  }
  throw new ImageCompressError('TOO_LARGE', 'The image is still over 2 MB at the lowest quality.');
}
