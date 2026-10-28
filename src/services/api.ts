import { Shipment, ShipmentStatus, TrackingEvent, AdminShipmentImage } from '../types/shipment';
import type { AdminPaymentRequest, PaymentStatusAction } from '../shared/paymentRequest';
import type { AdminPaymentProof, ProofCounts, ProofStatus } from '../shared/paymentProof';
import { QuoteRequest, QuoteRequestPricing, QuoteRequestStatus, AdminSettings, AdminDocument, DocumentStatus, ContactMessage, ContactMessageStatus } from '../types/admin';

const API_BASE = '/api';

// Shown when the server's reply can't be read even after the retries (CONTENT.md §10).
export const READ_FAILED_MESSAGE = "We couldn't reach the server just now. Please try again in a moment.";
export const WRITE_UNCONFIRMED_MESSAGE = "We couldn't confirm that this went through. Please check before sending it again.";

// Reads are retried after these pauses on a dropped connection or a non-JSON reply (the hosting
// CDN has been seen answering with an empty or HTML body). Writes are sent once: a retry could
// store the same shipment, proof or message twice.
const READ_RETRY_DELAYS_MS = [700, 1800];

interface ApiOptions {
  method?: string;
  /** Sent as JSON. */
  body?: unknown;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  /** Resolve a 404 with null instead of throwing. */
  nullOn404?: boolean;
  /** Return the whole JSON body instead of its `data`. */
  fullBody?: boolean;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Every API request goes through here. Errors carry `status` (0 when no reply), and where the
 * route sends them `errors` (field errors) and `code`; an unreadable reply has `code`
 * 'NETWORK' or 'NON_JSON' and a plain message.
 */
async function fetchApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const init: RequestInit = { method, cache: options.cache, credentials: options.credentials };
  if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  const delays = isRead ? READ_RETRY_DELAYS_MS : [];

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, init);
    } catch (fetchErr) {
      if (attempt < delays.length) { await wait(delays[attempt]); continue; }
      console.error(`[API] ${method} ${path}: no reply from the server`, fetchErr);
      const err: any = new Error(isRead ? READ_FAILED_MESSAGE : WRITE_UNCONFIRMED_MESSAGE);
      err.status = 0;
      err.code = 'NETWORK';
      throw err;
    }

    if (options.nullOn404 && res.status === 404) return null as T;

    const text = await res.text().catch(() => '');
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      if (attempt < delays.length) { await wait(delays[attempt]); continue; }
      console.error(`[API] ${method} ${path}: reply is not JSON`, {
        status: res.status,
        contentType: res.headers.get('content-type'),
        bodyStart: text.slice(0, 200),
      });
      const err: any = new Error(isRead ? READ_FAILED_MESSAGE : WRITE_UNCONFIRMED_MESSAGE);
      err.status = res.status;
      err.code = 'NON_JSON';
      throw err;
    }

    if (!res.ok || json?.success === false) {
      // Attaching the real HTTP status lets callers tell "not authenticated, stop retrying"
      // apart from "transient failure, keep retrying" — see AdminDataContext's periodic
      // refresh, which used to retry every 12s forever even for a logged-out visitor.
      const err: any = new Error(json?.error || `HTTP error ${res.status}`);
      err.status = res.status;
      // Field errors keyed by field name, where a route sends them (payment request PUT).
      if (json?.errors && typeof json.errors === 'object') err.errors = json.errors;
      // A machine-readable reason, where a route sends one (payment proof: NOT_ACCEPTING…).
      if (typeof json?.code === 'string') err.code = json.code;
      throw err;
    }
    if (options.fullBody) return json as T;
    return json.data !== undefined ? json.data : json;
  }
}

const id = encodeURIComponent;

