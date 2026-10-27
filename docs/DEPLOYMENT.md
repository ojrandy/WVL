# Deployment: GitHub → Hostinger (World Vexa Logistics)

The app is **one Node.js process**. Express serves the API (`/api/*`) and the built React site (`dist/`), and keeps its
data in **one SQLite file**. The public site and the admin console are the **same app** answering on different
hostnames:

| Host | Serves |
|---|---|
| `https://worldvexalogistics.com` | Public site (canonical: `index.html`, `robots.txt` and `sitemap.xml` all use the apex) |
| `https://www.worldvexalogistics.com` | Same app; ideally a 301 redirect to the apex |
| `https://worldvexalogistics.com/private-user/` | Admin console (`ADMIN_PATH` in `src/config/brand.ts`), same app, same origin, same API, same database. There is no `private.` subdomain (update.md D-11) |

The new host starts with a **fresh, empty database**. Nothing is migrated from the old site.

Hostinger's hPanel screens change from time to time. If a label below doesn't match, look for the equivalent setting.

---

## 1. Hosting requirements

| Need | Why |
|---|---|
| A Hostinger plan that runs **Node.js web apps** (Business / Cloud web hosting, or a VPS) | Static hosting can't run the Express server, tracking API or admin |
| **Node.js ≥ 22.5** (22.x LTS or newer) | `server/db.ts` uses the built-in `node:sqlite`; `package.json` has `"engines": { "node": ">=22.5" }` |
| **Persistent storage** outside the deploy folder | The database must survive every redeploy |
| HTTPS on both hostnames (apex + `www`) | The admin session cookie is `secure` in production |
| Both hostnames on **one** app; admin is the `/private-user/` path | Public site and admin share one origin, API, session store and database |

## 2. GitHub: new repo with fresh history

Create an empty **private** repo on GitHub first (no README, no .gitignore, no licence), e.g. `world-vexa-logistics`.
With the GitHub CLI: `gh repo create <you>/world-vexa-logistics --private`.

Then, in the project folder (works in PowerShell and Git Bash; the one line that differs is marked):

```bash
# 0. Start clean and make sure the build passes
git status                      # must say "nothing to commit, working tree clean"
npm run build

# 1. Keep the old history as a LOCAL backup branch (never push it)
git branch archive/pre-launch main

# 2. New branch with no history, holding exactly the current files
git checkout --orphan fresh
git rm -r --cached --quiet screens CLAUDE.md PROMPTS.md   # files stay on disk, just not in the repo
Add-Content .gitignore "/screens/"                         # PowerShell
# echo "/screens/" >> .gitignore                           # Git Bash instead of the line above
git add .gitignore
git commit -m "World Vexa Logistics: initial import"
git branch -M main              # the fresh branch becomes main; the old history stays in archive/pre-launch

# 3. Point at the new repo and push main only
git remote remove origin
git remote add origin https://github.com/<you>/world-vexa-logistics.git
git push -u origin main

# 4. Check
git log --oneline               # exactly one commit
git ls-files | Select-String -Pattern "^\.env$|^data/|\.db$|^screens/"   # PowerShell: must print nothing
# git ls-files | grep -E "^\.env$|^data/|\.db$|^screens/"                # Git Bash equivalent
```

Why these files stay out: `screens/` is ~11 MB of old reference screenshots; `CLAUDE.md` and `PROMPTS.md` are already
listed in `.gitignore` (internal working notes). `.env`, `data/`, `node_modules/`, `dist/` and `dist-server/` are
ignored as before. `images/` (logo master and stock-photo originals with their `SOURCES.md`) stays in, since
`scripts/optimize-images.mjs` builds `Public/` from it.

> The current `origin` is `github.com/ojrandy/WVL`. If that is meant to be the new repo, only push to it if it is
> **empty**. If it already holds the old history, create a new repo instead (or delete and recreate it yourself).

From now on, work and push from this folder as usual: `git push` on `main` → Hostinger redeploys.

## 3. Hostinger hPanel checklist

