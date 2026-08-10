import jwt from 'jsonwebtoken'
import { loadServerEnv } from '../lib/loadEnv.js'
import { getJwtSecret } from '../lib/jwtSecret.js'

loadServerEnv()

const args = parseArgs(process.argv.slice(2))
const role = String(args.role || 'admin').trim().toLowerCase()
const name = String(args.name || 'Ops Hub Smoke').trim()
const kind = String(args.kind || (role === 'supervisor' ? 'supervisor' : 'manager')).trim().toLowerCase()
const id = String(args.id || '999999').trim()
const expiresIn = String(args.expiresIn || '15m').trim()

const token = jwt.sign(
  {
    id,
    name,
    role,
    kind
  },
  getJwtSecret(),
  { expiresIn }
)

process.stdout.write(`${token}\n`)

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue

    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = true
      continue
    }

    parsed[key] = next
    index += 1
  }

  return parsed
}
