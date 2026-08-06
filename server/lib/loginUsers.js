import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export const SUPERVISOR_LOGIN_ROLES = ['admin', 'supervisor']
export const MANAGER_LOGIN_ROLES = ['engineering', 'manager']
export const LOGIN_USER_ROLES = [
  ...SUPERVISOR_LOGIN_ROLES,
  ...MANAGER_LOGIN_ROLES
]
const APP_NAME = 'Frogfoot Ops Hub'

export function isPasswordHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ''))
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10)
}

export function passwordMatches(password, storedValue) {
  const stored = String(storedValue || '')
  if (!stored) return false
  return isPasswordHash(stored)
    ? bcrypt.compareSync(password, stored)
    : password === stored
}

export function normalizeLoginRole(rawRole) {
  const role = String(rawRole || '').trim().toLowerCase()
  if (!LOGIN_USER_ROLES.includes(role)) {
    throw new Error(`Unsupported login role: ${rawRole || 'blank'}`)
  }
  return role
}

export function roleFamily(roleRaw) {
  const role = normalizeLoginRole(roleRaw)
  return SUPERVISOR_LOGIN_ROLES.includes(role) ? 'supervisor' : 'manager'
}

export function generateTemporaryPassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(length + 8)
  let output = ''
  for (let i = 0; i < bytes.length && output.length < length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length]
  }
  return `${output}!`
}

export function buildUserEmailDraft({
  fullName,
  email,
  role,
  temporaryPassword,
  appUrl,
  reason = 'created'
}) {
  const subject = reason === 'reset'
    ? `${APP_NAME} password reset`
    : `Your ${APP_NAME} account`

  const body = [
    `Hi ${fullName || 'there'},`,
    '',
    reason === 'reset'
      ? `Your ${APP_NAME} password has been reset.`
      : `Your ${APP_NAME} account has been created.`,
    '',
    `Role: ${role}`,
    `Login email: ${email}`,
    `Temporary password: ${temporaryPassword}`,
    '',
    `Login URL: ${appUrl}`,
    '',
    'Please sign in and change this password as soon as possible.',
    '',
    'Regards,',
    'Frogfoot NOC'
  ].join('\n')

  return { to: email, subject, body }
}

export function serializeLoginUser(row, kind) {
  const passwordValue = kind === 'supervisor' ? row.hash : row.password
  return {
    id: row.id,
    kind,
    fullName: row.fullName,
    email: row.email,
    role: String(row.role || '').toLowerCase(),
    lastLogin: row.lastLogin || null,
    createdAt: row.createdAt || null,
    passwordState: isPasswordHash(passwordValue) ? 'hashed' : 'legacy_plaintext'
  }
}

export async function listLoginUsers(prisma) {
  const [supervisors, managers] = await Promise.all([
    prisma.supervisor.findMany({
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        hash: true
      },
      orderBy: [{ fullName: 'asc' }, { email: 'asc' }]
    }),
    prisma.manager.findMany({
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        password: true,
        lastLogin: true,
        createdAt: true
      },
      orderBy: [{ fullName: 'asc' }, { email: 'asc' }]
    })
  ])

  const users = [
    ...supervisors.map((row) => serializeLoginUser(row, 'supervisor')),
    ...managers.map((row) => serializeLoginUser(row, 'manager'))
  ].sort((left, right) =>
    String(left.fullName || left.email || '').localeCompare(String(right.fullName || right.email || '')) ||
    String(left.email || '').localeCompare(String(right.email || ''))
  )

  const summary = {
    total: users.length,
    admins: users.filter((row) => row.role === 'admin').length,
    supervisors: users.filter((row) => row.role === 'supervisor').length,
    managers: users.filter((row) => row.role === 'manager').length,
    engineering: users.filter((row) => row.role === 'engineering').length,
    legacyPasswordCount: users.filter((row) => row.passwordState === 'legacy_plaintext').length
  }

  return { users, summary }
}

export async function assertLoginEmailAvailable(prisma, email, exclude = null) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) throw new Error('Email is required')

  const [supervisor, manager] = await Promise.all([
    prisma.supervisor.findUnique({ where: { email: normalized } }),
    prisma.manager.findUnique({ where: { email: normalized } })
  ])

  const clashes = [
    supervisor ? { kind: 'supervisor', id: supervisor.id } : null,
    manager ? { kind: 'manager', id: manager.id } : null
  ].filter(Boolean)

  const allowed = clashes.every((entry) =>
    exclude && entry.kind === exclude.kind && String(entry.id) === String(exclude.id)
  )

  if (!allowed && clashes.length > 0) {
    throw new Error(`A login user already exists with email ${normalized}`)
  }
}

export async function findLoginUser(prisma, kind, id) {
  if (kind === 'supervisor') {
    const row = await prisma.supervisor.findUnique({ where: { id } })
    return row ? { kind, row } : null
  }

  if (kind === 'manager') {
    const row = await prisma.manager.findUnique({ where: { id } })
    return row ? { kind, row } : null
  }

  throw new Error(`Unknown login user kind: ${kind}`)
}
