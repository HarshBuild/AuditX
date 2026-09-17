import { currentUid, supabase } from './supabase'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** Upload a product-label photo to Supabase Storage under `<uid>/…` and return its public URL. */
export async function uploadScanImage(file: File): Promise<string> {
  const uid = await currentUid()
  if (!uid) throw new Error('Not authenticated')
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG, PNG or WEBP).')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image must be 10 MB or smaller.')
  const path = `${uid}/${Date.now()}-${safeName(file.name)}`
  const { error } = await supabase.storage.from('scans').upload(path, file, {
    contentType: file.type,
    upsert: true,
  })
  if (error) throw new Error(error.message)
  return supabase.storage.from('scans').getPublicUrl(path).data.publicUrl
}

/** Upload several label photos (front/back/sides) and return their public URLs in order. */
export async function uploadScanImages(files: File[]): Promise<string[]> {
  if (files.length === 0) return []
  const uid = await currentUid()
  if (!uid) throw new Error('Not authenticated')
  const stamp = Date.now()
  const out: string[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" is not an image file.`)
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`"${file.name}" must be 10 MB or smaller.`)
    const path = `${uid}/${stamp}-${i}-${safeName(file.name)}`
    const { error } = await supabase.storage.from('scans').upload(path, file, {
      contentType: file.type,
      upsert: true,
    })
    if (error) throw new Error(error.message)
    out.push(supabase.storage.from('scans').getPublicUrl(path).data.publicUrl)
  }
  return out
}
