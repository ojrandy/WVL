# PROMPT — Admin Path, Package Images, Payment Methods & Proof of Payment

> **How to use:** start a Claude Code session in the repo root and paste everything below the line, or say
> *"Follow docs/PROMPT-UPDATE.md, phase A"*. Run **one phase per session** (or one task if a phase is large).
> The prompt is reusable: each session picks up the next unchecked task in `docs/update.md`.
> Do **Phase A first** (admin path): every later phase tests the console at `/private-user/`.

---

## Role

You are a senior full-stack TypeScript developer maintaining the **World Vexa Logistics** platform for the owner. It
is a **working production system**: React 18 + TypeScript + Vite 6 SPA (hash routing in `src/App.tsx`), Express 5
API in `server/`, SQLite via `node:sqlite` (`data/app.db`), deployed to Hostinger from GitHub. You extend it in
place. You never scaffold, rewrite or restructure it, and you never change its look: new UI reuses the existing
design.

## Read first (every session, in this order)

1. `CLAUDE.md`: project rules. They override anything below if they conflict.
2. `docs/update.md`: **the tracker and spec for this update.** The design rules (§3), method list (§4), data model
   (§5), API (§6) and decisions (§9) there are the source of truth. If this prompt and `update.md` disagree,
   `update.md` wins. To change the spec, update `update.md` first and say why.
3. `docs/BRAND_GUIDE.md` (colours, naming) and the relevant `docs/CONTENT.md` section for any UI text.
4. The files you are about to touch, plus their callers. Trace the data flow before editing.

Then state in 3–5 lines: which task you're doing, which files you'll change, and what could break.

## Mission

1. **Admin console at `https://worldvexalogistics.com/private-user/`** instead of the `private.` subdomain. Same
   app, origin and API. The public site never opens the console; `#/admin` keeps working on localhost only.
2. **Package images with captions.** The admin uploads photos for a shipment and names each one; the public track
   page shows the visible ones.
3. **One payment request per shipment.** Amount in one of 12 currencies (USD default, `update.md` D-7), a
   **required charge reason**, and the payment accounts for
   *this* shipment, typed by the courier (17 types, `update.md` §4, each with its icon). The track page shows
   **only this shipment's accounts**, to anyone with the tracking ID.
4. **Proof of payment.** The customer uploads a screenshot (images only) and an optional reference. The admin is
   notified **on the dashboard (no email)** with the screenshot, and approves or rejects it.
5. **Admin fixes** (Phase J): dashboard edit pen, failed-save reporting, worldwide Edit Shipment, plain API errors
   with retry.

## Non-negotiables

- **Protect what works.** Tracking lookup, admin login, shipment create/edit/delete/restore, documents/PDFs,
  quotes, contact messages and DB persistence must work after every task. If a change risks them, stop and say so.
- **Same design.** Use the `--sdl-*` tokens from `src/styles/tokens.css`, the existing fonts, card, button, pill and
  modal styles; new classes use the `sdl-` prefix. Don't rename internal `sdl-*` names (CLAUDE.md §1).
- **Reuse existing code:** `server/db.ts` migration style (`CREATE TABLE IF NOT EXISTS`, guarded `ALTER`s, after
  the existing tables), `requireAdminAuth`, `server/middleware/rateLimit.ts` (`publicWriteLimiter` pattern), the
  `api` client in `src/services/api.ts`, `useAdminData` / `AdminDataContext`, the admin view switch in
  `src/admin/AdminApp.tsx` (`AdminViewType`, `AdminLayout` sidebar), `EditShipmentModal`, `CreateShipmentView`,
  `OperationsCenter`, `server/routes/stats.ts`, the invoice payment-status logic in `server/routes/documents.ts`,
  lucide-react icons.
- **Brand strings** come from `src/config/brand.ts` (`COMPANY`, `COMPANY_SHORT`, `OPERATIONS_CENTRE`,
  `EXAMPLE_TRACKING_ID`, `ADMIN_PATH`…). Never hard-code them.
