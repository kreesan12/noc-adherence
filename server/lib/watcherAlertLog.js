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
    const result = await prisma.watcherAlertLog.createMany({
      data: {
        dedupeKey,
        watcherKey,
        alertType,
        entityId: entityId == null ? null : String(entityId),
        payload: payload ?? undefined
      },
      skipDuplicates: true
    })

    warnedPersistenceFailure = false
    return result.count > 0
  } catch (error) {
    if (!warnedPersistenceFailure) {
      console.warn('[WATCHER ALERT LOG] Falling back to in-memory dedupe:', error?.message || error)
      warnedPersistenceFailure = true
    }

    return null
  }
}