### 3.1 Create the Node.js app
- [ ] hPanel → **Websites → Add website → Node.js app** (on some plans: *Advanced → Node.js*).
- [ ] Choose **Import Git repository**, authorise GitHub, pick `<you>/world-vexa-logistics`, branch **`main`**.
- [ ] Domain: **`worldvexalogistics.com`**.
- [ ] Settings:

| Setting | Value |
|---|---|
| Framework / preset | Express (or "Other") |
| Node version | **22.x** (or newer; never below 22.5) |
| Root directory | `/` (repo root) |
| Install command | `npm install` (its `postinstall` already runs `npm run build`) |
| Build command | `npm run build` only if the panel insists on one; otherwise leave empty so it doesn't build twice |
| Output directory | leave empty / not used (Express serves `dist/` itself) |
| Entry file / start command | `npm start` (= `node dist-server/server/index.js`) |
| Port | Don't hard-code. The server reads `process.env.PORT`, which Hostinger sets |

### 3.2 Environment variables (set in hPanel, never commit)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of the **new** admin password (see below) |
| `SESSION_SECRET` | 64 hex characters (see below) |
| `DB_PATH` | a `.db` file in a folder **outside** the app/deploy directory, e.g. `/home/<hostinger-user>/wvl-data/app.db` |
| `UPLOADS_DIR` | a folder **outside** the app/deploy directory for uploaded photos and payment proofs, e.g. `/home/<hostinger-user>/wvl-data/uploads` (unset = `uploads` next to the `DB_PATH` file) |
| `SEED_DEMO_DATA` | **unset** (it does nothing any more; demo data was removed) |
| `PORT` | unset, unless the panel asks for it |

Generate the two secrets locally, in the project folder (PowerShell; the password is typed at a hidden prompt so it
never lands in a file or your shell history):

```powershell
$s = Read-Host "New admin password" -AsSecureString
$env:NEW_ADMIN_PW = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
node -e "console.log(require('bcryptjs').hashSync(process.env.NEW_ADMIN_PW, 12))"
Remove-Item Env:NEW_ADMIN_PW; Remove-Variable s

node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the hash (starts with `$2b$12$`) **unquoted**. Use a fresh pair for production; never reuse your local `.env`
values. Changing the admin password later = new hash in hPanel + restart; no code change.

About `DB_PATH`: the server creates the folder and the file on first start. Find your home path in hPanel (File
Manager shows `/home/u123456789/…`). Pick a folder that is **not** under the app's own directory (e.g. not inside
`domains/worldvexalogistics.com/…`), because a git redeploy may replace that directory. If your plan offers a path
described as persistent storage, use that. §4 step 5 proves whether it survives.

About `UPLOADS_DIR`: the same rule. The server creates it with `images/` (package photos, public when marked
visible) and `proofs/` (payment screenshots, admin-only) on start-up. Keep it beside the database, outside the app
folder, and back it up with the database (§6).

- [ ] Save the variables, then **restart / redeploy** the app so it picks them up.
- [ ] Check the app log: it should print the World Vexa start-up banner and **no**
  `SESSION_SECRET is not set` error.

### 3.3 Domains: apex + www on the SAME app
- [ ] `worldvexalogistics.com` attached to the Node app (done in 3.1).
- [ ] `www.worldvexalogistics.com`: attached to the same app, ideally as a **301 redirect to the apex** (the canonical
  URL, OG tags and sitemap all use the apex). If the panel can only serve both, that also works; the canonical tag
  covers it.
- [ ] **No admin subdomain.** The console is a path on the apex, `https://worldvexalogistics.com/private-user/`, so it
  needs no extra domain, DNS record or certificate. If a `private.` subdomain was already created in hPanel, remove
  it, or make it a redirect to `https://worldvexalogistics.com/private-user/`. It must not serve the app.
- [ ] DNS (if the domain uses Hostinger nameservers this is automatic; otherwise at your registrar): apex `A` record and
  `www` record pointing to what hPanel shows for the app. Wait for DNS (minutes to a few hours).

