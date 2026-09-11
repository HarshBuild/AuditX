import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', 'dist', 'index.html')
const destDir = join(here, '..', '..')
const dest = join(destDir, 'dashboard.html')

if (!existsSync(source)) {
  console.error('dist/index.html not found. Run `npm run build` first.')
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
copyFileSync(source, dest)
console.log(`Dashboard published to ${dest}`)