export const api = {
  // Admin Auth
  async login(password: string): Promise<{ success: boolean }> {
    try {
      return await fetchApi<{ success: boolean }>('/auth/login', {
        method: 'POST', body: { password }, credentials: 'include', cache: 'no-store', fullBody: true
      });
    } catch (err: any) {
      if (err?.code === 'NETWORK') throw new Error("Can't reach the server. Check your connection and try again.");
      if (err?.code === 'NON_JSON') {
        // The body is unreliable but the session cookie isn't, so ask the server whether login took.
        if (err.status >= 200 && err.status < 300 && await api.checkSession()) return { success: true };
        if (err.status === 401) throw new Error('Incorrect password.');
        if (err.status === 429) throw new Error('Too many login attempts. Try again in a few minutes.');
        throw new Error('Sign-in is temporarily unavailable. Please try again in a moment.');
      }
      throw err;
    }
  },

  async logout(): Promise<void> {
    await fetchApi('/auth/logout', { method: 'POST', credentials: 'include', fullBody: true });
  },

  async checkSession(): Promise<boolean> {
    try {
      const json = await fetchApi<any>('/auth/session', { credentials: 'include', cache: 'no-store', fullBody: true });
      return Boolean(json?.isAdmin);
    } catch {
      return false;
    }
  },

  // Public Tracking
  async trackShipment(trackingNumber: string): Promise<Shipment> {
    return fetchApi<Shipment>(`/track/${id(trackingNumber)}`);
  },

  // Public Booking & Quotes
  async submitPublicQuote(quoteData: Partial<QuoteRequest>): Promise<QuoteRequest> {
    return fetchApi<QuoteRequest>('/quotes', { method: 'POST', body: quoteData });
  },

  async submitPublicShipment(shipmentData: Partial<Shipment>): Promise<Shipment> {
    return fetchApi<Shipment>('/shipments', { method: 'POST', body: shipmentData });
  },

  // Admin Shipments
  async getShipments(params?: { search?: string; status?: string }): Promise<Shipment[]> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    return fetchApi<Shipment[]>(`/shipments?${query.toString()}`);
  },

  // Soft-deleted shipments — "Delete" moves a shipment here rather than erasing it; this is
  // the Recently Deleted / trash list.
  async getTrashedShipments(): Promise<Shipment[]> {
    return fetchApi<Shipment[]>('/shipments?trash=true');
  },

  async restoreShipment(trackingNumber: string): Promise<Shipment> {
    return fetchApi<Shipment>(`/shipments/${id(trackingNumber)}/restore`, { method: 'POST' });
  },

  // Permanent, irreversible delete — only ever called from the trash view on a shipment
  // that's already soft-deleted, as a deliberate separate action from the ordinary delete.
  async permanentlyDeleteShipment(trackingNumber: string): Promise<{ success: boolean; message: string }> {
    return fetchApi(`/shipments/${id(trackingNumber)}/permanent`, { method: 'DELETE' });
  },

  // Single fresh shipment, server-synced (unmasked, admin-only — never call this from a
  // public-facing page; use trackShipment there instead).
  async getShipment(trackingNumber: string): Promise<Shipment> {
    return fetchApi<Shipment>(`/shipments/${id(trackingNumber)}`);
  },

  async createShipment(shipmentData: Partial<Shipment>): Promise<Shipment> {
    return fetchApi<Shipment>('/shipments', { method: 'POST', body: shipmentData });
  },

  async updateShipmentStatus(
    trackingNumber: string,
    newStatus: ShipmentStatus,
    location?: string,
    facility?: string,
    notes?: string,
    progressPercent?: number,
    statusText?: string,
    lat?: number,
    lng?: number,
    eventTitle?: string,
    skipEventCreation?: boolean,
    estimatedDeliveryDate?: string,
    estimatedDeliveryTime?: string
  ): Promise<Shipment> {
    return fetchApi<Shipment>(`/shipments/${id(trackingNumber)}/status`, {
      method: 'PATCH',
      body: { newStatus, location, facility, notes, progressPercent, statusText, lat, lng, eventTitle, skipEventCreation, estimatedDeliveryDate, estimatedDeliveryTime }
    });
  },

  async updateShipment(trackingNumber: string, shipment: Partial<Shipment>): Promise<Shipment> {
    return fetchApi<Shipment>(`/shipments/${id(trackingNumber)}`, { method: 'PUT', body: shipment });
  },

  async addTrackingEvent(trackingNumber: string, event: Partial<TrackingEvent>): Promise<Shipment> {
    return fetchApi<Shipment>(`/shipments/${id(trackingNumber)}/events`, { method: 'POST', body: event });
  },

  async correctTrackingEvent(trackingNumber: string, eventId: string, updates: Partial<TrackingEvent>): Promise<Shipment> {
    return fetchApi<Shipment>(`/shipments/${id(trackingNumber)}/events/${id(eventId)}`, { method: 'PATCH', body: updates });
  },

  // Return to origin: the server creates the return as its own shipment with a new WVL ID.
  async initiateReturn(trackingNumber: string, reason: string, operator?: string): Promise<{ original: Shipment; returnShipment: Shipment }> {
    return fetchApi(`/shipments/${id(trackingNumber)}/return`, { method: 'POST', body: { reason, operator } });
  },

  // Package images (admin). Every write returns the shipment's full, re-ordered list.
  async getShipmentImages(trackingNumber: string): Promise<AdminShipmentImage[]> {
    return fetchApi<AdminShipmentImage[]>(`/shipments/${id(trackingNumber)}/images`, { cache: 'no-store' });
  },

  async uploadShipmentImage(trackingNumber: string, image: { image: string; caption: string; width: number; height: number; isPublic?: boolean }): Promise<AdminShipmentImage[]> {
    return fetchApi<AdminShipmentImage[]>(`/shipments/${id(trackingNumber)}/images`, { method: 'POST', body: image });
  },

  async updateShipmentImage(trackingNumber: string, imageId: string, updates: { caption?: string; isPublic?: boolean }): Promise<AdminShipmentImage[]> {
    return fetchApi<AdminShipmentImage[]>(`/shipments/${id(trackingNumber)}/images/${id(imageId)}`, { method: 'PATCH', body: updates });
  },

  async reorderShipmentImages(trackingNumber: string, ids: string[]): Promise<AdminShipmentImage[]> {
    return fetchApi<AdminShipmentImage[]>(`/shipments/${id(trackingNumber)}/images/order`, { method: 'PUT', body: { ids } });
  },

  async deleteShipmentImage(trackingNumber: string, imageId: string): Promise<AdminShipmentImage[]> {
    return fetchApi<AdminShipmentImage[]>(`/shipments/${id(trackingNumber)}/images/${id(imageId)}`, { method: 'DELETE' });
  },

  // Payment request (admin): the shipment's one request with its accounts, or null.
  async getShipmentPayment(trackingNumber: string): Promise<AdminPaymentRequest | null> {
    return fetchApi<AdminPaymentRequest | null>(`/shipments/${id(trackingNumber)}/payment`, { cache: 'no-store' });
  },

  async saveShipmentPayment(trackingNumber: string, request: unknown): Promise<AdminPaymentRequest> {
    return fetchApi<AdminPaymentRequest>(`/shipments/${id(trackingNumber)}/payment`, { method: 'PUT', body: request });
  },

  async setShipmentPaymentStatus(trackingNumber: string, action: PaymentStatusAction): Promise<AdminPaymentRequest> {
    return fetchApi<AdminPaymentRequest>(`/shipments/${id(trackingNumber)}/payment/status`, { method: 'POST', body: { action } });
  },

  // Proof of payment from the track page (public; update.md G.2). Errors carry `code` and `errors`.
  async submitPaymentProof(trackingNumber: string, proof: {
    methodId: string; payerName: string; amountSent: string; reference: string; image: string;
  }): Promise<{ status: 'UNDER_REVIEW'; proof: { status: 'SUBMITTED'; submittedAt: string } }> {
    return fetchApi(`/track/${id(trackingNumber)}/payment-proof`, { method: 'POST', body: proof });
  },

  // Payment proofs (admin Payments page; update.md G.5). status 'ALL' lists every proof.
  async getPaymentProofs(status: ProofStatus | 'ALL' = 'SUBMITTED'): Promise<{ proofs: AdminPaymentProof[]; counts: ProofCounts }> {
    return fetchApi(`/payments/proofs?status=${status}`, { cache: 'no-store' });
  },

  // Review (update.md G.6). Approve marks the request paid; addEvent adds "Payment confirmed".
  async approvePaymentProof(proofId: string, addEvent: boolean): Promise<AdminPaymentProof> {
    return fetchApi<AdminPaymentProof>(`/payments/proofs/${id(proofId)}/approve`, { method: 'POST', body: { addEvent } });
  },

  async rejectPaymentProof(proofId: string, reason: string): Promise<AdminPaymentProof> {
    return fetchApi<AdminPaymentProof>(`/payments/proofs/${id(proofId)}/reject`, { method: 'POST', body: { reason } });
  },

  async deleteShipmentPayment(trackingNumber: string): Promise<void> {
    await fetchApi<null>(`/shipments/${id(trackingNumber)}/payment`, { method: 'DELETE' });
  },

  async deleteShipment(trackingNumber: string): Promise<{ success: boolean; message: string }> {
    return fetchApi(`/shipments/${id(trackingNumber)}`, { method: 'DELETE' });
  },

  // Admin Quotes
  async getQuotes(): Promise<QuoteRequest[]> {
    return fetchApi<QuoteRequest[]>('/quotes');
  },

  // Public: a single quote by its own ID (used by the "look up my quote" flow) — scoped to
  // one record instead of pulling every customer's quotes to find a match client-side.
  async getPublicQuote(quoteId: string): Promise<QuoteRequest | null> {
    return fetchApi<QuoteRequest | null>(`/quotes/${id(quoteId)}`, { nullOn404: true });
  },

  async publishQuote(quoteId: string, pricing: QuoteRequestPricing, internalNotes?: string): Promise<QuoteRequest> {
    return fetchApi<QuoteRequest>(`/quotes/${id(quoteId)}/publish`, { method: 'PUT', body: { pricing, internalNotes } });
  },

  async updateQuoteStatus(quoteId: string, status: QuoteRequestStatus, validUntil?: string): Promise<QuoteRequest> {
    return fetchApi<QuoteRequest>(`/quotes/${id(quoteId)}/status`, { method: 'PATCH', body: { status, validUntil } });
  },

  async convertQuoteToShipment(quoteId: string, shipment?: Partial<Shipment>): Promise<{ trackingNumber: string; data: Shipment }> {
    // The new ID is sent beside `data` (a raw database row), so read the whole body.
    const body = await fetchApi<any>(`/quotes/${id(quoteId)}/convert`, { method: 'POST', body: shipment || {}, fullBody: true });
    return { trackingNumber: body?.trackingNumber, data: body?.data !== undefined ? body.data : body };
  },

  // Admin Documents
  async getDocuments(params?: { docType?: string; status?: string; search?: string }): Promise<AdminDocument[]> {
    const query = new URLSearchParams();
    if (params?.docType) query.set('docType', params.docType);
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    return fetchApi<AdminDocument[]>(`/documents?${query.toString()}`);
  },

  async generateDocument(docData: AdminDocument): Promise<AdminDocument> {
    return fetchApi<AdminDocument>('/documents/generate', { method: 'POST', body: docData });
  },

  async regenerateDocument(docId: string, notes?: string, refreshedFields?: Partial<AdminDocument>): Promise<AdminDocument> {
    return fetchApi<AdminDocument>(`/documents/${id(docId)}/regenerate`, { method: 'POST', body: { notes, ...refreshedFields } });
  },

  async updateDocumentStatus(docId: string, status: DocumentStatus): Promise<AdminDocument> {
    return fetchApi<AdminDocument>(`/documents/${id(docId)}/status`, { method: 'PATCH', body: { status } });
  },

  async updateDocumentPaymentStatus(docId: string, paymentStatus: 'PAID' | 'PENDING'): Promise<AdminDocument> {
    return fetchApi<AdminDocument>(`/documents/${id(docId)}/payment-status`, { method: 'PATCH', body: { paymentStatus } });
  },

  async deleteDocument(docId: string): Promise<{ success: boolean; message: string }> {
    return fetchApi(`/documents/${id(docId)}`, { method: 'DELETE' });
  },

  // Settings
  async getSettings(): Promise<AdminSettings> {
    return fetchApi<AdminSettings>('/settings');
  },

  async updateSettings(settings: Partial<AdminSettings>): Promise<AdminSettings> {
    return fetchApi<AdminSettings>('/settings', { method: 'PUT', body: settings });
  },

  // Contact form (public submit) and the admin Messages inbox
  async submitContactMessage(message: Pick<ContactMessage, 'name' | 'email' | 'phone' | 'subject' | 'priority' | 'trackingNumber' | 'gatewayCode' | 'message'>): Promise<ContactMessage> {
    return fetchApi<ContactMessage>('/messages', { method: 'POST', body: message });
  },

  async getContactMessages(): Promise<ContactMessage[]> {
    return fetchApi<ContactMessage[]>('/messages', { credentials: 'include' });
  },

  async updateContactMessageStatus(messageId: string, status: ContactMessageStatus): Promise<ContactMessage> {
    return fetchApi<ContactMessage>(`/messages/${id(messageId)}/status`, { method: 'PATCH', credentials: 'include', body: { status } });
  },

  // Dashboard Stats
  async getStats(): Promise<any> {
    return fetchApi<any>('/stats', { cache: 'no-store' });
  }
};
