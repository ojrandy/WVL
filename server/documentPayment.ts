import { db } from './db.js';

// The invoice paid/pending switch, shared by PATCH /api/documents/:id/payment-status and the
// payment request status changes (update.md E.5, G.6). Behaviour is exactly what the documents
// route did inline: paymentStatus goes into charges_json, with a paidDate while PAID.
export type DocumentPaymentStatus = 'PAID' | 'PENDING';

/** Returns false when the document doesn't exist. */
export function setDocumentPaymentStatus(id: string, paymentStatus: DocumentPaymentStatus): boolean {
  const row = db.prepare('SELECT charges_json FROM documents WHERE id = ?').get(id) as { charges_json: string | null } | undefined;
  if (!row) return false;

  const charges = row.charges_json ? JSON.parse(row.charges_json) : {};
  charges.paymentStatus = paymentStatus;
  if (paymentStatus === 'PAID') {
    charges.paidDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } else {
    delete charges.paidDate;
  }

  db.prepare('UPDATE documents SET charges_json = ? WHERE id = ?').run(JSON.stringify(charges), id);
  return true;
}
