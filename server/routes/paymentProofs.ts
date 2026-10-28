import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { uploadPath } from '../uploads.js';
import { PROOF_STATUSES, type AdminPaymentProof, type ProofCounts, type ProofStatus } from '../../src/shared/paymentProof.js';
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