- **Don't rename or drop** existing tables or columns. Leave `shipments.photos_json` in place and show its photos read-only.
- **Don't touch** `.env`, the live `data/app.db`, or `server/middleware/auth.ts` logic. Phase A changes where the
  console is served, not how login works.
- **No demo data:** no seeded shipments, payment accounts, images or proofs.
- **Public copy comes from `docs/CONTENT.md`.** Add it there first (flagged for owner review), then use it.
- **Gift cards are not a payment method** (`update.md` D-1). Don't add them, even if asked mid-session; point to D-1
  and ask the owner.
- **Payment data never goes in `settings.general`.** `GET /api/settings` is public.
- **No email/SMTP.** Notifications are dashboard-only (D-5).
- **New dependencies:** only `qrcode` (lazy-loaded) is pre-approved. Anything else: ask first.

## Technical requirements

### Admin path (Phase A)
- `ADMIN_PATH = '/private-user/'` in `brand.ts` replaces `ADMIN_SUBDOMAIN` / `ADMIN_HOST`; `isAdminHost()` becomes
  `isAdminPath()` with an exact segment match (`/private-user` or `/private-user/…`, case-sensitive).
- Express: `/private-user` → 301 `/private-user/`; `/private-user/` → `dist/index.html` with
  `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store, private`; deeper paths 404. Before `express.static`.
- `seo.ts`: admin by path, not host. `robots.txt` never names the admin path. Session cookie settings unchanged.
- Links from the console to public pages use `/#/<page>` on the same origin.

### Files & storage
- `UPLOADS_DIR` (default `data/uploads`) with `images/` (public) and `proofs/` (private) created on startup.
  Documented in `.env.example` and `docs/DEPLOYMENT.md`: persistent, **outside the deploy folder**, like `DB_PATH`,
  and in the backups.
- Client compression (`src/services/imageCompress.ts`): longest side ≤ 1600px, WebP (JPEG fallback), base64 +
  width/height. The canvas redraw strips EXIF/GPS, which is required. Uploads stay base64-in-JSON (≤ 5 MB body).
- Server validation (`server/uploads.ts`): decode, **magic bytes** (WebP/JPEG/PNG only), ~2 MB cap,
  `crypto.randomUUID()` names; never client names or paths.
- Public images: `GET /media/:id.webp`, only if `is_public = 1` and the shipment isn't trashed, long cache, `nosniff`.
  Proofs: admin-only route, `Cache-Control: private, no-store`.

### Payment methods
- `src/shared/paymentMethods.ts` is the **single registry** for server and client: `type`, `label`, `iconKey`,
  `fields[]` (`name`, `label`, `required`, `kind`, optional `options`), either/or rules, `copyable`, `qr`, optional
  `warning` (crypto network). Server validation, the admin editor and the track page all read from it.
- Validators in `src/shared/paymentValidation.ts` (`update.md` §4).
- Icons: local Simple Icons SVGs in `src/assets/payment-icons/` (CC0, source recorded in `update.md` §4) via
  `<PaymentIcon type size />` with a lucide fallback. Decorative (`aria-hidden`); the name is always shown as text.
- `/api/track/:id` adds `images[]` and `payment` (`update.md` §6), **only this shipment's accounts**, in the
  courier's order. Never other shipments' accounts, the invoice id, internal notes, proof files or other proofs' data.

### Proof submission
- `POST /api/track/:id/payment-proof`: own limiter (5/hour/IP). Only while `AWAITING_PAYMENT`, for one of this
  shipment's accounts, fewer than 3 open proofs. Fields: method_id, payer_name, amount_sent, reference (optional),
  image (required). On success the request becomes `UNDER_REVIEW`.
- Approve → `PAID` + `paid_at`; linked invoice PAID via the shared helper extracted from the documents route;
  optional "Payment confirmed" event (checkbox, ticked by default). Reject → reason required, back to `AWAITING_PAYMENT`.

### Dashboard notifications
- `/api/stats` returns `submittedProofsCount`. A badge on the **Payments** sidebar item and a bell in the admin
  header, polled every 30 s while `document.visibilityState === 'visible'`, refreshed on focus.
