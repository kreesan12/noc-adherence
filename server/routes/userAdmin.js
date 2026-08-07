import { Router } from 'express'
import { z } from 'zod'

import {
  SUPERVISOR_LOGIN_ROLES,
  assertLoginEmailAvailable,
  buildUserEmailDraft,
  defaultLoginKindForRole,
  findLoginUser,
  generateTemporaryPassword,
  hashPassword,
  isPasswordHash,
  listLoginUsers,
  normalizeLoginKind,
  normalizeLoginRole,
  resolveLoginKindForRole,
  serializeLoginUser
} from '../lib/loginUsers.js'
import {
  detachManagerReferences,
  detachSupervisorReferences,
  migrateManagerSignatureToSupervisor,
  migrateSupervisorSignatureToManager
} from '../lib/loginUserLifecycle.js'

const createSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email(),
  role: z.string().trim().min(1),
  kind: z.string().trim().optional().or(z.literal('')),
  password: z.string().trim().min(8).optional().or(z.literal(''))
})

const updateSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email(),
  role: z.string().trim().min(1),
  kind: z.string().trim().optional().or(z.literal(''))
})

function buildAppUrl(req) {
  const origin = process.env.CLIENT_ORIGIN?.split(',')[0]?.trim() || `${req.protocol}://${req.get('host')}`
  return `${origin.replace(/\/$/, '')}/login`
}

function toResetPayload(req, user, tempPassword, reason) {
  return {
    temporaryPassword: tempPassword,
    emailDraft: buildUserEmailDraft({
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      temporaryPassword: tempPassword,
      appUrl: buildAppUrl(req),
      reason
    })
  }
}

async function ensureNotSelfDestructive(reqUser, targetKind, targetId, nextRole = null, nextKind = null) {
  if (!reqUser) return
  if (String(reqUser.id) !== String(targetId)) return
  const reqRole = String(reqUser.role || '').toLowerCase()
  const reqKind = normalizeLoginKind(reqUser.kind || (SUPERVISOR_LOGIN_ROLES.includes(reqRole) ? 'supervisor' : 'manager'))
  if (reqKind !== targetKind) return

  const resolvedRole = nextRole ? normalizeLoginRole(nextRole) : reqRole
  const resolvedKind = nextKind
    ? normalizeLoginKind(nextKind)
    : resolveLoginKindForRole(resolvedRole, null, reqKind)

  if (resolvedRole === reqRole && resolvedKind === reqKind) return

  throw new Error('You cannot delete or reassign your own active login from this screen.')
}

async function deleteSupervisorWithCleanup(tx, id) {
  await detachSupervisorReferences(tx, id)
  await tx.supervisor.delete({ where: { id } })
}

async function deleteManagerWithCleanup(tx, id) {
  await detachManagerReferences(tx, id)
  await tx.manager.delete({ where: { id } })
}

