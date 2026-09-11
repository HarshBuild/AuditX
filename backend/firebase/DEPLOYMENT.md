# AuditX — Supabase → Firebase migration & deployment notes

Project: `scanner-56fcf`  ·  Region: `asia-south1` (cloud functions + Firestore)

## 1. Environment (dashboard)
The web app resolves Firebase config in this order:
1. `VITE_FIREBASE_*` env vars
2. localStorage `mc_firebase_*` (advanced)
3. Built-in defaults (the published web-app config)

```env
# B:\CODEBYHARSH\MeaSura\AuditX\dashboard\.env
VITE_FIREBASE_API_KEY=AIzaSyD63lNnW4AQyoVQkbStssbx67V2-kdNd5Y
VITE_FIREBASE_AUTH_DOMAIN=scanner-56fcf.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=scanner-56fcf
VITE_FIREBASE_STORAGE_BUCKET=scanner-56fcf.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=999791645311
VITE_FIREBASE_APP_ID=1:999791645311:web:ec2766e5587ed817b1654a
VITE_FIREBASE_MEASUREMENT_ID=G-GW55L9SCP6
VITE_FIREBASE_FUNCTIONS_REGION=asia-south1
```

The default functions region in `src/lib/config.ts` is `asia-south1`. If you
deploy to a different region, override it or edit the default (the dashboard
client will not reach a region-mismatched function).

## 2. Firebase console setup (one-time, manual)
- **Authentication → Sign-in method**: enable *Email/Password*. (Optionally Google.)
- **Firestore Database**: create in `asia-south1`, production mode.
- **Storage**: create in `asia-south1` (bucket `scanner-56fcf.firebasestorage.app`).
- **Functions**: enable the Blaze plan (needed for outbound Groq AI calls).
- **Storage release**: `firestore.rules` are deployed, but the Storage *bucket
  release* must exist for image uploads to succeed. Run
  `firebase deploy --only storage` once (or create the release in the console).
  Until then the scanner still works — photos are just not persisted.

## 3. Deploy rules
```powershell
firebase login
firebase use scanner-56fcf
firebase deploy --only firestore:rules,storage
```

## 4. Seed the first super admin
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="B:\...\scanner-56fcf-firebase-adminsdk.json"
cd functions
node scripts/bootstrap-super-admin.mjs
```

## 5. Deploy Cloud Functions (Groq scan analysis + claims)
```powershell
cd functions
npm install
firebase functions:secrets:set GROQ_API_KEY   # paste your Groq key, region asia-south1
npm run build
firebase deploy --only functions
```

## 6. Existing super admin → first run (recommended)
The old app had a hard-coded demo super admin. On Firebase, credentials are
managed by Firebase Auth. Create the super-admin's Firebase Auth account with
the SAME email/password the user will sign in with, then bootstrap as above, or
have the super admin sign up and approve themselves through the script. In
production the signup flow keeps `users/{uid}` in sync automatically.

## 7. Data migration from Supabase (if needed)
- Export tables from Supabase (`profiles`, `scans`, `violations`, `reports`,
  `notifications`, `activity_logs`, `compliance_rules`, `admin_requests`,
  `inspection_reviews`).
- Convert `id` → doc-id (use same uuid), timestamps → ISO strings, snake_case
  column names are already the Firestore field names (the data layer reads the
  same keys), join `profiles` with Auth users by **email** (auth uid ≠ old uuid).
- Import with a one-off Admin SDK script or Firestore console import.

## 8. Roles & claims model
- Role/status live in `users/{uid}` and in the Auth custom claims mirror.
- Claims are minted by: the bootstrap script, the `setClaims` callable, and the
  `syncClaimsOnUserStatus` trigger. Never by the browser.
- Firestore rules (`firestore.rules`) and Storage rules (`storage.rules`) are the
  only authorization boundary; the UI role checks are fail-fast UX only.
- Blocked/pending users: claims status check inside rules denies every write.

### One-time live-mint (no deploy required)
Staff collection LIST queries are gated by custom claims. If Cloud Functions are
not deployed yet, mint claims directly with the Admin SDK (service account):

```powershell
cd backend/firebase/functions
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\...\scanner-56fcf-firebase-adminsdk.json"
node scripts/mint-claims.cjs      # mints role/status claims for EVERY auth user
node scripts/seed-data.cjs        # (optional) fills scans/violations/reports/
                                  # products/complianceRules/activityLogs with live demo data
```

Re-run `mint-claims.cjs` after an admin status/role change until the
`syncClaimsOnUserStatus` Cloud Function is deployed. Users must sign the token
again (or reload the dashboard) for fresh claims to be picked up.

## 9. Realtime listeners (Supabase realtime → Firestore)
- Notifications: `useNotifications` (`onSnapshot`). Scans lists are paginated
  bounded fetches; a dashboard "Refetch" keeps lists fresh.
- A `scanAnalysis` callable runs the same prompt the old Supabase edge function
  used; point the app at it with `scanId` to backfill a `pending_review` scan.

## 10. Supabase removal — done
- Done: `@supabase/supabase-js` removed from `package.json`; `supabase.ts`,
  `useSupabaseQuery.ts` deleted; all Supabase imports replaced by `lib/firebase*`.
- Supabase-era artifacts (`backend/supabase-setup.sql`,
  `backend/functions/scan/index.ts`, `legacy/`) have been removed.