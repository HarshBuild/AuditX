/*
 * Copy the dashboard build output (vite-plugin-singlefile) into desktop/dist
 * so electron-builder picks it up without symlinks or requiring a shared
 * output directory in the root.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const src = resolve(dir, '..', '..', 'dashboard', 'dist')
const dest = resolve(dir, '..', 'dist')

if (!existsSync(src)) {
  console.error(`[desktop] Source directory not found: ${src}\nRun npm run app:build first.`)
  process.exit(1)
}
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`[desktop] Copied ${src} -> ${dest}`)