import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { setDocumentPaymentStatus } from '../documentPayment.js';
import { PAYMENT_STATUS_ACTIONS, nextPaymentStatus, validatePaymentRequest, type AdminPaymentRequest, type PaymentRequestAccount, type PaymentStatus } from '../../src/shared/paymentRequest.js';
import type { PaymentCurrency } from '../../src/shared/currency.js';

// A shipment's single payment request (update.md §5, §6, E.1). Mounted under
// /api/shipments/:trackingNumber/payment behind requireAdminAuth. The accounts live here, typed per
// shipment by the courier (D-9); the public booking POST never reaches this route, and the track
// page only ever sees this shipment's accounts through publicPaymentView.
export const shipmentPaymentsRouter = Router({ mergeParams: true });

export type PaymentRow = {
  id: string;
  tracking_number: string;
  amount: number;
  currency: string;
  charge_reason: string;
  due_date: string | null;
  methods_json: string;
  invoice_document_id: string | null;
  status: string;
  customer_note: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
};

export function parseMethods(json: string): PaymentRequestAccount[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function formatPayment(row: PaymentRow): AdminPaymentRequest {
  return {
    id: row.id,
    trackingNumber: row.tracking_number,
    amount: row.amount,
    currency: row.currency as PaymentCurrency,
    chargeReason: row.charge_reason,
    dueDate: row.due_date,
    customerNote: row.customer_note,
    invoiceDocumentId: row.invoice_document_id,
    methods: parseMethods(row.methods_json),
    status: row.status as PaymentStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at,
  };
}

export function getPaymentRow(tracking: string) {
  return db.prepare('SELECT * FROM shipment_payments WHERE tracking_number = ?').get(tracking) as PaymentRow | undefined;
}

function trackingParam(req: Request) {
  return String(req.params.trackingNumber).trim().toUpperCase();
}

// Requests are only managed on live shipments; a trashed one keeps its request untouched.
function shipmentExists(tracking: string) {
  return Boolean(db.prepare('SELECT 1 FROM shipments WHERE tracking_number = ? AND deleted_at_ts IS NULL').get(tracking));
}

// GET /api/shipments/:trackingNumber/payment — the request with its accounts, or null.
shipmentPaymentsRouter.get('/', (req: Request, res: Response) => {
  try {
    const tracking = trackingParam(req);
    if (!shipmentExists(tracking)) {
      return res.status(404).json({ success: false, error: `Shipment ${tracking} not found` });
    }
    const row = getPaymentRow(tracking);
    res.json({ success: true, data: row ? formatPayment(row) : null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/shipments/:trackingNumber/payment — creates or replaces the request. Status, created
// and paid times stay as they are on a replace (status changes go through E.5's status route).
shipmentPaymentsRouter.put('/', (req: Request, res: Response) => {
  try {
    const tracking = trackingParam(req);
    if (!shipmentExists(tracking)) {
      return res.status(404).json({ success: false, error: `Shipment ${tracking} not found` });
    }
    // Only ids already saved on this request survive; the server mints every other one (D-13).
    const saved = getPaymentRow(tracking);
    const keepIds = new Set(saved ? parseMethods(saved.methods_json).map((m) => m.id) : []);
    const result = validatePaymentRequest(req.body, { keepIds });
    if (!result.ok) {
      const first = Object.values(result.errors)[0];
      return res.status(400).json({ success: false, error: first, errors: result.errors });
    }
    const data = result.value;
    if (data.invoiceDocumentId) {
      const invoice = db.prepare("SELECT 1 FROM documents WHERE id = ? AND shipment_tracking = ? AND doc_type = 'INVOICE'").get(data.invoiceDocumentId, tracking);
      if (!invoice) {
        const error = 'Choose an invoice of this shipment.';
        return res.status(400).json({ success: false, error, errors: { invoiceDocumentId: error } });
      }
    }

    const now = new Date().toISOString();
    const existing = getPaymentRow(tracking);
    if (existing) {
      db.prepare(`
        UPDATE shipment_payments SET amount = ?, currency = ?, charge_reason = ?, due_date = ?, methods_json = ?,
          invoice_document_id = ?, customer_note = ?, updated_at = ?
        WHERE id = ?
      `).run(data.amount, data.currency, data.chargeReason, data.dueDate, JSON.stringify(data.methods),
        data.invoiceDocumentId, data.customerNote, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO shipment_payments (id, tracking_number, amount, currency, charge_reason, due_date, methods_json,
          invoice_document_id, status, customer_note, created_at, updated_at, paid_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AWAITING_PAYMENT', ?, ?, ?, NULL)
      `).run(crypto.randomUUID(), tracking, data.amount, data.currency, data.chargeReason, data.dueDate,
        JSON.stringify(data.methods), data.invoiceDocumentId, data.customerNote, now, now);
    }
    res.status(existing ? 200 : 201).json({ success: true, data: formatPayment(getPaymentRow(tracking)!) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/shipments/:trackingNumber/payment — removes the request (its proofs too, from G.1).
shipmentPaymentsRouter.delete('/', (req: Request, res: Response) => {
  try {
    const tracking = trackingParam(req);
    if (!shipmentExists(tracking)) {
      return res.status(404).json({ success: false, error: `Shipment ${tracking} not found` });
    }
    if (!getPaymentRow(tracking)) {
      return res.status(404).json({ success: false, error: 'This shipment has no payment request.' });
    }
    deleteShipmentPayment(tracking);
    res.json({ success: true, data: null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/shipments/:trackingNumber/payment/status — { action: cancel | mark_paid | reopen }.
// Marking paid sets paid_at and the linked invoice PAID; reopening a paid request puts that
// invoice back to PENDING. One transaction; 409 for a transition nextPaymentStatus refuses.
shipmentPaymentsRouter.post('/status', (req: Request, res: Response) => {
  try {
    const tracking = trackingParam(req);
    if (!shipmentExists(tracking)) {
      return res.status(404).json({ success: false, error: `Shipment ${tracking} not found` });
    }
    const action = req.body?.action;
    if (!(PAYMENT_STATUS_ACTIONS as readonly string[]).includes(action)) {
      return res.status(400).json({ success: false, error: 'action must be cancel, mark_paid or reopen.' });
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const row = getPaymentRow(tracking);
      if (!row) {
        db.exec('ROLLBACK');
        return res.status(404).json({ success: false, error: 'This shipment has no payment request.' });
      }
      const next = nextPaymentStatus(row.status, action);
      if (!next) {
        db.exec('ROLLBACK');
        return res.status(409).json({ success: false, error: `A request that is ${PAYMENT_STATUS_TEXT[row.status] ?? row.status} can't be changed that way.` });
      }
      const now = new Date().toISOString();
      const paidAt = next === 'PAID' ? now : next === 'AWAITING_PAYMENT' ? null : row.paid_at;
      db.prepare('UPDATE shipment_payments SET status = ?, paid_at = ?, updated_at = ? WHERE id = ?').run(next, paidAt, now, row.id);
      if (row.invoice_document_id) {
        if (next === 'PAID') setDocumentPaymentStatus(row.invoice_document_id, 'PAID');
        else if (next === 'AWAITING_PAYMENT' && row.status === 'PAID') setDocumentPaymentStatus(row.invoice_document_id, 'PENDING');
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ success: true, data: formatPayment(getPaymentRow(tracking)!) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PAYMENT_STATUS_TEXT: Record<string, string> = {
  AWAITING_PAYMENT: 'awaiting payment',
  UNDER_REVIEW: 'under review',
  PAID: 'paid',
  CANCELLED: 'cancelled',
};

// Used by DELETE above and by the permanent shipment delete. Trash/restore never calls it.
export function deleteShipmentPayment(tracking: string) {
  db.prepare('DELETE FROM shipment_payments WHERE tracking_number = ?').run(tracking);
}
