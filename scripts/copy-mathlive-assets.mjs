// MathLive (the math editor in notes) draws with its own fonts. Copy them into
// public/ so they ship with the app and work offline. Runs before dev and build.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules', 'mathlive', 'fonts')
const to = join(root, 'public', 'mathlive', 'fonts')
if (!existsSync(from)) throw new Error('mathlive is not installed: run npm install')
mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true })
