import path from 'path';
import fs from 'fs';

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
