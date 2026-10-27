# Update: Admin Path, Package Images, Payment Methods & Proof of Payment

> Tracker and spec for this one update. It follows the same rules as `CLAUDE.md` and `docs/PROJECT_TRACKER.md`:
> change the existing system in place, one task → one small commit, `npm run build` must pass with zero
> TypeScript errors after every task, and tracking, admin login, shipment creation, documents, quotes and the
> database must keep working.
>
> **Origin.** This spec was adapted on 2026-10-27 from a feature spec written for a sibling codebase of this
> platform. Every name in it (files, tokens, prefixes, DB file, storage keys) has been mapped to this repo. None of
> these features exist here yet; every task below starts unchecked.

**Status legend:** `[ ]` to do · `[~]` in progress · `[x]` done · `[!]` blocked (see Needs owner)

---

## 1. What this update delivers

0. **Admin console moves to a subfolder.** The console opens at **`https://worldvexalogistics.com/private-user/`**
   (same app, same domain, same API) instead of the `private.` subdomain. No extra DNS record or SSL certificate.
1. **Package images with captions.** The admin uploads one or more photos for a shipment and names each one
   (e.g. "iPhone 15 – sealed at origin"). Customers see them on the track page.
2. **Payment request per shipment.** There is **no fixed account list** (D-9). While creating a shipment (before
   the tracking ID exists) the courier can add **one payment request**: amount, reason, and the payment accounts
   for *this* shipment (PayPal, Bitcoin, Zelle, bank transfer…), typing each account's details. All of it can be
   edited or deleted later from the shipment. **Only the accounts on that shipment** appear on its track page,
   each with its icon and exact details.
3. **Proof of payment.** On the track page the customer uploads a screenshot (images only) and an optional
   reference number. The admin reviews it and approves or rejects it. The admin is notified **on the
   dashboard**: a badge, a bell and a "New payment proofs" panel showing the screenshot.
4. **Admin fixes found in the same code:** Edit Shipment has U.S. defaults, a failed edit save shows a success
   toast, the dashboard has no edit pen, and a non-JSON reply shows "Server returned non-JSON response" (Phase J).

