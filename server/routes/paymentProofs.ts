import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { uploadPath } from '../uploads.js';
import { setDocumentPaymentStatus } from '../documentPayment.js';
import { eventTime } from '../eventTime.js';
import { ADMIN_ROLE_LABEL, OPERATIONS_CENTRE } from '../../src/config/brand.js';
import { PROOF_STATUSES, REJECT_REASON_ERROR, cleanRejectReason, type AdminPaymentProof, type ProofCounts, type ProofStatus } from '../../src/shared/paymentProof.js';
import type { PaymentRequestAccount, PaymentStatus } from '../../src/shared/paymentRequest.js';
import type { PaymentCurrency } from '../../src/shared/currency.js';

// Payment proofs for the admin Payments page (update.md §6, Phase G). Mounted under /api/payments
// behind requireAdminAuth. Screenshots show names and account numbers, so the files are only ever
// served from here (private, no-store); proofs of trashed shipments are left out of every list.
export const paymentProofsRouter = Router();

const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

export type ProofRow = {
  id: string;
  payment_id: string;
  tracking_number: string;
  method_id: string | null;
  method_snapshot_json: string | null;
  payer_name: string;
  amount_sent: number | null;
  reference: string | null;
  file_name: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

type ProofListRow = ProofRow & {
  pay_amount: number;
  pay_currency: string;
  pay_reason: string;
  pay_status: string;
};

function parseSnapshot(json: string | null): PaymentRequestAccount | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatProof(row: ProofListRow): AdminPaymentProof {
  return {
    id: row.id,
    trackingNumber: row.tracking_number,
    status: row.status as ProofStatus,
    payerName: row.payer_name,
    amountSent: row.amount_sent,
    reference: row.reference,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    method: parseSnapshot(row.method_snapshot_json),
    payment: {
      amount: row.pay_amount,
      currency: row.pay_currency as PaymentCurrency,
      chargeReason: row.pay_reason,
      status: row.pay_status as PaymentStatus,
    },
    fileUrl: `/api/payments/proofs/${encodeURIComponent(row.id)}/file`,
  };
}

// Proofs joined to their request, on live shipments only.
const LIST_SQL = `
  SELECT p.*, sp.amount AS pay_amount, sp.currency AS pay_currency, sp.charge_reason AS pay_reason, sp.status AS pay_status
  FROM payment_proofs p
  JOIN shipment_payments sp ON sp.id = p.payment_id
  JOIN shipments s ON s.tracking_number = p.tracking_number AND s.deleted_at_ts IS NULL
`;

export function getAdminProof(id: string): AdminPaymentProof | null {
  const row = db.prepare(`${LIST_SQL} WHERE p.id = ?`).get(id) as ProofListRow | undefined;
  return row ? formatProof(row) : null;
}

// GET /api/payments/proofs?status=SUBMITTED|APPROVED|REJECTED|ALL — newest first, with the count
// per status for the filter buttons. SUBMITTED is the default.
paymentProofsRouter.get('/proofs', (req: Request, res: Response) => {
  try {
    const raw = String(req.query.status ?? 'SUBMITTED').toUpperCase();
    if (raw !== 'ALL' && !(PROOF_STATUSES as readonly string[]).includes(raw)) {
      return res.status(400).json({ success: false, error: 'status must be SUBMITTED, APPROVED, REJECTED or ALL.' });
    }
    const rows = (raw === 'ALL'
      ? db.prepare(`${LIST_SQL} ORDER BY p.created_at DESC`).all()
      : db.prepare(`${LIST_SQL} WHERE p.status = ? ORDER BY p.created_at DESC`).all(raw)) as ProofListRow[];

    const counts: ProofCounts = { SUBMITTED: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    const countRows = db.prepare(`
      SELECT p.status AS status, COUNT(*) AS n FROM payment_proofs p
      JOIN shipments s ON s.tracking_number = p.tracking_number AND s.deleted_at_ts IS NULL
      JOIN shipment_payments sp ON sp.id = p.payment_id
      GROUP BY p.status
    `).all() as { status: string; n: number }[];
    for (const { status, n } of countRows) {
      if (status in counts) counts[status as ProofStatus] = n;
      counts.ALL += n;
    }
    res.json({ success: true, data: { proofs: rows.map(formatProof), counts } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/payments/proofs/:id/file — the private screenshot. Never cached anywhere.
paymentProofsRouter.get('/proofs/:id/file', (req: Request, res: Response) => {
  const row = db.prepare(`
    SELECT p.file_name FROM payment_proofs p
    JOIN shipments s ON s.tracking_number = p.tracking_number AND s.deleted_at_ts IS NULL
    WHERE p.id = ?
  `).get(String(req.params.id)) as { file_name: string } | undefined;
  const filePath = row ? uploadPath('proofs', row.file_name) : null;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!row || !filePath) {
    return res.status(404).json({ success: false, error: 'Proof not found.' });
  }
  res.setHeader('Content-Type', CONTENT_TYPES[row.file_name.slice(row.file_name.lastIndexOf('.') + 1)]);
  res.sendFile(filePath, { cacheControl: false, dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ success: false, error: 'Proof not found.' });
  });
});

type ReviewTarget = { proof: ProofRow; payment: { id: string; status: string; invoice_document_id: string | null } };

// Loads a proof waiting for review, inside the caller's transaction. Returns an HTTP answer instead
// when it can't be reviewed: unknown or trashed (404), already reviewed (409), or, when approving,
// its request no longer open (409). A waiting proof can always be rejected, so one left over on a
// request that was paid or cancelled meanwhile doesn't stay in the queue for good.
function reviewTarget(id: string, requireOpen: boolean): ReviewTarget | { status: number; error: string } {
  const proof = db.prepare(`
    SELECT p.* FROM payment_proofs p
    JOIN shipments s ON s.tracking_number = p.tracking_number AND s.deleted_at_ts IS NULL
    WHERE p.id = ?
  `).get(id) as ProofRow | undefined;
  if (!proof) return { status: 404, error: 'Proof not found.' };
  if (proof.status !== 'SUBMITTED') return { status: 409, error: 'This proof was already reviewed.' };
  const payment = db.prepare('SELECT id, status, invoice_document_id FROM shipment_payments WHERE id = ?')
    .get(proof.payment_id) as ReviewTarget['payment'] | undefined;
  if (!payment || (requireOpen && payment.status !== 'AWAITING_PAYMENT' && payment.status !== 'UNDER_REVIEW')) {
    return { status: 409, error: "This payment request isn't waiting for a proof." };
  }
  return { proof, payment };
}

// Runs a review in one transaction; `apply` does the writes once the proof is known to be reviewable.
function review(req: Request, res: Response, requireOpen: boolean, apply: (target: ReviewTarget, now: string) => void) {
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const target = reviewTarget(String(req.params.id), requireOpen);
      if ('error' in target) {
        db.exec('ROLLBACK');
        return res.status(target.status).json({ success: false, error: target.error });
      }
      apply(target, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ success: true, data: getAdminProof(String(req.params.id)) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /api/payments/proofs/:id/approve — { addEvent?: boolean } (default true, D-8). The request
// becomes PAID with paid_at, a linked invoice PAID (setDocumentPaymentStatus), and optionally a
// public "Payment confirmed" event at the Operations Centre. The shipment's status, current
// event and progress are left as they are: the event is recorded as completed, not current.
paymentProofsRouter.post('/proofs/:id/approve', (req: Request, res: Response) => {
  const addEvent = req.body?.addEvent !== false;
  review(req, res, true, ({ proof, payment }, now) => {
    db.prepare("UPDATE payment_proofs SET status = 'APPROVED', reviewed_at = ? WHERE id = ?").run(now, proof.id);
    db.prepare("UPDATE shipment_payments SET status = 'PAID', paid_at = ?, updated_at = ? WHERE id = ?").run(now, now, payment.id);
    if (payment.invoice_document_id) setDocumentPaymentStatus(payment.invoice_document_id, 'PAID');
    if (!addEvent) return;

    const ship = db.prepare('SELECT status, current_location_city, current_location_state, current_location_lat, current_location_lng FROM shipments WHERE tracking_number = ?')
      .get(proof.tracking_number) as { status: string; current_location_city: string; current_location_state: string; current_location_lat: number | null; current_location_lng: number | null };
    // Time shown in the zone of the shipment's current location, like its other events.
    const time = eventTime(`${ship.current_location_city || ''}, ${ship.current_location_state || ''}`, {
      lat: ship.current_location_lat ?? undefined, lng: ship.current_location_lng ?? undefined,
    });
    const count = (db.prepare('SELECT COUNT(*) AS n FROM tracking_events WHERE shipment_tracking = ?').get(proof.tracking_number) as { n: number }).n;
    db.prepare(`
      INSERT INTO tracking_events (
        id, shipment_tracking, status, title, location, facility,
        timestamp, description, operator_notes, delay_flag, completed, current_flag, sort_order,
        recorded_by, occurred_at_ts, time_zone
      ) VALUES (?, ?, ?, 'Payment confirmed', ?, ?, ?, 'Payment received and confirmed.', NULL, 0, 1, 0, ?, ?, ?, ?)
    `).run(`e-${Date.now()}-pay`, proof.tracking_number, ship.status, OPERATIONS_CENTRE, OPERATIONS_CENTRE,
      time.timestamp, count + 1, ADMIN_ROLE_LABEL, time.occurredAtTs, time.timeZone);
  });
});

// POST /api/payments/proofs/:id/reject — { reason } (3–300 characters, shown to the customer). An
// UNDER_REVIEW request goes back to AWAITING_PAYMENT once no other proof is waiting, so the
// customer can send a new one; a paid or cancelled request is left as it is.
paymentProofsRouter.post('/proofs/:id/reject', (req: Request, res: Response) => {
  const reason = cleanRejectReason(req.body?.reason);
  if (!reason) {
    return res.status(400).json({ success: false, error: REJECT_REASON_ERROR, errors: { reason: REJECT_REASON_ERROR } });
  }
  review(req, res, false, ({ proof, payment }, now) => {
    db.prepare("UPDATE payment_proofs SET status = 'REJECTED', admin_note = ?, reviewed_at = ? WHERE id = ?").run(reason, now, proof.id);
    const waiting = (db.prepare("SELECT COUNT(*) AS n FROM payment_proofs WHERE payment_id = ? AND status = 'SUBMITTED'").get(payment.id) as { n: number }).n;
    if (payment.status === 'UNDER_REVIEW' && waiting === 0) {
      db.prepare("UPDATE shipment_payments SET status = 'AWAITING_PAYMENT', updated_at = ? WHERE id = ?").run(now, payment.id);
    }
  });
});