### 3.4 SSL and HTTPS
- [ ] hPanel → **Security → SSL**: install the free SSL certificate for **both**: `worldvexalogistics.com` and
  `www.worldvexalogistics.com`.
- [ ] Turn on **Force HTTPS** for the domain.
- [ ] Check: `http://worldvexalogistics.com` and `http://worldvexalogistics.com/private-user/` both redirect to `https://`.

Login only works over HTTPS in production (secure cookie; the server already trusts Hostinger's proxy for this).

### 3.5 Email: info@worldvexalogistics.com
- [ ] hPanel → **Emails**: set up Hostinger Email for `worldvexalogistics.com` (or Google Workspace) and create the
  mailbox **`info@worldvexalogistics.com`**.
- [ ] DNS records (hPanel adds them automatically on Hostinger nameservers; check under **Emails → DNS / Connect
  domain**):
  - **MX**: the provider's MX records (Hostinger: `mx1.hostinger.com`, `mx2.hostinger.com`).
  - **SPF** (TXT on `@`): `v=spf1 include:_spf.mail.hostinger.com ~all` (Google Workspace: `include:_spf.google.com`).
    Only **one** SPF record per domain.
  - **DKIM**: the TXT/CNAME record the provider shows.
  - **DMARC** (TXT on `_dmarc`): `v=DMARC1; p=quarantine; rua=mailto:info@worldvexalogistics.com`
- [ ] Send a test mail from info@ to a Gmail address → open it → **Show original**: SPF, DKIM and DMARC all `PASS`.
- [ ] Reply from Gmail to info@ and confirm it arrives.

## 4. Post-deploy smoke test

Run in this order on the live domains. Use a private/incognito window for the browser checks.

**1. Site loads on the apex and www**
- [ ] `https://worldvexalogistics.com` loads Home, padlock shown, title "World Vexa Logistics", new logo, no console errors.
- [ ] `https://www.worldvexalogistics.com` redirects to the apex (or loads the same site).
- [ ] `https://worldvexalogistics.com/api/health` → `{"status":"ok","service":"World Vexa Logistics API",…}`.

**2. Admin opens ONLY at `/private-user/`**
- [ ] `https://worldvexalogistics.com/#/admin` → shows **Home**, not the admin login.
- [ ] `https://www.worldvexalogistics.com/#/admin` → also Home.
- [ ] `https://worldvexalogistics.com/private-user/` → admin login, "WVL Operations Console".
- [ ] `https://worldvexalogistics.com/private-user` (no trailing slash) → redirects to `/private-user/`.
- [ ] The admin path is hidden from search engines and never cached: in PowerShell
  `curl.exe -sI https://worldvexalogistics.com/private-user/` → `X-Robots-Tag: noindex, nofollow` and
  `Cache-Control: no-store, private`. The same command on `https://worldvexalogistics.com/` shows **no** `X-Robots-Tag`.

**3. Login with the new password**
- [ ] A wrong password is rejected.
- [ ] The new password logs in, and reloading the page keeps you logged in (proves the secure cookie works behind HTTPS).

**4. Create a shipment and track it**
- [ ] Admin → create a shipment → it gets an ID of exactly 8 characters: `WVL` + 5 (e.g. `WVL7K2M9`). Write it down.
- [ ] On `https://worldvexalogistics.com` → Track → enter the ID → the shipment shows (also in lower case).
- [ ] `WVL7K2M9` (the example ID from the help text) says **not found**: there is no demo data.
- [ ] Download one document (e.g. the label or invoice): new logo, "World Vexa Logistics", info@worldvexalogistics.com.

**5. The database survives a redeploy (`/api/diag/storage`)**

This endpoint is temporary and admin-only, so open it in the browser where you're logged in at `/private-user/`:
- [ ] Open `https://worldvexalogistics.com/api/diag/storage`. Note `markerFirstSeen`. Check that `dataDir` is
  the folder from your `DB_PATH` and `databaseFileExists` is `true`. Check that `uploadsDir` is the folder from your
  `UPLOADS_DIR` (or `uploads` next to the database) and `uploadsDirExists` is `true`.
- [ ] Redeploy: push a commit (`git commit --allow-empty -m "chore: redeploy test"` + `git push`) or use the panel's
  **Redeploy** button. Wait until it's live again.
- [ ] Log in again (sessions are in memory, so **every redeploy logs everyone out**; that is expected).
- [ ] Open `/api/diag/storage` again: **`markerFirstSeen` is unchanged** and `databaseFileSizeBytes` is not smaller.
- [ ] The shipment from step 4 still tracks on the public site.

If `markerFirstSeen` changed or the shipment is gone, the storage is **not** persistent: choose another `DB_PATH`
(outside the app folder) and repeat. Don't launch until this passes. Once it passes, tell me and I'll remove
`/api/diag/storage` in a separate commit.

**6. robots.txt and sitemap.xml**
- [ ] `https://worldvexalogistics.com/robots.txt` is exactly:
  ```
  User-agent: *
  Disallow: /api/

  Sitemap: https://worldvexalogistics.com/sitemap.xml
  ```
- [ ] `https://worldvexalogistics.com/sitemap.xml` lists one URL: `<loc>https://worldvexalogistics.com/</loc>`.
- [ ] Neither file mentions `/private-user/`, `private.` or any old domain. (Listing the admin path in robots.txt
  would publish it; the noindex header keeps it out of search instead.)

## 5. Launch checklist (after the smoke test passes)

- [ ] Quote request → appears in admin → the quote link opens publicly.
- [ ] Contact and callback forms submit; the contact form shows a `WVL-TKT-` reference.
- [ ] **OG image is live:** `https://worldvexalogistics.com/brand/og-image.jpg` returns 200 (`image/jpeg`). `index.html`
  points `og:image`, `twitter:image`, `og:url` and `canonical` at the apex, so if you ever serve the site on `www.`
  instead, update all four first. Then run the home URL through the Facebook Sharing Debugger and LinkedIn Post
  Inspector ("Scrape again").
- [ ] View source + `robots.txt` + `sitemap.xml` + link preview (paste the link in WhatsApp): World Vexa only.
- [ ] Final old-brand sweep on the live HTML/JS bundle (REBRAND_MAP §7).
- [ ] Lighthouse mobile on Home meets the MOTION_3D_SPEC §2 targets.
- [ ] Phone, WhatsApp, address and social links stay hidden until the owner supplies them.

## 6. After launch

- **Backups:** the database runs in WAL mode, so copy it with SQLite's own snapshot rather than copying `app.db` alone.
  A daily Hostinger cron job (hPanel → Advanced → Cron Jobs), with your real paths:
  ```bash
  node -e "const{DatabaseSync}=require('node:sqlite');new DatabaseSync(process.argv[1]).exec(\"VACUUM INTO '\"+process.argv[2]+\"'\")" /home/<user>/wvl-data/app.db /home/<user>/wvl-backups/app-$(date +\%F).db
  ```
  Download a copy off the server regularly and test a restore once (stop the app, put the copy at `DB_PATH`, start).
- **Uploads backup:** the uploaded photos and proofs are plain files, so a second daily cron job can copy the folder:
  ```bash
  tar -czf /home/<user>/wvl-backups/uploads-$(date +%F).tar.gz -C /home/<user>/wvl-data uploads
  ```
  Restore = stop the app, unpack it back to `UPLOADS_DIR`, start. Restore it together with the database copy from the
  same day, so rows and files match.
- **Updates:** push to `main` → Hostinger redeploys (and logs admins out). Use a `staging` branch/subdomain for bigger
  changes.
- **Monitoring:** a free uptime monitor on `https://worldvexalogistics.com/api/health` (5-minute interval) with alerts
  to info@worldvexalogistics.com.
- **Security:** rotate `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` if anyone with access leaves; `npm audit` monthly.
