import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Uploaded files (package images, payment proofs) live on disk, never in SQLite (update.md D-3).
// Like DB_PATH, UPLOADS_DIR must point OUTSIDE the deploy folder on a real host, or a git
// redeploy deletes every upload. Unset, it is "uploads" next to the database: data/uploads in
// dev, or beside the DB_PATH file (the same folder db.ts uses as dataDir).
const dbFolder = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(process.cwd(), 'data');

export const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(dbFolder, 'uploads');

// images/ holds package photos (served publicly when visible, via /media); proofs/ holds payment
// screenshots, which only admin routes may ever read.
export type UploadKind = 'images' | 'proofs';

export const uploadDirs: Record<UploadKind, string> = {
  images: path.join(uploadsDir, 'images'),
  proofs: path.join(uploadsDir, 'proofs'),
};

export function initUploads() {
  for (const dir of Object.values(uploadDirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Files are checked by content (magic bytes), never by name or declared type (update.md §3).
// The browser compresses to ≤ 1600px WebP/JPEG first, so 2 MB is generous.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export type UploadExt = 'webp' | 'jpg' | 'png';

// The code lets a public route show its own copy (CONTENT.md §6.8); the message is the admin one.
export type UploadErrorCode = 'EMPTY' | 'TOO_LARGE' | 'INVALID' | 'NOT_IMAGE';

export class UploadError extends Error {
  constructor(message: string, public code: UploadErrorCode, public status = 400) {
    super(message);
  }
}

export function detectImageType(buf: Uint8Array): UploadExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)) return 'png';
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

// Accepts a data URL (its declared type is ignored) or bare base64. Returns the decoded bytes
// and the real type, or throws an UploadError with a plain message.
export function decodeImageUpload(input: unknown): { buffer: Buffer; ext: UploadExt } {
  if (typeof input !== 'string' || input.length === 0) {
    throw new UploadError('No image was sent.', 'EMPTY');
  }
  const base64 = input.startsWith('data:')
    ? input.slice(input.indexOf(',') + 1)
    : input;
  // A rough size check first, so an oversized body is never decoded.
  if (base64.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4) {
    throw new UploadError('The image is larger than 2 MB.', 'TOO_LARGE');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new UploadError('The image data is not valid.', 'INVALID');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadError('The image is larger than 2 MB.', 'TOO_LARGE');
  }
  const ext = detectImageType(buffer);
  if (!ext) {
    throw new UploadError('Only JPG, PNG or WebP images can be uploaded.', 'NOT_IMAGE');
  }
  return { buffer, ext };
}

// Stored names are always "<uuid>.<ext>": the id doubles as the public file name for images.
const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/;

export function isStoredFileName(name: unknown): name is string {
  return typeof name === 'string' && STORED_NAME.test(name);
}

// The absolute path of a stored file, or null for anything that isn't a name this module made.
export function uploadPath(kind: UploadKind, fileName: string): string | null {
  return isStoredFileName(fileName) ? path.join(uploadDirs[kind], fileName) : null;
}

export function saveUpload(kind: UploadKind, buffer: Buffer, ext: UploadExt): { id: string; fileName: string } {
  const id = crypto.randomUUID();
  const fileName = `${id}.${ext}`;
  fs.writeFileSync(path.join(uploadDirs[kind], fileName), buffer, { flag: 'wx' });
  return { id, fileName };
}

// Removes a stored file; a missing file or a name this module didn't make is ignored.
export function deleteUpload(kind: UploadKind, fileName: string) {
  const file = uploadPath(kind, fileName);
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.error(`[uploads] Could not delete ${kind}/${fileName}:`, err);
  }
}