- `OperationsCenter`: a **"New payment proofs"** panel (thumbnail, tracking ID, amount due vs sent, method icon +
  name, reference, time). Click → full-size viewer with **Approve / Reject**. Empty state when nothing to review.
- New proof while the console is open → toast linking to it. Seen ids in `localStorage` key `wvl_seen_proofs`,
  every read and write in try/catch.

### UI quality (public and admin)
- Responsive at **375 / 768 / 1440**. Long values (IBANs, crypto addresses) wrap and never overflow.
- Track page: package photos (phone grid; tablet/desktop full width at a low fixed height). Payment section with
  status badge and `Intl.NumberFormat` amount; accounts behind a closed-by-default **"How to pay"** tab (accordion on
  mobile, grid on desktop); proof form behind a **"Send proof of payment"** tab. Every field has **Copy** with a
  "Copied" toast + `aria-live`. QR codes for crypto and links (lazy `qrcode`).
- Gallery viewer: full screen, Esc closes, arrows navigate, focus trapped and returned, captions as `alt`, explicit
  `width`/`height`, `loading="lazy"`.
- Admin payment editor: multi-select method tiles, per-account forms in turn, **live preview** of the customer view.
- Visible focus states, contrast ≥ 4.5:1, `prefers-reduced-motion` respected.
- Lean public bundle: lazy-load the payment section, the viewer and QR codes.

## Workflow per task

1. Mark the task `[~]` in `docs/update.md`.
2. Implement the smallest complete change for that one task, matching the surrounding style and comment density.
3. Verify:
   - `npm run build`: **zero TypeScript errors**.
   - `npm test`: passing. Add unit tests in `scripts/*.test.ts` for pure logic (validators, magic bytes, the
     track-response filter, the admin-path matcher).
   - Exercise the API on an **isolated instance with a scratch `DB_PATH` and `UPLOADS_DIR`**, never `data/app.db`.
   - UI tasks: check 375 / 768 / 1440 in a browser if one is available; otherwise say it's unchecked.
   - Old-brand grep from CLAUDE.md §8 shows nothing new.
4. Commit: one task per commit, prefix `feat:`, `fix:`, `content:` or `docs:`, clear message.
5. Tick `[x]` in `docs/update.md`, add a one-line Change log entry, and record anything for the owner under Needs owner.

## Stop and ask when

- A business fact is missing (currencies, copy wording, anything not in `CLAUDE.md` §2 or `update.md`).
- A change would alter existing behaviour of tracking, admin auth, shipments, documents or quotes, or the look of
  an existing page.
- You'd need a new dependency other than `qrcode`, a framework change, or a schema change to existing tables.
- Anything conflicts with `CLAUDE.md` or `docs/update.md`.

## Definition of done (whole update)

The example flow in `update.md` §1 works end to end on a scratch DB, and:
- [ ] The console opens only at `/private-user/` (and `#/admin` on localhost); the public site never shows it;
      the path has noindex and isn't in robots.txt or the sitemap.
- [ ] Another shipment's account or a removed account never appears in `/api/track/:id`.
- [ ] `/api/settings` contains no payment data.
- [ ] Proof files return 401 without an admin session; non-image uploads are rejected; the rate limit triggers.
- [ ] Uploaded files survive a server restart and live under `UPLOADS_DIR`.
- [ ] A new proof shows on the dashboard with its screenshot within about 30 s, without a page reload.
- [ ] Regression: tracking, admin login, shipment CRUD + trash/restore, documents/PDFs, quotes all work.
- [ ] `npm run build` is clean, and every task in `update.md` is ticked or marked `[!]` with a reason.

## Report back after each task (keep it short)

- **Done:** what changed, in one or two sentences.
- **Files:** the files changed.
- **Verified:** commands run and their results (paste failures as-is), plus what was checked in the browser.
- **Risks / follow-ups:** anything uncertain or deferred.
- **Needs owner:** open questions, if any.
