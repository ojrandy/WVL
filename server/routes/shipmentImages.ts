import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { decodeImageUpload, saveUpload, deleteUpload, uploadPath, UploadError } from '../uploads.js';

// Admin package images for one shipment (update.md §6, C.1). Mounted under
// /api/shipments/:trackingNumber/images behind requireAdminAuth. Files live in
// UPLOADS_DIR/images; the public only ever reaches visible ones through /media.
export const shipmentImagesRouter = Router({ mergeParams: true });

export const MAX_IMAGES_PER_SHIPMENT = 20;
export const MAX_CAPTION_LENGTH = 120;

const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

type ImageRow = {
  id: string;
  tracking_number: string;
  caption: string;
  file_name: string;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  is_public: number;
  sort_order: number;
  created_at: string;
};

function formatImage(row: ImageRow) {
  return {
    id: row.id,
    caption: row.caption,
    isPublic: Boolean(row.is_public),
    sortOrder: row.sort_order,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    // Console previews go through the admin route, so hidden images show there too.
    fileUrl: `/api/shipments/${encodeURIComponent(row.tracking_number)}/images/${row.id}/file`,
    publicUrl: `/media/${row.file_name}`,
  };
}

function listImages(tracking: string) {
  const rows = db.prepare('SELECT * FROM shipment_images WHERE tracking_number = ? ORDER BY sort_order ASC, created_at ASC').all(tracking) as ImageRow[];
  return rows.map(formatImage);
}

function trackingParam(req: Request) {
  return String(req.params.trackingNumber).trim().toUpperCase();
}

// Images are only managed on live shipments; a trashed one keeps its images untouched.
function shipmentExists(tracking: string) {
  return Boolean(db.prepare('SELECT 1 FROM shipments WHERE tracking_number = ? AND deleted_at_ts IS NULL').get(tracking));
}

function cleanCaption(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const caption = input.replace(/\s+/g, ' ').trim();
  return caption.length > 0 && caption.length <= MAX_CAPTION_LENGTH ? caption : null;
}

const CAPTION_ERROR = `Give the photo a name (1–${MAX_CAPTION_LENGTH} characters).`;

function dimension(input: unknown): number | null {
  const n = Number(input);
  return Number.isInteger(n) && n > 0 && n <= 10000 ? n : null;
}