### Example flow
> Courier opens `/private-user/`, fills in Create Shipment including the payment step ($120.00 USD, "Customs duty –
> Invoice WVL-INV-104233", a **PayPal** account and a **Bitcoin** wallet typed in for this shipment) → submits →
> the shipment gets `WVL7K2M9` and its payment request is saved with it → uploads a photo captioned "iPhone 15".
> The customer tracks `WVL7K2M9` and sees the photo, the amount, the reason, and **only** the PayPal and Bitcoin
> cards → pays → uploads a screenshot + reference → status shows "Proof under review" → admin approves → status
> shows "Paid". At any point the courier can edit the accounts or amount, or delete the request.

---

## 2. Owner decisions

Adopted with this spec on 2026-10-27. The owner can change any of them; record the change in §9 first.

| # | Question | Decision |
|---|---|---|
| 0 | Where does the admin console live? | **`/private-user/` on the main domain** (owner, 2026-10-27; D-11). The `private.` subdomain is dropped. |
| 1 | What is the "name" on an image? | A **caption per image** |
| 2 | Which payment methods? | PayPal, crypto and the common US/UK methods (list in §4) |
| 3 | Payment requests per shipment | **One** per shipment |
| 4 | Who sees payment details? | **Anyone with the tracking ID**, but only the accounts on that shipment's request |
| 4b | Where do account details come from? | **Typed per shipment** by the courier (no fixed list), at creation or later; full create/edit/delete (D-9) |
| 5 | Proof file types | **Images only** (JPG, PNG, WebP; HEIC converted in the browser where supported) |
| 6 | New-proof notification | **Admin dashboard only** (badge, bell, panel with the screenshot, toast), no email (D-5) |
| 7 | Currency | **12 currencies**, USD by default: USD, EUR, GBP, CHF, CAD, AUD, NZD, JPY, SGD, HKD, AED, KWD (D-7) |
| 8 | "Payment confirmed" tracking event on approve | **Ticked by default**, admin can untick (D-8) |

---

## 3. Design rules for this update

### Admin path (Phase A)
- **One constant.** `ADMIN_PATH = '/private-user/'` in `src/config/brand.ts` replaces `ADMIN_SUBDOMAIN` /
  `ADMIN_HOST`. Client and server import it; the path is written nowhere else (docs excepted).
- **Exact segment match.** The console opens only when `location.pathname` is `/private-user` or starts with
  `/private-user/`. `/private-userx`, `/Private-User/`, `/#/private-user` and `#/admin` on the public domain all show
  the public site, as `#/admin` does today. `#/admin` still opens the console on `localhost` / `127.0.0.1` only.
- **The admin path shows only the console.** Any public link clicked inside it goes to `/#/<page>` on the same
  origin (today it goes to `SITE_URL`). "View public tracking" opens `/#/track/<ID>`.
- **Server.** `GET /private-user` → `301` to `/private-user/`. `GET /private-user/` → `dist/index.html` with
  `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store, private` (Hostinger's CDN must never cache it).
  Deeper paths under it are 404. Vite already builds absolute asset URLs (`/assets/…`, `/brand/…`), so the page
  loads from the subfolder unchanged; keep `base: '/'`.
- **SEO.** `seo.ts` decides "admin request" by path (`req.path` under `ADMIN_PATH`), not host. `robots.txt` and
  `sitemap.xml` are the public ones on every path and **never name `/private-user/`** (listing it in robots.txt would
  publish it). The noindex header + the runtime robots meta tag keep it out of search results.
- **Session cookie.** Unchanged (`admin.sid`, host-only, `httpOnly`, `secure` in production, path `/` because the
  API is at `/api`). The console and the public site now share one origin, so the cookie is also sent on public page
  loads; it carries no data and the public API ignores it. Security still rests on the password, the login rate
  limit and `requireAdminAuth`, not on the path being secret.
- **`ADMIN_PROXY_TARGET`** (the separate-admin-app fallback) only made sense for a subdomain. Its code was
  removed on 2026-10-27 (owner), with the `http-proxy-middleware` dependency.

### Images, payments and proofs
- **Payment accounts are never stored in `settings.general`.** `GET /api/settings` is public. Accounts live on the
  shipment's payment request (`shipment_payments.methods_json`), written only through admin routes. The public
  track endpoint returns only that shipment's accounts.
- **The public booking endpoint never accepts payment data.** `POST /api/shipments` is public (the Ship page uses
  it), so Create Shipment saves the payment request through the admin-only payment route right after the server
  assigns the tracking ID.
- **Image files are not stored in SQLite.** They go to **`UPLOADS_DIR`**, which (like `DB_PATH`) sits **outside the
  deploy folder** on Hostinger. Otherwise every GitHub redeploy deletes them.
- **Images are compressed in the browser before upload:** longest side ≤ 1600px, WebP (JPEG fallback), about
  200–400 KB. Redrawing on a canvas also **strips EXIF data, including GPS location**. No native image library
  (sharp is unreliable on shared hosting). Uploads stay base64-in-JSON within the existing 5 MB `express.json` limit.
- **The server checks every upload by content** (magic bytes), never by name, with a ~2 MB cap after compression.
- **Package images are public** only when marked visible, served from `/media/<random-id>.webp`.
- **Payment proofs are private.** Served only through an admin-authenticated route (`private, no-store`), because
  screenshots show names and account numbers.
- **Every payment request needs a charge reason.** The customer always sees *what* they pay for. The request can
  link to an existing `WVL-INV-` invoice of the same shipment; approving the payment then marks that invoice PAID
  using the existing logic in `server/routes/documents.ts` (extracted into a shared helper, behaviour unchanged).
- **One shared definition** of the method types (`src/shared/paymentMethods.ts`), used by server and client:
  type → label, icon, fields, validation, customer view. Adding a method later means adding one entry.
- **Design.** No new look: new UI uses the existing `--sdl-*` tokens, fonts, radii and card styles from
  `src/styles/tokens.css` / `global.css`, and new class names follow the `sdl-` prefix. Brand red/black per
  `docs/BRAND_GUIDE.md`. Responsive at 375 / 768 / 1440; long values wrap, never overflow.
- Copy for every new public string goes into `docs/CONTENT.md` (§6.6–§6.8, flagged for owner review) **before** use.
- No demo data: no sample shipments, payment accounts, images or proofs are seeded (CLAUDE.md rule 10).

---

## 4. Payment method types (initial list)

| # | Type | Fields the admin fills in | Customer sees |
|---|---|---|---|
| 1 | PayPal | PayPal email **or** paypal.me link, account name | Copy email / "Open PayPal" button + QR |
| 2 | Bitcoin (BTC) | Wallet address, network (Bitcoin / Lightning) | Address + copy + QR |
| 3 | USDT (Tether) | Wallet address, **network** (TRC20 / ERC20 / BEP20…) | Address + network warning + copy + QR |
| 4 | Ethereum (ETH) | Wallet address, network | Address + copy + QR |
| 5 | Zelle | Email or US phone, recipient name | Copy fields |
| 6 | Cash App | $Cashtag, name | Copy + "Open Cash App" link |
| 7 | Venmo | @username, name | Copy + link |
| 8 | Apple Pay / Apple Cash | Phone or email, name | Copy fields |
| 9 | Google Pay | Phone or email, name | Copy fields |
| 10 | US bank transfer (ACH / wire) | Account name, bank, routing number, account number, account type, bank address | Copy fields |
| 11 | UK bank transfer (Faster Payments) | Account name, bank, sort code, account number | Copy fields |
| 12 | International wire (SWIFT / IBAN) | Beneficiary, bank, IBAN / account, SWIFT/BIC, bank address, country | Copy fields |
| 13 | Wise | Email or Wisetag, name | Copy fields |
| 14 | Revolut | @Revtag or phone, name | Copy fields |
| 15 | Card payment link | Checkout URL (Stripe, Square, etc.) | "Pay by card" button + QR |
| 16 | Western Union | Receiver full name, country, city | Copy fields + "send MTCN as reference" note |
| 17 | MoneyGram | Receiver full name, country, city | Copy fields + reference note |

Every account also has: display label (optional override), **instructions** (free text, optional) and its position
in the list. A request can hold **several accounts of the same type** (e.g. two bank accounts), 1–10 in total.

**Gift cards are not included.** See D-1.

### Validators (`src/shared/paymentValidation.ts`)
Email; https URL (optional host check, e.g. `paypal.me`); phone; IBAN mod-97; UK sort code `NN-NN-NN`; US ABA routing
checksum; SWIFT/BIC; crypto address format per coin and network; `$Cashtag`; `@handle`; account-number digits.
Field kinds: `text | email | url | phone | crypto | iban | sortCode | routing | swift | cashtag | handle |
accountNumber`. Fields may carry `options` (networks, account type) and either/or rules (PayPal email **or** link).

### Icons
- Brand marks from **Simple Icons 16.34.0** (`https://cdn.jsdelivr.net/npm/simple-icons@16.34.0/icons/<slug>.svg`),
  downloaded once into `src/assets/payment-icons/` (no requests to other sites at runtime). Simple Icons is
  **CC0 1.0**. The marks stay **trademarks of their owners**: used only to identify the method, next to its name,
  unmodified except for colour. Record the download date here when D.2 is done.
- A generated path module (`index.ts`, built by `scripts/payment-icons.mjs`) so no Vite-specific SVG imports and no
  raw HTML; `scripts/paymentIcons.test.ts` fails if it drifts from the SVGs.
- `<PaymentIcon type size />`, decorative (`aria-hidden`); the method name is always shown as text.

| Icon (slug) | Used for | Colour used |
|---|---|---|
| `paypal` | PayPal | #002991 |
| `bitcoin` | Bitcoin (BTC) | #F7931A |
| `tether` | USDT (Tether) | #50AF95 |
| `ethereum` | Ethereum (ETH) | #3C3C3D |
| `zelle` | Zelle | #6D1ED4 |
| `cashapp` | Cash App | #00C244 |
| `venmo` | Venmo | #008CFF |
| `applepay` | Apple Pay / Apple Cash | #000000 |
| `googlepay` | Google Pay | #4285F4 |
| `wise` | Wise | #163300 (the listed #9FE870 is too light on white) |
| `revolut` | Revolut | #191C1F |
| `westernunion` | Western Union | #1A1A1A (the listed #FFDD00 is too light on white) |
| `moneygram` | MoneyGram | #DA291C |

Generic types use lucide: `Landmark` (US and UK bank), `Globe` (international wire), `CreditCard` (card payment
link), `Wallet` (any unknown type).

---

## 5. Data model (new tables; existing ones are not renamed or changed)

Created in `server/db.ts` with `CREATE TABLE IF NOT EXISTS`, after the existing tables, so they appear on an existing
`data/app.db` at start-up. `shipments.photos_json` stays and its photos are shown read-only (C.7).

```sql
shipment_images (
  id TEXT PRIMARY KEY,            -- random, also the public file name
  tracking_number TEXT NOT NULL,
  caption TEXT NOT NULL,          -- e.g. "iPhone 15", ≤ 120 chars
  file_name TEXT NOT NULL,        -- stored under UPLOADS_DIR/images/
  width INTEGER, height INTEGER, size_bytes INTEGER,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)

shipment_payments (               -- ONE per shipment; all of it admin-written
  id TEXT PRIMARY KEY,
  tracking_number TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,         -- ISO 4217, one of PAYMENT_CURRENCIES (D-7); amount is in this currency
  charge_reason TEXT NOT NULL,    -- required, 3–200 chars, shown to the customer
  due_date TEXT,
  methods_json TEXT NOT NULL,     -- this shipment's accounts, in display order:
                                  --   [{ id, type, label, details, instructions }]
                                  --   type = key from src/shared/paymentMethods.ts; details validated by it
  invoice_document_id TEXT,       -- optional link to documents.id (an INVOICE of the same shipment)
  status TEXT NOT NULL,           -- AWAITING_PAYMENT | UNDER_REVIEW | PAID | CANCELLED
  customer_note TEXT,             -- optional extra line on the track page, ≤ 300 chars
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, paid_at TEXT
)

payment_proofs (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  method_id TEXT,                 -- id of the account (inside methods_json) the customer says they used
  method_snapshot_json TEXT,      -- type/label/details at submission (accounts can be edited or removed later)
  payer_name TEXT NOT NULL,
  amount_sent REAL,
  reference TEXT,                 -- transaction ID / MTCN / tx hash (optional)
  file_name TEXT NOT NULL,        -- stored under UPLOADS_DIR/proofs/ (private)
  status TEXT NOT NULL,           -- SUBMITTED | APPROVED | REJECTED
  admin_note TEXT,                -- rejection reason shown to the customer
  created_at TEXT NOT NULL, reviewed_at TEXT
)
```

**Deleting a shipment:** images, payment and proofs follow the existing trash/restore behaviour (kept while in the
trash). Rows and files are removed only when the shipment is permanently deleted. Deleting a payment request also
removes its proofs (rows and files).

---

## 6. API

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /private-user` · `/private-user/` | public | 301 to the slash form · the SPA shell with noindex + `no-store` (Phase A) |
| `GET/POST /api/shipments/:id/images` | admin | list / upload (base64 WebP + caption; max 20 per shipment) |
| `PATCH/DELETE /api/shipments/:id/images/:imageId` | admin | caption, visibility / delete |
| `PUT /api/shipments/:id/images/order` | admin | reorder: `{ ids: [...] }` in the new order |
| `GET /api/shipments/:id/images/:imageId/file` | admin | the image, visible or hidden, for console previews (`no-store`) |
| `GET /media/:imageId.<ext>` | public | a **visible** image of a non-trashed shipment (404 otherwise), 1-year immutable cache, `nosniff`. `.webp`, or `.jpg` when the browser couldn't encode WebP. The track response gives the full URL. |
| `GET/PUT/DELETE /api/shipments/:id/payment` | admin | the shipment's single payment request **including its accounts** (PUT creates/replaces, DELETE removes). Every account validated by the shared registry. |
| `POST /api/shipments/:id/payment/status` | admin | `action`: `cancel` / `mark_paid` / `reopen`. AWAITING/UNDER_REVIEW → CANCELLED or PAID (sets `paid_at`, linked invoice PAID); PAID/CANCELLED → AWAITING_PAYMENT (invoice back to PENDING if it was paid). 409 for any other transition. |
| `GET /api/track/:id` | public | **extended:** `images[]` (visible only, admin order: `url`, `caption`, `width`, `height`, `createdAt`) and `payment` (amount, currency, reason, due date, status, customer note, paid time, **only this shipment's accounts** with their customer view, latest proof status / time / rejection reason) or `null`. Never invoice id, payer, file names or admin notes. |
| `POST /api/track/:id/payment-proof` | public, own limiter (5/hour/IP) | submit proof (only while AWAITING_PAYMENT, for one of this shipment's accounts, max 3 open proofs) |
| `GET /api/payments/proofs?status=` | admin | the Payments page list (trashed shipments left out) |
| `GET /api/payments/proofs/:id/file` | admin | the private proof image (`private, no-store`, `nosniff`) |
| `POST /api/payments/proofs/:id/approve` · `/reject` | admin | review (reject needs a reason, 3–300 chars) |
| `GET /api/stats` | admin | **extended:** `submittedProofsCount` |

Errors from the proof route carry a `code` (`NOT_ACCEPTING`, `TOO_MANY_OPEN`, `RATE_LIMITED`) and the CONTENT.md §6.8
message.

---

## 7. Tasks

### Phase A — Admin console at `/private-user/` (D-11)
- [x] A.1 `src/config/brand.ts`: replace `ADMIN_SUBDOMAIN` / `ADMIN_HOST` with `ADMIN_PATH = '/private-user/'` (comment updated). Fix every importer (`src/App.tsx`, `server/seo.ts`); the build must catch any missed one.
- [x] A.2 `src/App.tsx`: `isAdminHost()` → `isAdminPath()` (exact segment match, §3). Initial page, hash handler, robots meta, `handleNavigate` and `onViewPublicTracking` use it; public links from the console go to `/#/<page>` on the same origin. `#/admin` on localhost unchanged; on the public domain it still shows home. Update the comments that describe the subdomain.
- [x] A.3 `server/index.ts`: `/private-user` → 301 `/private-user/`; `/private-user/` → `dist/index.html` with `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store, private`; deeper paths 404. Placed before `express.static`. Session, CORS, helmet and auth logic untouched.
- [x] A.4 `server/seo.ts`: admin detection by path; `robots.txt` / `sitemap.xml` are the public ones everywhere and never mention the admin path. Comments updated.
- [x] A.5 Verify (scratch `DB_PATH`, production build): `/private-user/` → login, wrong password refused, right password → "WVL Operations Console", reload stays logged in, logout; `/private-user` redirects; `/`, `/#/admin`, `/private-userx`, `/#/private-user` show the public site; `X-Robots-Tag` only on the admin path; robots/sitemap unchanged and without the path; public links from the console land on the public page; `npm run dev` → `http://localhost:3000/private-user/` and `#/admin` both open the console. 375 / 768 / 1440.
- [x] A.6 Docs: `CLAUDE.md` §2/§3 *(done with this spec)*, `docs/DEPLOYMENT.md` (§1 hosts table, §3.3 domains: no `private.` alias, smoke test and `/api/diag/storage` URLs → `/private-user/`), `docs/PROJECT_TRACKER.md` (7.3, #56, system notes, Decisions log superseding the 2026-09-26 subdomain entries), README admin URL.

### Phase B — Storage foundation
- [x] B.1 `UPLOADS_DIR` (default `data/uploads`, next to the default DB) with `images/` and `proofs/` created on start (`server/uploads.ts`). Documented in `.env.example` and `docs/DEPLOYMENT.md`: persistent folder outside the deploy dir, included in backups. Add it to the `/api/diag/storage` output.
- [x] B.2 Upload helper: decode base64 / data URL, magic-byte check (WebP/JPEG/PNG only), 2 MB cap, `<uuid>.<ext>` names, never client names or paths, safe delete. Test: `scripts/uploads.test.ts`.
- [x] B.3 `src/services/imageCompress.ts`: load the file (HEIC where the browser decodes it), resize ≤ 1600px, WebP (JPEG fallback on a white background), quality steps down to fit 2 MB, return base64 + width/height. EXIF dropped by the canvas redraw. Non-images rejected.
- [x] B.4 `shipment_images` table + public `GET /media/:id.<ext>` (`server/routes/media.ts`): visible images on non-trashed shipments only; hidden / trashed / unknown / proof / traversal requests all 404.

### Phase C — Package images
- [x] C.1 Admin image API (`server/routes/shipmentImages.ts`): list / upload (caption required ≤ 120 chars, max 20) / caption + visibility / reorder / delete / admin file route. Permanent shipment delete removes rows and files; trash/restore leaves them.
- [x] C.2 `/api/track/:id` returns `images[]` (§6). Types `PublicShipmentImage` / `AdminShipmentImage` in `src/types`.
- [x] C.3 `ShipmentImagesPanel` (admin) in `EditShipmentModal` and on the Create Shipment success screen (the ID exists only after creation): drag-and-drop / choose files, browser compression, required caption, visibility toggle, move earlier/later, delete; saves on each change; Enter never submits the shipment form.
- [ ] C.4 Copy for the section (heading, intro line, empty state, photo alt fallback) in CONTENT.md §6.6.
- [ ] C.5 `PackageGallery` on `TrackResultPage` (after the route map; hidden with no images). Phones (< 768px): 1-column grid, caption under each photo. From 768px: full width at a fixed low height (220px tablet / 260px desktop), columns follow the count (1 = full width, 2 = halves, 3+ = thirds), `object-fit: cover`. Explicit width/height, `loading="lazy"`, caption as `alt`.
- [ ] C.6 `PackageImageViewer`, lazy-loaded: full screen, Esc closes, ←/→ wrap, focus trapped and returned to the thumbnail, body scroll locked, `prefers-reduced-motion` respected.
- [ ] C.7 Existing `photos_json` photos read-only: after the captioned images on the track page (`Shipment photo {n}`) and in an "Earlier photos (read-only)" block in the admin panel. `src/shared/legacyPhotos.ts` keeps only http(s), site-relative or `data:image/` values (test).

### Phase D — Payment method types (shared)
- [ ] D.1 `src/shared/paymentMethods.ts` (17 types from §4: label, icon key, fields, either/or rules, link/QR/warning/note builders, `validatePaymentDetails`, `customerMethodView`) + `src/shared/paymentValidation.ts`. Customer-facing names, labels, warnings and notes in CONTENT.md §6.7 first. Tests: `scripts/paymentMethods.test.ts`.
- [ ] D.2 Icons in `src/assets/payment-icons/` (§4), generated module + `scripts/payment-icons.mjs`, `<PaymentIcon>` with lucide fallback. Test: `scripts/paymentIcons.test.ts`. Record the download date in §4.
- [ ] D.3 `PaymentMethodCard`: the customer view of one account (icon + name, fields with **Copy**, link button, warning, note, instructions, Show/Hide QR). Shared by the admin preview and the track page.

### Phase E — Payment request per shipment (admin)
- [ ] E.1 `shipment_payments` table + admin `GET/PUT/DELETE /api/shipments/:id/payment` (`server/routes/shipmentPayments.ts`). Shared `src/shared/paymentRequest.ts`: `validatePaymentRequest` (amount > 0 with no more decimals than the currency allows: 0 for JPY, 3 for KWD, 2 for the rest; currency in `PAYMENT_CURRENCIES`; reason 3–200, real due date, note ≤ 300, 1–10 accounts each checked by the registry, stable account ids), `publicPaymentView`, `formatPaymentAmount`. Invoice link must be an INVOICE of the same shipment. Tests: `scripts/paymentRequest.test.ts`. Confirm the public booking POST ignores payment data.
- [ ] E.0 `PAYMENT_CURRENCIES` in `src/shared/currency.ts` (D-7: code, name, minor digits; USD first and the default), kept separate from `DISPLAY_CURRENCIES` (the site-wide display setting, which converts from USD; payment amounts are never converted). Currency names in CONTENT.md §6.8. Test the decimals rule in `scripts/paymentRequest.test.ts`.
- [ ] E.2 `PaymentRequestEditor`: amount, currency (select from `PAYMENT_CURRENCIES`, USD preselected; the amount field's step follows the currency's decimals), required reason, optional due date, invoice link and customer note, and the accounts. **"Add payment methods" is a multi-select** of the 17 types as icon tiles (`aria-pressed`, check box, capped at the remaining slots, "Continue with N methods", hint: offer 3–5, minimum 1); each chosen method's form follows in turn ("Account 2 of 3": Add and continue / Skip / Cancel). Edit, remove and reorder accounts. A **live preview** shows exactly what the customer sees (with `PaymentMethodCard`).
- [ ] E.3 In **Create Shipment**: an optional "Payment request" step (clearly marked as shown to the customer), filled before the ID exists; an invalid draft blocks Create and returns to the step; summary in the review step; not saved in the browser draft (`wvl_admin_shipment_draft`). Saved with `PUT /api/shipments/:id/payment` right after the ID is assigned. If that save fails the shipment still exists; the success screen says so and offers **Try again**.
- [ ] E.4 In **Edit Shipment**: `ShipmentPaymentPanel` with add / edit / delete, saved on its own.
- [ ] E.5 Status: `POST /api/shipments/:id/payment/status` (§6) + Cancel request / Mark paid manually / Reopen buttons with confirmations. Extract the invoice PAID/PENDING logic from `server/routes/documents.ts` into `setDocumentPaymentStatus` and reuse it (route behaviour unchanged, re-tested).
- [ ] E.6 `/api/track/:id` returns `payment` (§6) via `publicPaymentView`, accounts in the courier's order. Two shipments never see each other's accounts; a deleted request gives `null`.

### Phase F — Payment section on the track page
- [ ] F.1 Copy in CONTENT.md §6.8: summary, status badges, "How to pay" tab (`Choose one of {n} payment options` / `1 payment option`), copy toast, QR, paid state, proof tab (`Already paid? Upload your receipt so we can confirm it.`), proof form, review / rejected states, errors, the "Payment confirmed" event. Flagged for owner review.
- [ ] F.2 `PaymentSection`, lazy-loaded and only fetched for shipments with a request, after the package images: amount (`Intl.NumberFormat` + currency), charge reason, due date (a calendar date, no time-zone shift), customer note, status badge (*Awaiting payment · Proof under review · Paid · Cancelled*).
- [ ] F.3 `PaymentTab`: full-width button in the brand colours (red icon chip and edge, chevron, `aria-expanded` / `aria-controls`), **closed by default**. "How to pay · Choose one of {n} payment options" holds the accounts: below 768px an accordion (one open at a time, first open); from 768px a grid (2 columns, 3 from 1200px). Every field has **Copy** with a "{Field} copied" toast (`role=status`, 2 s) keeping the field name's case. QR toggle for crypto and links (`qrcode`, its own chunk, fetched only when a QR is opened). Network warning for crypto.
- [ ] F.4 PAID: "Payment received" with the paid date; accounts behind the same tab ("Show payment accounts"). CANCELLED: the section isn't rendered or fetched.
- [ ] F.5 Worst-case data at 320 / 375 / 768 / 1440 (amount 1,000,000,000, 200-char reason, 300-char note with a long URL, long IBAN / bank address / email / card URL, Taproot BTC, ETH and BEP20 addresses, unbroken instructions), every account and QR opened: no overflow, no console errors.

### Phase G — Proof of payment
- [ ] G.1 `payment_proofs` table and `server/routes/paymentProofs.ts`; deleting a request or permanently deleting its shipment removes proofs and files.
- [ ] G.2 `POST /api/track/:id/payment-proof` (`server/routes/trackProof.ts`, mounted before the track lookup) with `paymentProofLimiter` in `server/middleware/rateLimit.ts`. Accepted only while AWAITING_PAYMENT (re-checked inside the transaction), for one of this shipment's accounts, max 3 open; image checked by content; account snapshotted; request → UNDER_REVIEW. Shared rules in `src/shared/paymentProof.ts` (test).
- [ ] G.3 `PaymentProofForm` behind a second `PaymentTab` ("Send proof of payment", closed by default), only while awaiting payment: account (preselected when there is one), payer name, amount sent (prefilled), optional reference, screenshot (compressed with B.3, preview, change/remove). Same validation as the server; errors tied to fields (`aria-describedby` / `aria-invalid`), focus to the first error; 409/429 show the server's message. Success replaces the form with the thank-you line.
- [ ] G.4 `payment.proof` in `/api/track/:id` = latest proof's status, time and (only when REJECTED) the reason. Track page: "Proof under review" with date and time, or "Proof not accepted: {reason}" above the form shown again.
- [ ] G.5 Admin **Payments** page (new `AdminViewType`, sidebar item in `AdminLayout` under Messages): filters Submitted (default) / Approved / Rejected / All with counts, search, refresh; each proof shows the thumbnail, tracking ID, statuses, amount due vs sent (flagged when they differ), account used (icon + name from the snapshot), payer, reference, reason, received time, `View screenshot` (`ProofViewer`: full size, Esc, focus trap) and `View shipment`. Shared `ProofFacts` component.
- [ ] G.6 Approve: request → PAID + `paid_at`, linked invoice PAID via `setDocumentPaymentStatus`, optional public "Payment confirmed" event at the WVL Operations Centre (`OPERATIONS_CENTRE`) that leaves the shipment status alone; checkbox ticked by default (D-8); confirm first. Reject: reason required; an UNDER_REVIEW request returns to AWAITING_PAYMENT once no other proof is waiting. Both in one transaction; 409 otherwise. `ProofReviewControls` on each card and in the viewer.

### Phase H — Dashboard notifications (no email)
- [ ] H.1 `/api/stats` returns `submittedProofsCount` (SUBMITTED proofs of non-trashed shipments). The console polls it every 30 s while `document.visibilityState === 'visible'`, again on focus/visibility change and after a review. Payments sidebar item shows `{n} NEW`; a bell in the admin header shows the count and opens a "New payment proof(s)" item linking to Payments (keyboard-reachable).
- [ ] H.2 `NewProofsPanel` on `OperationsCenter` (between the KPI cards and Recent Shipments): "New payment proofs" with a "{n} to review" pill, refresh, "All Payments →"; up to 6 cards (thumbnail from the admin file route, tracking ID, time, amount due vs sent, method icon + name, reference). Click opens `ProofViewer` with Approve / Reject inline; the card leaves the list and the badge refreshes. Empty state "Nothing to review".
- [ ] H.3 Toast in `AdminApp` when the poll finds an unseen proof: "New payment proof – WVL7K2M9" (several: "{n} new payment proofs"); click opens Payments filtered to it; ✕ dismisses; hides after 10 s. Seen ids in `localStorage` key **`wvl_seen_proofs`** (every read/write in try/catch, plus an in-memory copy, pruned to proofs still waiting). Add the key to the Cookie Policy storage list in the legal copy.

### Phase I — QA & release
- [ ] I.1 End-to-end: the §1 example flow on a scratch `DB_PATH` + `UPLOADS_DIR`, console at `/private-user/`, customer at 1440 and 375.
- [ ] I.2 Security: `/api/track` shows only that shipment's accounts and no internal fields; proof naming another shipment's account refused with no file written; proof file 401 without a session and unreachable through `/media` (id, file name, `proofs/`, encoded `../`); every admin route 401 without a session; text, SVG with script, PDF, HTML, GIF rejected by content; > 2 MB image 400, > 5 MB body 413; rate limit 429 on attempts 6–7 and not reset by a spoofed `X-Forwarded-For`; `/api/settings` has no payment data.
- [ ] I.3 Regression: tracking lookup, admin login at `/private-user/`, shipment create/edit/delete/restore, documents + PDF download, quotes, contact messages. `npm test` passes.
- [ ] I.4 `npm run build`: zero TS errors; record the gzip size of the public first load before and after (payment UI, viewer and QR lazy-loaded).
- [ ] I.5 Deploy (owner): push `main`; on Hostinger create the persistent uploads folder next to the database, set `UPLOADS_DIR`, redeploy; check `/api/diag/storage` logged in at `/private-user/`; re-test the §1 flow live (test shipment, then permanently delete it); add `UPLOADS_DIR` to the daily backup.
- [ ] I.6 Log the update in `PROJECT_TRACKER.md` (Change log, Blocked, Phase 7 env/backup items).

### Phase J — Admin fixes in the same code
- [ ] J.1 Edit pen on the dashboard: Recent Shipments rows in `OperationsCenter` get the same pencil as All Shipments, opening `EditShipmentModal` (details, photos, payment request). The literal "-" in the Control/Moving pill becomes an icon (both tables).
- [ ] J.2 Failed edit save: `updateShipmentFull` (`src/context/AdminDataContext.tsx`) returns `{ success, error }` and rolls the local change back on failure (today it swallows the error and a success toast shows). The modal shows "Saving…", and on failure stays open with a plain error and the typed values.
- [ ] J.3 Edit Shipment is worldwide: remove the U.S. defaults (`New York`, `100 Broadway`, `Los Angeles`, `500 Grand Ave`, `Aug 26, 2026`, `(555) 000-0000`); State becomes an optional "State / Region"; an empty region is not saved as `US`; an empty delivery date keeps the stored one. Re-resolve the location only when city/region was edited, and ignore inexact lookups (`isExactCoordinate: false`), so an unrelated edit never changes country, coordinates or facility.
- [ ] J.4 API errors (`src/services/api.ts`): every request goes through one `fetchApi`; GET/HEAD retried twice (0.7 s, 1.8 s) on a dropped connection or a non-JSON reply; writes sent once. A reply that still isn't JSON shows "We couldn't reach the server just now. Please try again in a moment." (reads) or a "couldn't confirm" message (writes), with status / content type / body start in the console. Photo and payment panels show **Try again**. Copy in CONTENT.md §10 first.

---

## 8. Blocked / Needs owner
- [ ] **Copy review:** CONTENT.md §6.6 (package images), §6.7 (method names, labels, warnings), §6.8 (payment section, tabs, proof form, messages), §10 (error messages) once added.
- [ ] **Hostinger:** if a `private.` subdomain was already created in hPanel, remove it, or point it at a redirect to `https://worldvexalogistics.com/private-user/`. It must not serve the app.
- [x] **`ADMIN_PROXY_TARGET` cleanup:** removed 2026-10-27 (owner said yes): `server/index.ts`, `server/db.ts`, `http-proxy-middleware`, docs.
- [ ] **Edit Shipment, city the offline lookup doesn't know** (e.g. Kyoto): after J.3 the name is saved but the map position stays (no live geocoding in this form). Accept, or add Nominatim geocoding to the form?
- [ ] **Deploy (I.5).**
- [ ] **Hiding a photo after it was public:** `/media` sends a 1-year `immutable` cache (§6), so a browser or Hostinger's CDN that already fetched the photo can keep showing it from cache after the admin hides or deletes it; the track page stops listing it at once. Accept, or use a shorter cache (e.g. 1 day)?

## 9. Decisions log
- **D-11 (2026-10-27) Admin console at `/private-user/`** (owner). Replaces the `private.` subdomain (PROJECT_TRACKER 2026-09-26 entries). Same app, origin and API; noindex + `no-store` on the path; the path is not listed in robots.txt.
- **D-1 Gift cards are not a payment method.** The US FTC and the UK's Action Fraud both name a business demanding gift cards as a scam sign, and issuers (Apple, Amazon, Google, Steam…) forbid using their cards to pay third parties. Showing them would risk the domain being flagged by browsers and payment providers and undercut customer trust. Card payments are covered by the **Card payment link** method, which also gives buyers protection. If asked mid-session, point here and ask the owner.
- **D-2** Payment accounts never go in public settings; they live on the shipment's payment request.
- **D-3** Uploaded files live in `UPLOADS_DIR` outside the deploy folder; images are compressed and EXIF-stripped in the browser.
- **D-4** Exactly one payment request per shipment; a charge reason is always required and shown to the customer.
- **D-5** New-proof notifications go to the admin dashboard (badge, bell, panel, toast), **not email**. No SMTP or `nodemailer`.
- **D-7 (2026-10-27, owner)** Payment requests can be in **USD, EUR, GBP, CHF, CAD, AUD, NZD, JPY, SGD, HKD, AED or KWD**; USD is the default. The amount is stored, shown and paid in the chosen currency (no conversion, no exchange rates); proof `amount_sent` is in the same currency. Shown with `Intl.NumberFormat` and the currency code, so the customer sees e.g. "CHF 120.00" or "KWD 36.500". Adding a currency later means one entry in `PAYMENT_CURRENCIES`, no schema change.
- **D-8** The "Payment confirmed" event checkbox on Approve is **ticked by default**.
- **D-9** No fixed payment-account list. Accounts are typed per shipment (Create Shipment before the ID exists, or Edit Shipment later), stored in `shipment_payments.methods_json`. The public booking endpoint never accepts payment data.
- **D-10** Track page: photos full width / low height on tablet and desktop; accounts and the proof form each behind a tab; several methods picked at once.

## 10. Change log
- 2026-10-27: Spec adapted to this codebase from the sibling project's update spec; admin moved to `/private-user/` (D-11); Phase J added for the three admin bugs found in the same code. No code changed yet.
- 2026-10-27: D-7 changed by the owner: 12 payment currencies (USD default) instead of USD only; E.0 added.
- 2026-10-27: Phase A done (A.1–A.6). `ADMIN_PATH` + `isAdminPathname()` in `brand.ts` (test `scripts/adminPath.test.ts`); App.tsx opens the console by path, public links go to `/#/…`; server serves `/private-user/` (301 from no slash, `no-store`, noindex, deeper paths/other methods 404, case-sensitive); robots/sitemap public everywhere. Verified on a scratch DB with the production build in headless Chrome (non-localhost host) and `npm run dev`; dashboard checked at 375/768/1440. Note: `/private-userx` and `/Private-User/` get the server's plain 404 (no SPA catch-all exists for any non-root path); they never get the console. `npm test`: the pre-existing `geocoding: gateway table…` test fails (expects 18 gateways, 22 since the 2026-10-04 gateway commits), unrelated to Phase A.
- 2026-10-27: `ADMIN_PROXY_TARGET` proxy mode removed (owner approved, §8): `server/index.ts` and `server/db.ts` lose the proxy branches (no behaviour change when the variable is unset, which it always was), `http-proxy-middleware` uninstalled, DEPLOYMENT/tracker updated.
- 2026-10-27: B.1 done. `server/uploads.ts` (`UPLOADS_DIR`, default `uploads/` next to the database file, so beside `DB_PATH` on the host); `images/` + `proofs/` created on start-up; `/api/diag/storage` reports `uploadsDir` / `uploadsDirExists`; `.env.example` and DEPLOYMENT.md §3.2, §4 step 5, §6 (uploads backup cron) updated.
- 2026-10-27: B.2 done. `server/uploads.ts`: `decodeImageUpload` (data URL or base64, declared type ignored, JPEG/PNG/WebP magic bytes, 2 MB cap), `saveUpload` (`<uuid>.<ext>`, `wx`), `uploadPath` / `deleteUpload` (only names it made, no traversal, missing file ignored). `scripts/uploads.test.ts` 8/8; full `npm test` 43/44 (same pre-existing geocoding gateway-count failure).
- 2026-10-27: B.3 done. `src/services/imageCompress.ts`: `compressImage(file)` → base64 WebP (JPEG on white where WebP can't be encoded), ≤ 1600px, quality 0.85→0.45 to fit 2 MB; errors carry a code (`NOT_IMAGE` / `DECODE_FAILED` / `TOO_LARGE`) for the UI to map to CONTENT.md copy. Checked in headless Chrome: 4000×2500 JPEG with an injected EXIF/GPS segment → 1600×1000 WebP, 247 KB, no EXIF; text/SVG/GIF refused, corrupt HEIC → DECODE_FAILED. The JPEG fallback branch is not exercised by Chrome (it encodes WebP); check it on an older Safari when the upload UI exists.
- 2026-10-27: B.4 done. `shipment_images` table (+ index on tracking number, sort order) in `server/db.ts`; `server/routes/media.ts` mounted before the admin shell and static files: `GET /media/<id>.<ext>` only for a visible image of a non-trashed shipment whose stored name matches exactly, 1-year immutable cache + `nosniff`; everything else 404 `no-store`. Checked on a scratch `DB_PATH` + `UPLOADS_DIR` (17 cases: visible webp/jpg/HEAD 200; hidden, trashed, unknown, missing file, wrong ext, proof name/id, `proofs/`, encoded and double-encoded `../`, uppercase id 404). `npm run build` clean; `npm test` 43/44 (pre-existing geocoding failure).
- 2026-10-27: C.1 done. `server/routes/shipmentImages.ts` at `/api/shipments/:trackingNumber/images` behind `requireAdminAuth`: list / upload (caption 1–120, max 20, checked by content; a failed row insert removes the file) / PATCH caption + visibility / PUT order (exact permutation) / DELETE / admin file route (`no-store`, `nosniff`, hidden images too). Permanent shipment delete calls `deleteShipmentImages`; trash/restore leave rows and files. 23 checks on a scratch `DB_PATH` + `UPLOADS_DIR` passed; `npm run build` clean.
- 2026-10-27: C.2 done. `/api/track/:id` returns `images[]` (visible only, admin order: `url` `/media/<file>`, `caption`, `width`, `height`, `createdAt`; no ids, file names or flags). Types `PublicShipmentImage` / `AdminShipmentImage` and `Shipment.images` in `src/types/shipment.ts`. Scratch checks: hidden image drops out of the response at once.
- 2026-10-27: C.3 done. `src/admin/components/ShipmentImagesPanel.tsx` (+ own `sdl-photos-*` CSS, since `.form-section-card` is also defined globally by ShipPage.css) in `EditShipmentModal` and on the Create Shipment success screen; api.ts gets the five image calls. Drop or choose files → `compressImage` → pending row needing a name → Save photo; rename on blur/Enter (empty name reverts), Visible/Hidden (`aria-pressed`), move earlier/later, delete with confirm; each change saved on its own; Enter inside the panel never submits the shipment form. Headless Chrome on a scratch DB (21 checks): 3200×2000 JPEG → 1600×1000, text file refused, Enter saves without closing the modal, rename/hide/reorder/delete reach the server, no overflow at 375/768/1440, no console errors. The success-screen placement was type-checked, not clicked through in the browser.
