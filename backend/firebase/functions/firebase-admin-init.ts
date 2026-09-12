/**
 * Firebase Admin initialization from Render environment variables.
 * Never commit service-account JSON — always use env vars.
 */
import admin from 'firebase-admin'

// Parse private key — support both literal \\n and actual newlines
const privateKey = process.env.PRIVATE_KEY?.replace(/\\n/gm, '\n') ?? ''

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.PROJECT_ID,
      clientEmail: process.env.CLIENT_EMAIL,
      privateKey,
    }),
  })
  console.log('✅ Firebase Admin initialized from env vars')
} catch (err) {
  console.error('❌ Failed to initialize Firebase Admin:', err)
  // Do NOT process.exit() here — the server framework will handle startup failures
}