// server/baileysPostgresAuth.js
import pg from 'pg'
import { initAuthCreds } from '@whiskeysockets/baileys'

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
})

async function dbGet (id) {
  const { rows } = await pool.query(
    'select data from whatsapp_auth where id = $1',
    [id]
  )
  return rows[0]?.data ?? null
}

async function dbSet (id, data) {
  await pool.query(
    `insert into whatsapp_auth (id, data, updated_at)
     values ($1, $2, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`,
    [id, data]
  )
}

async function dbDel (id) {
  await pool.query('delete from whatsapp_auth where id = $1', [id])
}

export async function usePostgresAuthState (sessionId = 'default') {
  const baseId = `wa:${sessionId}`
  const existing = await dbGet(baseId)

  // IMPORTANT: creds must be an object, never null
  const state = existing && typeof existing === 'object'
    ? existing
    : { creds: initAuthCreds(), keys: {} }

  // if existing had creds as null from earlier attempts, fix it
  if (!state.creds) state.creds = initAuthCreds()
  if (!state.keys) state.keys = {}

  const saveState = async () => {
    await dbSet(baseId, state)
  }

  const keys = {
    get: async (type, ids) => {
      const out = {}
      for (const id of ids) {
        out[id] = state.keys?.[type]?.[id] || null
      }
      return out
    },
    set: async (data) => {
      state.keys = state.keys || {}
      for (const type of Object.keys(data)) {
        state.keys[type] = state.keys[type] || {}
        Object.assign(state.keys[type], data[type])
      }
      await saveState()
    }
  }

  return {
    state: { creds: state.creds, keys },
    saveCreds: async () => {
      await saveState()
    },
    clear: async () => {
      await dbDel(baseId)
    }
  }
}
