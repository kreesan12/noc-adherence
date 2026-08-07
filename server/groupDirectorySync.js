import prisma from './lib/prisma.js'
import { listWhatsAppGroups } from './whatsappClient.js'

const GROUP_SYNC_INTERVAL_MS = Number(process.env.WA_GROUP_SYNC_MS || 60 * 60 * 1000)
const SESSION_ID = process.env.WHATSAPP_SESSION_ID || 'noc-adherence'

let syncStarted = false
let nextTimer = null

async function runGroupSync() {
  const groups = await listWhatsAppGroups()
  const now = new Date()

  for (const group of groups) {
    await prisma.whatsAppGroupDirectory.upsert({
      where: { jid: group.id },
      update: {
        name: group.name || group.id,
        participantCount: group.participants || 0,
        participantJids: group.participantJids || [],
        sessionId: SESSION_ID,
        lastSeenAt: now
      },
      create: {
        jid: group.id,
        name: group.name || group.id,
        participantCount: group.participants || 0,
        participantJids: group.participantJids || [],
        sessionId: SESSION_ID,
        lastSeenAt: now
      }
    })
  }

  console.log(`[WA GROUP SYNC] Synced ${groups.length} groups`)
}

function scheduleNext() {
  clearTimeout(nextTimer)
  nextTimer = setTimeout(tick, Math.max(5 * 60 * 1000, GROUP_SYNC_INTERVAL_MS))
  nextTimer.unref?.()
}

async function tick() {
  try {
    await runGroupSync()
  } catch (error) {
    console.error('[WA GROUP SYNC] Sync failed:', error?.message || error)
  } finally {
    scheduleNext()
  }
}

export function startWhatsAppGroupDirectorySync() {
  if (syncStarted) return
  syncStarted = true
  console.log(`[WA GROUP SYNC] Starting - interval ${Math.round(GROUP_SYNC_INTERVAL_MS / 60000)} min`)
  void tick()
}
