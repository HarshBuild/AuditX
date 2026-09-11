/**
 * mint-claims.cjs — ensure every Firebase Auth user has a users/{uid} profile
 * and custom claims matching it. Makes staff collection LIST queries pass
 * Firestore rules (claimsStaff / claimsManager) without needing the Cloud
 * Functions trigger deployed.
 *
 * Run from backend/firebase/functions:
 *   node scripts/mint-claims.cjs
 */
const { readFileSync } = require('node:fs')
const { initializeApp, cert } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore } = require('firebase-admin/firestore')

const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  'C:\\Users\\Dell\\AppData\\Local\\Temp\\opencode\\scanner-56fcf-firebase-adminsdk.json'

let credential
try {
  credential = cert(JSON.parse(readFileSync(KEY, 'utf8')))
} catch {
  console.error(`[FAIL] Could not read service-account file at:\n  ${KEY}`)
  process.exit(1)
}
initializeApp({ credential })

const STAFF_ROLES = ['super_admin', 'admin', 'inspector']

async function main() {
  const auth = getAuth()
  const db = getFirestore()

  const authUsers = []
  let nextPageToken
  do {
    const res = await auth.listUsers(1000, nextPageToken)
    authUsers.push(...res.users)
    nextPageToken = res.pageToken
  } while (nextPageToken)
  console.log(`[INFO] ${authUsers.length} auth users found`)

  let minted = 0
  let createdDocs = 0
  let claimedStaff = 0

  for (const u of authUsers) {
    const docRef = db.collection('users').doc(u.uid)
    const snap = await docRef.get()

    let role = 'user'
    let status = 'active'

    if (snap.exists) {
      const d = snap.data()
      role = String(d.role ?? 'user')
      status = String(d.status ?? 'active')
      if (u.email && !d.email) {
        await docRef.update({ email: u.email }).catch(() => {})
      }
    } else {
      const now = new Date().toISOString()
      await docRef.set({
        uid: u.uid,
        email: u.email ?? '',
        full_name: u.displayName ?? (u.email ? u.email.split('@')[0] : 'User'),
        display_name: u.displayName ?? '',
        organization: '',
        role: 'user',
        status: 'active',
        created_at: now,
        updated_at: now,
        last_login: null,
      })
      createdDocs++
      console.log(`  [DOC] Created users/${u.uid} (${u.email ?? 'no email'}) as active user`)
    }

    try {
      await auth.setCustomUserClaims(u.uid, { role, status })
      minted++
      if (STAFF_ROLES.includes(role)) {
        claimedStaff++
        console.log(`  [CLAIM] ${u.email ?? u.uid} -> role=${role}, status=${status}`)
      }
    } catch (e) {
      console.error(`  [WARN] Could not mint claims for ${u.email ?? u.uid}: ${e.message}`)
    }
  }

  console.log(`\n[DONE] minted claims for ${minted} users, created ${createdDocs} user docs, ${claimedStaff} staff accounts now have claims.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error('[FAIL]', e.message); process.exit(1) })