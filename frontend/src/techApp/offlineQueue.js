// frontend/src/techApp/offlineQueue.js
import { openDB } from 'idb'

const DB_NAME = 'tech_offline_db'
const STORE = 'event_queue'

async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' })
        s.createIndex('by_createdAt', 'createdAt')
      }
    }
  })
}

export function makeClientEventId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export async function enqueueEvent(evt) {
  const db = await getDb()
  const record = {
    id: evt.clientEventId,
    createdAt: Date.now(),
    retryCount: 0,
    lastError: null,
    ...evt
  }
  await db.put(STORE, record)
  return record
}

export async function listQueuedEvents() {
  const db = await getDb()
  const all = await db.getAll(STORE)
  all.sort((a, b) => a.createdAt - b.createdAt)
  return all
}

export async function removeQueuedEvent(id) {
  const db = await getDb()
  await db.delete(STORE, id)
}

export async function bumpRetry(id, errorText) {
  const db = await getDb()
  const rec = await db.get(STORE, id)
  if (!rec) return
  rec.retryCount = (rec.retryCount || 0) + 1
  rec.lastError = String(errorText || 'unknown').slice(0, 500)
  await db.put(STORE, rec)
}
