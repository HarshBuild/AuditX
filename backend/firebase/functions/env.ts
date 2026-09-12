/**
 * Minimal .env loader for local development.
 * On Render the environment is injected by the platform, so this file is a no-op
 * when no .env file exists in the current working directory.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const ENV_PATH = path.resolve(process.cwd(), '.env')

export function loadEnvFile(): Record<string, string> {
  const loaded: Record<string, string> = {}
  if (!fs.existsSync(ENV_PATH)) return loaded

  const raw = fs.readFileSync(ENV_PATH, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
      loaded[key] = value
    }
  }
  return loaded
}

loadEnvFile()