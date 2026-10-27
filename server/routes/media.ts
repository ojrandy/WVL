import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { isStoredFileName, uploadPath } from '../uploads.js';

export const mediaRouter = Router();

const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

function notFound(res: Response) {
  // Not cached, so an image that is made visible later shows up straight away.
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).type('text/plain').send('Not found');
}

// Public package images (update.md §6): only a visible image of a shipment that isn't in the
// trash. The name must be exactly the stored "<id>.<ext>", and the file is read from
// UPLOADS_DIR/images only, so hidden images, proofs and traversal attempts all get the same 404.
// The id is random and never reused, so a found image can be cached for a year.
mediaRouter.get('/media/:file', (req: Request, res: Response) => {
  const file = String(req.params.file);
  if (!isStoredFileName(file)) return notFound(res);

  const row = db.prepare(`
    SELECT i.file_name FROM shipment_images i
    JOIN shipments s ON s.tracking_number = i.tracking_number
    WHERE i.id = ? AND i.file_name = ? AND i.is_public = 1 AND s.deleted_at_ts IS NULL
  `).get(file.slice(0, file.lastIndexOf('.')), file) as { file_name: string } | undefined;
  const filePath = row ? uploadPath('images', row.file_name) : null;
  if (!filePath) return notFound(res);

  res.setHeader('Content-Type', CONTENT_TYPES[file.slice(file.lastIndexOf('.') + 1)]);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath, { cacheControl: false, dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) notFound(res);
  });
});
