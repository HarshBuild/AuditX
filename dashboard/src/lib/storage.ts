import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { auth, storage } from './firebase'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Upload a product-label photo to Firebase Storage under /scans/{uid}/… and return its download URL. */
export async function uploadScanImage(file: File): Promise<string> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Not authenticated')
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG, PNG or WEBP).')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image must be 10 MB or smaller.')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `scans/${uid}/${Date.now()}-${safeName}`
  const snap = await uploadBytes(ref(storage, path), file, {
    contentType: file.type,
  })
  return getDownloadURL(snap.ref)
}

/** Upload several label photos (front/back/sides) and return their download URLs in order. */
export async function uploadScanImages(files: File[]): Promise<string[]> {
  if (files.length === 0) return []
  const stamp = Date.now()
  const out: string[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" is not an image file.`)
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`"${file.name}" must be 10 MB or smaller.`)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `scans/${auth.currentUser?.uid ?? 'x'}/${stamp}-${i}-${safeName}`
    const snap = await uploadBytes(ref(storage, path), file, { contentType: file.type })
    out.push(await getDownloadURL(snap.ref))
  }
  return out
}