// GET /api/shipments/:trackingNumber/images
shipmentImagesRouter.get('/', (req: Request, res: Response) => {
  try {
    const tracking = trackingParam(req);
    if (!shipmentExists(tracking)) {
      return res.status(404).json({ success: false, error: `Shipment ${tracking} not found` });
    }
    res.json({ success: true, data: listImages(tracking) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/shipments/:trackingNumber/images — { image (base64 / data URL), caption, width, height, isPublic? }
shipmentImagesRouter.post('/', (req: Request, res: Response) => {
  try {
    const tracking = trackingParam(req);
    if (!shipmentExists(tracking)) {
      return res.status(404).json({ success: false, error: `Shipment ${tracking} not found` });
    }
    const caption = cleanCaption(req.body?.caption);
    if (!caption) {
      return res.status(400).json({ success: false, error: CAPTION_ERROR });
    }
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM shipment_images WHERE tracking_number = ?').get(tracking) as { count: number };
    if (count >= MAX_IMAGES_PER_SHIPMENT) {
      return res.status(400).json({ success: false, error: `A shipment can have at most ${MAX_IMAGES_PER_SHIPMENT} photos.` });
    }

    const { buffer, ext } = decodeImageUpload(req.body?.image);
    const { id, fileName } = saveUpload('images', buffer, ext);
    try {
      const { next } = db.prepare('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM shipment_images WHERE tracking_number = ?').get(tracking) as { next: number };
      db.prepare(`
        INSERT INTO shipment_images (id, tracking_number, caption, file_name, width, height, size_bytes, is_public, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tracking, caption, fileName, dimension(req.body?.width), dimension(req.body?.height), buffer.length,
        req.body?.isPublic === false ? 0 : 1, next, new Date().toISOString());
    } catch (err) {
      deleteUpload('images', fileName);
      throw err;
    }
    res.status(201).json({ success: true, data: listImages(tracking) });
  } catch (err: any) {
    if (err instanceof UploadError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/shipments/:trackingNumber/images/order — { ids: [...] }, every image exactly once.
shipmentImagesRouter.put('/order', (req: Request, res: Response) => {
  try {
    const tracking = trackingParam(req);
    if (!shipmentExists(tracking)) {
      return res.status(404).json({ success: false, error: `Shipment ${tracking} not found` });
    }
    const ids = req.body?.ids;
    const current = (db.prepare('SELECT id FROM shipment_images WHERE tracking_number = ?').all(tracking) as { id: string }[]).map(r => r.id);
    const valid = Array.isArray(ids)
      && ids.length === current.length
      && new Set(ids).size === ids.length
      && ids.every((id: unknown) => typeof id === 'string' && current.includes(id));
    if (!valid) {
      return res.status(400).json({ success: false, error: 'The photo order must list each of this shipment\'s photos once.' });
    }
    const update = db.prepare('UPDATE shipment_images SET sort_order = ? WHERE id = ? AND tracking_number = ?');
    db.exec('BEGIN');
    try {
      ids.forEach((id: string, index: number) => update.run(index, id, tracking));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ success: true, data: listImages(tracking) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/shipments/:trackingNumber/images/:imageId — { caption?, isPublic? }
shipmentImagesRouter.patch('/:imageId', (req: Request, res: Response) => {
  try {
    const tracking = trackingParam(req);
    if (!shipmentExists(tracking)) {
      return res.status(404).json({ success: false, error: `Shipment ${tracking} not found` });
    }
    const row = db.prepare('SELECT * FROM shipment_images WHERE id = ? AND tracking_number = ?').get(String(req.params.imageId), tracking) as ImageRow | undefined;
    if (!row) {
      return res.status(404).json({ success: false, error: 'Photo not found.' });
    }
    let caption = row.caption;
    if (req.body?.caption !== undefined) {
      const cleaned = cleanCaption(req.body.caption);
      if (!cleaned) return res.status(400).json({ success: false, error: CAPTION_ERROR });
      caption = cleaned;
    }
    let isPublic = row.is_public;
    if (req.body?.isPublic !== undefined) {
      if (typeof req.body.isPublic !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Visibility must be true or false.' });
      }
      isPublic = req.body.isPublic ? 1 : 0;
    }
    db.prepare('UPDATE shipment_images SET caption = ?, is_public = ? WHERE id = ?').run(caption, isPublic, row.id);
    res.json({ success: true, data: listImages(tracking) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/shipments/:trackingNumber/images/:imageId — removes the row, then the file.
shipmentImagesRouter.delete('/:imageId', (req: Request, res: Response) => {
  try {
    const tracking = trackingParam(req);
    if (!shipmentExists(tracking)) {
      return res.status(404).json({ success: false, error: `Shipment ${tracking} not found` });
    }
    const row = db.prepare('SELECT * FROM shipment_images WHERE id = ? AND tracking_number = ?').get(String(req.params.imageId), tracking) as ImageRow | undefined;
    if (!row) {
      return res.status(404).json({ success: false, error: 'Photo not found.' });
    }
    db.prepare('DELETE FROM shipment_images WHERE id = ?').run(row.id);
    deleteUpload('images', row.file_name);
    res.json({ success: true, data: listImages(tracking) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/shipments/:trackingNumber/images/:imageId/file — any image of the shipment, visible
// or hidden, for console previews. Works for trashed shipments too (read-only).
shipmentImagesRouter.get('/:imageId/file', (req: Request, res: Response) => {
  const row = db.prepare('SELECT file_name FROM shipment_images WHERE id = ? AND tracking_number = ?').get(String(req.params.imageId), trackingParam(req)) as { file_name: string } | undefined;
  const filePath = row ? uploadPath('images', row.file_name) : null;
  if (!row || !filePath) {
    return res.status(404).json({ success: false, error: 'Photo not found.' });
  }
  res.setHeader('Content-Type', CONTENT_TYPES[row.file_name.slice(row.file_name.lastIndexOf('.') + 1)]);
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath, { cacheControl: false, dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ success: false, error: 'Photo not found.' });
  });
});

// Used by the permanent shipment delete: rows first, then files. Trash/restore never calls it.
export function deleteShipmentImages(tracking: string) {
  const rows = db.prepare('SELECT file_name FROM shipment_images WHERE tracking_number = ?').all(tracking) as { file_name: string }[];
  db.prepare('DELETE FROM shipment_images WHERE tracking_number = ?').run(tracking);
  for (const row of rows) deleteUpload('images', row.file_name);
}
