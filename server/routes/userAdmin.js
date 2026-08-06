import { Router } from 'express'
import { z } from 'zod'

import {
  MANAGER_LOGIN_ROLES,
  SUPERVISOR_LOGIN_ROLES,
  assertLoginEmailAvailable,
  buildUserEmailDraft,
  findLoginUser,
  generateTemporaryPassword,
  hashPassword,
  isPasswordHash,
  listLoginUsers,
  normalizeLoginRole,
  roleFamily,
  serializeLoginUser
} from '../lib/loginUsers.js'

const createSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email(),
  role: z.string().trim().min(1),
  password: z.string().trim().min(8).optional().or(z.literal(''))
})

const updateSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email(),
  role: z.string().trim().min(1)
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

async function ensureNotSelfDestructive(prisma, reqUser, targetKind, targetId, nextRole = null) {
  if (!reqUser) return
  if (String(reqUser.id) !== String(targetId)) return
  const reqRole = String(reqUser.role || '').toLowerCase()
  const reqKind = SUPERVISOR_LOGIN_ROLES.includes(reqRole) ? 'supervisor' : 'manager'
  if (reqKind !== targetKind) return

  if (nextRole && nextRole === reqRole) return

  throw new Error('You cannot delete or reassign your own active login from this screen.')
}

export default function userAdminRouter(prisma) {
  const r = Router()

  r.get('/', async (_req, res) => {
    res.json(await listLoginUsers(prisma))
  })

  r.post('/', async (req, res) => {
    const parsed = createSchema.parse(req.body || {})
    const role = normalizeLoginRole(parsed.role)
    const family = roleFamily(role)
    const email = parsed.email.trim().toLowerCase()
    const tempPassword = (parsed.password || '').trim() || generateTemporaryPassword()
    const passwordValue = hashPassword(tempPassword)

    await assertLoginEmailAvailable(prisma, email)

    const created = family === 'supervisor'
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

    const user = serializeLoginUser(created, family)

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
    const nextFamily = roleFamily(nextRole)

    await ensureNotSelfDestructive(prisma, req.user, kind, id, nextRole)
    await assertLoginEmailAvailable(prisma, parsed.email, { kind, id })

    const existing = await findLoginUser(prisma, kind, id)
    if (!existing) return res.status(404).json({ error: 'User not found' })

    if (existing.kind === nextFamily) {
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
        await tx.supervisor.delete({ where: { id } })
        return serializeLoginUser(created, 'manager')
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
      await tx.manager.delete({ where: { id } })
      return serializeLoginUser(created, 'supervisor')
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

    await ensureNotSelfDestructive(prisma, req.user, kind, id)

    const existing = await findLoginUser(prisma, kind, id)
    if (!existing) return res.status(404).json({ error: 'User not found' })

    if (kind === 'supervisor') {
      await prisma.supervisor.delete({ where: { id } })
    } else {
      await prisma.manager.delete({ where: { id } })
    }

    res.status(204).end()
  })

  return r
}
