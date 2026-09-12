# AuditX v3.0

**Legal Metrology label-compliance scanner for India.**

AuditX photographs a packaged-commodity label, runs AI **OCR / extraction only**, then evaluates it with a **deterministic Legal Metrology (Packaged Commodities) Rules, 2011 — Rule 6 engine** that decides each rule's applicability, computes a compliance verdict, score and risk, and records a full evidence chain `Image → OCR → field → rule → status`.

Built for **Smart India Hackathon 2026 — PS26034**.

---

## Features

- **Single-file app** — the React dashboard bundles to one self-contained `dashboard.html` (open it directly, no server needed).
- **Admin dashboard** (`dashboard/`) — React SPA: per-role homes, scan product, records, reports, violations, evidence, analytics, product database, users, compliance rules, audit logs, notifications and settings. Bundled to a single `dashboard.html` via `vite-plugin-singlefile`.
- **AI pipeline**: the browser runs label extraction (Gemini Vision via `vite` build/`localStorage` key, falling back to on-device Tesseract OCR) and the results feed the deterministic compliance engine. The Express API (`backend/firebase/functions`) exposes the same analysis server-side with `GEMINI_API_KEY` held in the environment only.
- **Deterministic compliance engine** (`compliance/engine.ts`) — 10/10 probe tests passing: package context (retail / wholesale / imported / food / sold-by / special commodity), rule applicability, Indian food-label full check, `PASS/WARNING/FAIL/NOT_APPLICABLE/NOT_VERIFIABLE` outcomes, `REQUIRES_PHYSICAL_INSPECTION` flags, evidence chains.
- **RBAC** — `user` (Consumer) · `inspector` (Inspector) · `admin` (Admin) · `super_admin` (Super Admin). Role/status live in `users/{uid}` **and** in Firebase custom claims minted server-side only. Firestore + Storage security rules are the real authorization boundary.
- **Multilingual** inspection assistant (11 Indian languages) + multilingual OCR labelling.
- **Bar-code product database** (managers) + Open Food Facts lookup (`lookupBarcode` callable).
- **AI assistant** (`complianceAssistant`) — Groq Q&A over a stored scan for field inspectors.
- **Audit trail** (`activityLogs`), notifications inbox, staff access requests & super-admin approval flow, PDF/CSV reporting.

---

## Tech stack

| Layer      | Tech |
|------------|------|
| Dashboard  | React 18, TypeScript, Vite 6, Tailwind 3, react-router 7, Recharts, lucide-react, jspdf + html2canvas, `vite-plugin-singlefile` |
| Backend    | Firebase Auth, Firestore, Storage, Cloud Functions (Node 20) |
| AI         | Gemini (`gemini-3.6-flash`) via browser or the Express API; on-device Tesseract OCR fallback |
| Infra      | Firestore/Storage rules + Cloud Functions — Firebase project `scanner-56fcf`, region `asia-south1` |

---

## Project layout

```
MeaSura/metrocheck/
├─ package.json                 # Root convenience scripts
├─ dashboard/                   # React SPA (main web app)
│  ├─ src/lib/                  # firebase, auth, db, rbac, services, scan, risk, pdf, barcode
│  ├─ src/components/           # layout, pages, ui, auth, inspection, table
│  └─ scripts/copy-dashboard.mjs# copies dist/index.html → ../../dashboard.html
├─ backend/
│  └─ firebase/                 # Deploy root for Firebase
│     ├─ firebase.json          # firestore + storage + functions + hosting config
│     ├─ .firebaserc            # default project scanner-56fcf
│     ├─ firestore.rules        # ⚠ security boundary (never the UI checks)
│     ├─ storage.rules
│     ├─ DEPLOYMENT.md          # migration + deployment notes
│     └─ functions/             # TypeScript Cloud Functions
│        ├─ index.ts            # scanAnalysis, complianceAssistant, setClaims,
│        │                      #   lookupBarcode, syncClaimsOnUserStatus
│        ├─ scripts/            # bootstrap-super-admin.mjs, mint-claims.cjs,
│        │                      #   seed-data.cjs (Admin SDK utilities)
│        ├─ compliance/         # extraction, context, rules, engine, validators, result
│        └─ tests/engine-probe.cjs
```

---

## Getting started

Requirements: **Node ≥ 20**, npm ≥ 10. A Firebase project (already configured for `scanner-56fcf`).

```powershell
# 1. Install + run the dashboard (HMR on http://localhost:5173)
cd MeaSura/metrocheck
npm run dev

# 2. One-off: copy dashboard/.env.example → dashboard/.env and fill Firebase values
#    (the app already has working built-in defaults, so `.env` is optional)
```

