import rateLimit from 'express-rate-limit';
import { PROOF_ERROR_MESSAGES } from '../../src/shared/paymentProof.js';

// Applied to the public write endpoints (quote submission, shipment booking, document
// auto-generation) — none of these need a session, so nothing else stops a script from
// hammering them to spam the quotes/shipments tables. Much higher ceiling than the login
// limiter (server/routes/auth.ts) since real customers legitimately submitting a quote or
// booking a shipment is the normal case here, not something to be suspicious of — this is
// about stopping bulk/scripted abuse, not slowing down a real customer.
export const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again in a few minutes.' }
});

// Proof-of-payment uploads from the track page (update.md G.2): each one is an image on disk and a
// dashboard notification, so far stricter than the other public writes. Every attempt counts.
export const paymentProofLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', error: PROOF_ERROR_MESSAGES.RATE_LIMITED }
});
