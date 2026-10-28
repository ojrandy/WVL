import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { paymentProofLimiter } from '../middleware/rateLimit.js';
import { decodeImageUpload, deleteUpload, saveUpload, UploadError } from '../uploads.js';
import { parseTrackingInput } from '../../src/shared/trackingId.js';
import { PROOF_ERROR_MESSAGES, PROOF_IMAGE_MESSAGES, proofRefusal, validateProofFields } from '../../src/shared/paymentProof.js';
import { getPaymentRow, parseMethods } from './shipmentPayments.js';

// POST /api/track/:trackingNumber/payment-proof (update.md §6, G.2): the customer's proof of
// payment from the track page. Public, so it has its own limiter and accepts a proof only while
// the request awaits payment, for one of this shipment's own accounts, with fewer than
// MAX_OPEN_PROOFS waiting. The screenshot is checked by content and stored under UPLOADS_DIR/proofs,
// which only admin routes read. The account is snapshotted, since the courier can edit it later.
export const trackProofRouter = Router();

const refuse = (res: Response, status: number, code: keyof typeof PROOF_ERROR_MESSAGES) =>
  res.status(status).json({ success: false, code, error: PROOF_ERROR_MESSAGES[code] });

function imageMessage(err: UploadError): string {
  if (err.code === 'EMPTY') return PROOF_IMAGE_MESSAGES.missing;
  if (err.code === 'TOO_LARGE') return PROOF_IMAGE_MESSAGES.tooLarge;
  if (err.code === 'NOT_IMAGE') return PROOF_IMAGE_MESSAGES.notImage;
  return PROOF_IMAGE_MESSAGES.unreadable;
}

const openProofCount = (paymentId: string) =>
  (db.prepare("SELECT COUNT(*) AS n FROM payment_proofs WHERE payment_id = ? AND status = 'SUBMITTED'").get(paymentId) as { n: number }).n;

trackProofRouter.post('/:trackingNumber/payment-proof', paymentProofLimiter, (req: Request, res: Response) => {
  let savedFile: string | null = null;
  try {
    const parsed = parseTrackingInput(String(req.params.trackingNumber));
    const tracking = parsed?.trackingId;
    if (!tracking || !db.prepare('SELECT 1 FROM shipments WHERE tracking_number = ? AND deleted_at_ts IS NULL').get(tracking)) {
      return res.status(404).json({ success: false, error: 'Shipment not found.' });
    }

    // A first check before decoding anything; repeated inside the transaction below.
    const payment = getPaymentRow(tracking);
    if (!payment) return refuse(res, 409, 'NOT_ACCEPTING');
    const firstRefusal = proofRefusal(payment.status, openProofCount(payment.id));
    if (firstRefusal) return refuse(res, 409, firstRefusal);

    const fields = validateProofFields(req.body, {
      methodIds: parseMethods(payment.methods_json).map((m) => m.id),
      currency: payment.currency,
    });
    const errors: Record<string, string> = fields.ok ? {} : { ...fields.errors };
    let image: ReturnType<typeof decodeImageUpload> | null = null;
    try {
      image = decodeImageUpload(req.body?.image);
    } catch (err) {
      if (!(err instanceof UploadError)) throw err;
      errors.image = imageMessage(err);
    }
    if (!fields.ok || !image) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0], errors });
    }

    savedFile = saveUpload('proofs', image.buffer, image.ext).fileName;
    const now = new Date().toISOString();
    const proofId = crypto.randomUUID();

    db.exec('BEGIN IMMEDIATE');
    try {
      // The request may have changed since the first read (edited, paid, another proof landed).
      const current = getPaymentRow(tracking);
      const refusal = current ? proofRefusal(current.status, openProofCount(current.id)) : 'NOT_ACCEPTING';
      const account = current ? parseMethods(current.methods_json).find((m) => m.id === fields.value.methodId) : undefined;
      if (refusal || !current || !account) {
        db.exec('ROLLBACK');
        deleteUpload('proofs', savedFile);
        savedFile = null;
        if (refusal) return refuse(res, 409, refusal);
        const error = 'Choose the payment method you used.';
        return res.status(400).json({ success: false, error, errors: { methodId: error } });
      }
      db.prepare(`
        INSERT INTO payment_proofs (id, payment_id, tracking_number, method_id, method_snapshot_json, payer_name,
          amount_sent, reference, file_name, status, admin_note, created_at, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', NULL, ?, NULL)
      `).run(proofId, current.id, tracking, account.id, JSON.stringify(account), fields.value.payerName,
        fields.value.amountSent, fields.value.reference, savedFile, now);
      db.prepare("UPDATE shipment_payments SET status = 'UNDER_REVIEW', updated_at = ? WHERE id = ?").run(now, current.id);
      db.exec('COMMIT');
      savedFile = null; // the proof row owns it now
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json({ success: true, data: { status: 'UNDER_REVIEW', proof: { status: 'SUBMITTED', submittedAt: now } } });
  } catch (err: any) {
    if (savedFile) deleteUpload('proofs', savedFile);
    console.error('[payment-proof] Submission failed:', err);
    res.status(500).json({ success: false, error: PROOF_ERROR_MESSAGES.FAILED });
  }
});