### Build & test everything from the root

```powershell
cd MeaSura/metrocheck
npm run build           # dashboard TS check + production build
npm run build:site      # build + publish single-file ../../dashboard.html (standalone entry)
npm run build:functions # compile Cloud Functions (tsc)
npm run test            # compliance engine probe suite  (10/10)
```

---

## Deploy (Firebase)

All rules/function config lives in `backend/firebase/`.

```powershell
cd MeaSura/metrocheck
firebase --cwd backend/firebase deploy --only firestore:rules,storage   # rules
firebase --cwd backend/firebase deploy --only functions                 # functions
```

Or deploy everything with `npm run deploy` (equivalent script chain).

> `dashboard.html` is a standalone file — host it as a static file anywhere if you want it online.

## Deploy (Render) — recommended

`render.yaml` at the repo root deploys two services from one connected repo:

| Service      | Type | Root | Notes |
|--------------|------|------|-------|
| `auditx-api` | Web Service (free) | `backend/firebase/functions` | `npm install && npm run build` → `npm start` on `0.0.0.0:${PORT}`; health check at `/health` |
| `auditx-web` | Static Site (free) | `dashboard` | `npm install && npm run build` → publishes `dist/`; HashRouter so no SPA rewrite rules needed |

### Connect & deploy

1. Push `MeaSura/metrocheck` to **`https://github.com/HarshBuild/AuditX`** (done).
2. In Render: **New → Blueprint**, select the `AuditX` repo. Render reads `render.yaml`.
3. During setup Render prompts for every `sync: false` variable — paste real values (see tables below).
4. Deploy. Then copy the dashboard URL (e.g. `https://auditx.onrender.com`) into the API's `FRONTEND_URL` and redeploy the API (one time).

### Env vars — Web Site (`auditx-web`)

Set from the dashboard `dashboard/.env` values (Firebase console → Project Settings):

| Var | Example (project `scanner-56fcf`) |
|-----|-----------------------------------|
| `VITE_FIREBASE_API_KEY` | `AIzaSy…` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `scanner-56fcf.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `scanner-56fcf` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `scanner-56fcf.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | numeric |
| `VITE_FIREBASE_APP_ID` | `1:…:web:…` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `G-…` |
| `VITE_FIREBASE_FUNCTIONS_REGION` | `asia-south1` |

> The dashboard also works without env vars (built-in defaults) — env vars are only needed to point at a *different* Firebase project.

### Env vars — API (`auditx-api`)

| Var | Source |
|-----|--------|
| `PROJECT_ID` | Service-account JSON → `project_id` |
| `CLIENT_EMAIL` | Service-account JSON → `client_email` |
| `PRIVATE_KEY` | Service-account JSON → `private_key`. Paste the PEM **with literal `\n`** sequences (Render prompt accepts multiline paste too) |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `GEMINI_VISION_MODEL` | `gemini-3.6-flash` (default) |
| `GEMINI_TEXT_MODEL` | `gemini-3.6-flash` (default) |
| `FRONTEND_URL` | `https://<your-app>.onrender.com` (CORS origin, no trailing slash) |

Health check: `GET https://auditx-api.onrender.com/health` → `{"ok":true,"service":"AuditX backend"}`.

### How the deployed app talks to services

- **Auth / data**: the dashboard talks directly to Firebase (Auth + Firestore + Storage) from the browser — no proxy needed.
- **AI analysis**: runs in the browser (Gemini Vision key from build env or `localStorage.mc_gemini_api_key`, else on-device Tesseract OCR) and writes the scan result to Firestore.
- **Express API** (`/api/scan`, `/api/assistant`, `/api/barcode`, `/api/set-claims`): authenticated with a Firebase ID token (`Authorization: Bearer …`). It is fully deployable and env-driven, but the current dashboard does **not** call it — it is the server-side/Gemini-keyed alternative for API clients and future integration.

### Optional — Python OCR sidecar (`backend/ocr`, local-only)