export default function userAdminRouter(prisma) {
  const r = Router()

  r.get('/', async (_req, res) => {
    res.json(await listLoginUsers(prisma))
  })

  r.post('/', async (req, res) => {
    const parsed = createSchema.parse(req.body || {})
    const role = normalizeLoginRole(parsed.role)
    const kind = resolveLoginKindForRole(role, parsed.kind, defaultLoginKindForRole(role))
    const email = parsed.email.trim().toLowerCase()
    const tempPassword = (parsed.password || '').trim() || generateTemporaryPassword()
    const passwordValue = hashPassword(tempPassword)

    await assertLoginEmailAvailable(prisma, email)

    const created = kind === 'supervisor'
      ? await prisma.supervisor.create({
          data: {
            fullName: parsed.fullName.trim(),
            email,
            role,
            hash: passwordValue
          }
        })
      : await prisma.manager.create({
          data: {
            fullName: parsed.fullName.trim(),
            email,
            role,
            password: passwordValue
          }
        })

    const user = serializeLoginUser(created, kind)

    res.status(201).json({
      user,
      onboarding: toResetPayload(req, user, tempPassword, 'created')
    })
  })

  r.patch('/:kind/:id', async (req, res) => {
    const kind = String(req.params.kind || '').trim().toLowerCase()
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' })

    const parsed = updateSchema.parse(req.body || {})
    const nextRole = normalizeLoginRole(parsed.role)

    const existing = await findLoginUser(prisma, kind, id)
    if (!existing) return res.status(404).json({ error: 'User not found' })

    const targetKind = resolveLoginKindForRole(nextRole, parsed.kind, existing.kind)

    await ensureNotSelfDestructive(req.user, kind, id, nextRole, targetKind)
    await assertLoginEmailAvailable(prisma, parsed.email, { kind, id })

    if (existing.kind === targetKind) {
      const updated = existing.kind === 'supervisor'
        ? await prisma.supervisor.update({
            where: { id },
            data: {
              fullName: parsed.fullName.trim(),
              email: parsed.email.trim().toLowerCase(),
              role: nextRole
            }
          })
        : await prisma.manager.update({
            where: { id },
            data: {
              fullName: parsed.fullName.trim(),
              email: parsed.email.trim().toLowerCase(),
              role: nextRole
            }
          })

      return res.json({ user: serializeLoginUser(updated, existing.kind) })
    }

    const moved = await prisma.$transaction(async (tx) => {
      if (existing.kind === 'supervisor') {
        const source = await tx.supervisor.findUnique({ where: { id } })
        const created = await tx.manager.create({
          data: {
            fullName: parsed.fullName.trim(),
            email: parsed.email.trim().toLowerCase(),
            role: nextRole,
            password: source?.hash || hashPassword(generateTemporaryPassword())
          }
        })
        await migrateSupervisorSignatureToManager(tx, id, created.id)
        await deleteSupervisorWithCleanup(tx, id)
        return serializeLoginUser(created, targetKind)
      }

      const source = await tx.manager.findUnique({ where: { id } })
      const nextHash = isPasswordHash(source?.password)
        ? source.password
        : hashPassword(source?.password || generateTemporaryPassword())

      const created = await tx.supervisor.create({
        data: {
          fullName: parsed.fullName.trim(),
          email: parsed.email.trim().toLowerCase(),
          role: nextRole,
          hash: nextHash
        }
      })
      await migrateManagerSignatureToSupervisor(tx, id, created.id)
      await deleteManagerWithCleanup(tx, id)
      return serializeLoginUser(created, targetKind)
    })

    res.json({ user: moved })
  })

  r.post('/:kind/:id/reset-password', async (req, res) => {
    const kind = String(req.params.kind || '').trim().toLowerCase()
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' })

    const tempPassword = generateTemporaryPassword()
    const nextValue = hashPassword(tempPassword)

    const existing = await findLoginUser(prisma, kind, id)
    if (!existing) return res.status(404).json({ error: 'User not found' })

    const updated = kind === 'supervisor'
      ? await prisma.supervisor.update({
          where: { id },
          data: { hash: nextValue }
        })
      : await prisma.manager.update({
          where: { id },
          data: { password: nextValue }
        })

    const user = serializeLoginUser(updated, kind)
    res.json({
      user,
      reset: toResetPayload(req, user, tempPassword, 'reset')
    })
  })

  r.delete('/:kind/:id', async (req, res) => {
    const kind = String(req.params.kind || '').trim().toLowerCase()
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' })

    await ensureNotSelfDestructive(req.user, kind, id)

    const existing = await findLoginUser(prisma, kind, id)
    if (!existing) return res.status(404).json({ error: 'User not found' })

    await prisma.$transaction(async (tx) => {
      if (kind === 'supervisor') {
        await deleteSupervisorWithCleanup(tx, id)
      } else {
        await deleteManagerWithCleanup(tx, id)
      }
    })

    res.status(204).end()
  })

  return r
}
