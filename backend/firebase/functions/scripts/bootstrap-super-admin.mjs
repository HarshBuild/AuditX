/**
 * AuditX — Super Admin bootstrap.
 *
 * Creates (or resets the password of) the super admin account, mints the
 * Firebase custom claims (role=super_admin, status=active) and writes the
 * users/{uid} profile document. Run from the functions folder so the local
 * firebase-admin install is used:
 *
 *   npm run bootstrap:superadmin
 *
 * Password source of truth (never commit a password to the repo):
 *   SUPER_ADMIN_EMAIL     — account email   (default superadmin@AuditX.in)
 *   SUPER_ADMIN_PASSWORD  — explicit password (optional; random if omitted)
 *
 * When no password is provided, a random one is generated and printed to the
 * console — that printed value is the ONLY copy, so save it.
 */

import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const SERVICE_ACCOUNT =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  'C:\\Users\\Dell\\AppData\\Local\\Temp\\opencode\\scanner-56fcf-firebase-adminsdk.json'

let credential
try {
  credential = cert(JSON.parse(readFileSync(SERVICE_ACCOUNT, 'utf8')))
} catch {
  console.error(`[FAIL] Could not read service-account file at:\n  ${SERVICE_ACCOUNT}`)
  process.exit(1)
}
initializeApp({ credential })

const EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'superadmin@AuditX.in').trim()
const PASSWORD = (process.env.SUPER_ADMIN_PASSWORD || randomBytes(9).toString('base64url').slice(0, 14)).trim()

function uid() {
  return createHash('sha256').update(EMAIL).digest('hex').slice(0, 8)
}

async function main() {
  const auth = getAuth()
  const db = getFirestore()

  if (PASSWORD.length < 8) {
    console.error('[FAIL] SUPER_ADMIN_PASSWORD must be at least 8 characters.')
    process.exit(1)
  }

  let user
  try {
    user = await auth.getUserByEmail(EMAIL)
    console.log(`[OK] Existing account found for ${EMAIL} — resetting its password.`)
    await auth.updateUser(user.uid, { password: PASSWORD, disabled: false, emailVerified: true })
  } catch {
    user = await auth.createUser({
      email: EMAIL,
      password: PASSWORD,
      displayName: 'AuditX Super Admin',
      emailVerified: true,
    })
    console.log(`[OK] Created new account for ${EMAIL}.`)
  }
  const { uid: targetUid } = user

  await auth.setCustomUserClaims(targetUid, { role: 'super_admin', status: 'active' })
  console.log('[OK] Custom claims minted: role=super_admin, status=active')

  const now = new Date().toISOString()
  await db.doc(`users/${targetUid}`).set(
    {
      uid: targetUid,
      email: EMAIL,
      full_name: 'AuditX Super Admin',
      display_name: 'AuditX Super Admin',
      organization: 'AuditX',
      role: 'super_admin',
      status: 'active',
      created_at: now,
      updated_at: now,
      last_login: null,
    },
    { merge: true },
  )
  console.log(`[OK] Profile written to users/${targetUid}`)

  const status = await auth.getUser(targetUid)
  console.log('[VERIFY] Claims:', JSON.stringify(status.customClaims))

  console.log('\n===============================================')
  console.log('  SUPER ADMIN LOGIN (save these credentials)')
  console.log('===============================================')
  console.log('  Sign-in email : ' + EMAIL)
  console.log('  Password      : ' + PASSWORD)
  console.log('  UID           : ' + targetUid)
  console.log('  Dashboard     : http://localhost:5173/login')
  console.log('  Landing page  : /super-admin-dashboard')
  console.log('===============================================')
  console.log(`\nSeed ref: users/${targetUid} (uid ${uid()})`)
}

main().catch((e) => {
  console.error('[FAIL]', e.message)
  process.exit(1)
})