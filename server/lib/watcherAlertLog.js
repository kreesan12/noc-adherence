import prisma from './prisma.js'

let warnedPersistenceFailure = false

export async function recordWatcherAlert({
  dedupeKey,
  watcherKey,
  alertType,
  entityId = null,
  payload = null
}) {
  try {
    await prisma.watcherAlertLog.create({
      data: {
        dedupeKey,
        watcherKey,
        alertType,
        entityId: entityId == null ? null : String(entityId),
        payload: payload ?? undefined
      }
    })

    warnedPersistenceFailure = false
    return true
  } catch (error) {
    if (error?.code === 'P2002') {
      return false
    }

    if (!warnedPersistenceFailure) {
      console.warn('[WATCHER ALERT LOG] Falling back to in-memory dedupe:', error?.message || error)
      warnedPersistenceFailure = true
    }

    return null
  }
}
