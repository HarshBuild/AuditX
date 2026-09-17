/**
 * Firebase Admin initialization from Render environment variables.
 * Never commit service-account JSON — always use env vars.
 */
import admin from 'firebase-admin'

// Validate required env vars immediately
const requiredVars = ['PROJECT_ID', 'CLIENT_EMAIL', 'PRIVATE_KEY'] as const
for (const v of requiredVars) {
  if (!process.env[v]) {
    const msg = `❌ Missing required env var: ${v}`
    console.error(msg)
    throw new Error(msg)
  }
}

// Parse private key — handle both literal \n and actual newlines
let privateKey = process.env.PRIVATE_KEY!
// If key contains literal \n (two chars), convert to actual newlines
if (privateKey.includes('\\n')) {
  privateKey = privateKey.replace(/\\n/gm, '\n')
}
// Ensure key has proper format
if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
  throw new Error('❌ PRIVATE_KEY format invalid: missing BEGIN header')
}
if (!privateKey.includes('-----END PRIVATE KEY-----')) {
  throw new Error('❌ PRIVATE_KEY format invalid: missing END header')
}

// Storage bucket — from STORAGE_BUCKET env or default <projectId>.appspot.com
const storageBucket = process.env.STORAGE_BUCKET || `${process.env.PROJECT_ID}.appspot.com`
if (process.env.STORAGE_BUCKET) {
  console.log(`   Storage bucket: ${process.env.STORAGE_BUCKET}`)
} else {
  console.log(`   Storage bucket: ${storageBucket} (auto from PROJECT_ID)`)
}

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.PROJECT_ID,
      clientEmail: process.env.CLIENT_EMAIL,
      privateKey,
    }),
    storageBucket,
  })
  // Verify initialization worked
  if (typeof admin.auth !== 'function') {
    throw new Error('Firebase Admin init failed: admin.auth not available')
  }
  console.log('✅ Firebase Admin initialized successfully')
  console.log('   Project:', process.env.PROJECT_ID)
  console.log('   Client:', process.env.CLIENT_EMAIL)
  console.log('   Storage:', storageBucket)
} catch (err) {
  console.error('❌ Failed to initialize Firebase Admin:', err)
  throw err
}

// Export initialized admin for routes to use
export { admin }