The OCR microservice (FastAPI + PaddleOCR, pinned to `paddlepaddle 2.6.2` / `paddleocr 2.7.0.3` for CPU stability) runs locally on `0.0.0.0:${PORT}` (default `8100`). It is **not** part of `render.yaml` and the dashboard does not depend on it. To deploy it as a Render Web Service manually: runtime **Python 3.11**, root `backend/ocr`, build `pip install -r requirements.txt`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`.

### One-time project setup (console)

1. **Authentication → Sign-in method**: enable *Email/Password*.
2. **Firestore**: create database in `asia-south1`, production mode.
3. **Storage**: create bucket in `asia-south1`.
4. **Functions**: enable Blaze plan (outbound Groq AI calls).
5. **Grok secret**:

   ```powershell
   cd backend/firebase/functions
   npm i
   firebase functions:secrets:set GROQ_API_KEY     # region asia-south1
   npm run build
   firebase deploy --only functions
   ```

### Seed the first super admin

```powershell
cd MeaSura/metrocheck
$env:GOOGLE_APPLICATION_CREDENTIALS="B:\path\scanner-56fcf-firebase-adminsdk.json"
node backend/firebase/functions/scripts/bootstrap-super-admin.mjs
```

Or, in development: sign up as a Consumer, then promote the account through
`bootstrap-super-admin.mjs`, or the super admin flow (staff sign-ups queue an
`adminRequests` doc the super admin approves; `syncClaimsOnUserStatus` mints the claims).

---

## How a scan works

1. **Capture** — dashboard compresses the image(s) and creates a Firestore `scans/{id}` doc (`status: pending_review`).
2. **`scanAnalysis`** (callable, auth + role/status checked) —
   a. Groq vision transcribes the label: structured fields, raw OCR text, OCR blocks, detected barcode, languages, commodity type.
   b. `compliance/context.ts` resolves package context (retail/wholesale/imported/food/sold-by/special commodity + exemptions).
   c. `compliance/engine.ts` runs every applicable Rule 6 check deterministically on the *extracted fields* (never on the model's opinion), producing `rules[]`, verdict, score, risk, counts, `ai_insights`, and an `evidence_chain`.
   d. The result is written back to the scan; a notification is queued.
3. **Human follow-up** — inspectors can mark `REQUIRES_PHYSICAL_INSPECTION` items, attach manual results, log violations, and generate reports. Consumers get history, reports and the assistant Q&A.

---

## Roles & permissions (source of truth = Firestore rules)

| Role        | Access highlights |
|-------------|-------------------|
| `user` (Consumer)     | Own scans, history, reports, notifications, product lookups, `scanAnalysis`, assistant on own scans |
| `inspector`           | All scans + staff read, create/verify violations, evidence, inspection reviews |
| `admin`               | Everything above + manage users, products, compliance rules, analytics, reports |
| `super_admin`         | Everything + approval of admin requests, admin management, audit logs, system settings |

- Custom claims (`role`, `status`) are minted **only** by the Admin SDK (`bootstrap-super-admin.mjs`, `setClaims`, `syncClaimsOnUserStatus`). Blocked/pending accounts are denied by rules.
- `users/` writes guard role changes (`roleFlipAllowed`), and staff cannot mutate `super_admin` profiles.

---

## Data model (Firestore)

Migrated from Supabase (`_archive/supabase-setup.sql`) — field names keep `snake_case`.

| Collection        | Purpose |
|-------------------|---------|
| `users/{uid}`     | Profile: `full_name, email, role, status, organization, prefs, last_login` |
| `scans/{id}`      | Inspection: product, brand, manufacturer, barcode, `overall_score`, `verdict`, `summary`, `rules[]`, `ocr{text,languages}`, `extractions`, `counts`, `context`, `evidence_chain`, `risk_score`, `status` |
| `violations`      | Compliance violations created by staff |
| `reports`         | Generated reports (PDF/CSV) |
| `notifications`   | Per-user inbox |
| `adminRequests`   | Pending staff-access approval (super admin) |
| `complianceRules` | Rule catalog maintained by managers |
| `products`        | Barcode → product database |
| `activityLogs`    | Immutable audit trail (staff) |
| `inspectionReviews` | Manual review decisions (staff) |

---

## Compliance engine

- Deterministic + evidence-based — every `RuleCheck` carries `verification_type` and an `evidence_chain_entry`.
- **Anti-hallucination guarantee**: a rule can never `PASS` without a *detected* value; `MISSING → FAIL`, `UNCERTAIN → NOT_VERIFIABLE`, `NOT_APPLICABLE` for correctly-inapplicable rules (e.g. `wholesale`, `imported`, `sold-by`, non-perishables).
- Run the probe suite:

  ```powershell
  npm run test
  # RESULT: 10/10 passed
  ```

---

## Security notes

- Firebase web config is **public by design** (API keys are not secrets). Authorization lives in `backend/firebase/firestore.rules` + `storage.rules`.
- AI keys (`GROQ_API_KEY`) exist only as Firebase secret environment variables — never in the client bundle.
- `_archive/` is retained purely as a migration reference and is **not** deployed.