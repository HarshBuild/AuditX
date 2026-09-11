/*
 * AuditX v3.0 — Firebase bootstrap.
 * Single import for the initialized Firebase app, Auth, Firestore, Storage and
 * the (optional) Cloud Functions runtime used by the scan/AI pipeline.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'
import { getFunctions, type Functions } from 'firebase/functions'
import { CONFIG } from './config'

export const firebaseApp: FirebaseApp = initializeApp({
  apiKey: CONFIG.FIREBASE_API_KEY,
  authDomain: CONFIG.FIREBASE_AUTH_DOMAIN,
  projectId: CONFIG.FIREBASE_PROJECT_ID,
  storageBucket: CONFIG.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: CONFIG.FIREBASE_MESSAGING_SENDER_ID,
  appId: CONFIG.FIREBASE_APP_ID,
  measurementId: CONFIG.FIREBASE_MEASUREMENT_ID,
})

export const auth: Auth = getAuth(firebaseApp)
export const db: Firestore = getFirestore(firebaseApp)
export const storage: FirebaseStorage = getStorage(firebaseApp)
export const functions: Functions = getFunctions(firebaseApp, CONFIG.FIREBASE_FUNCTIONS_REGION)

/*
 * Normalized authenticated-user shape kept identical to the pre-migration
 * `User` contract so guards, RBAC and components compile unchanged.
 */
export interface AuthUser {
  id: string
  email: string | null
  user_metadata: Record<string, unknown>
  created_at: string | null
}