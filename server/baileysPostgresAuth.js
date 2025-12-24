// server/baileysPostgresAuth.js
import pg from 'pg'

const { Pool } = pg

// Heroku provides DATABASE_URL.
// pg will use SSL on Heroku Postgres; keep rejectUnauthorized false for Heroku.
// (If you use a private CA later, tighten this.)
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

// Baileys expects an object with `state` + `saveCreds`,
// but for production we also need a key store.
// We’ll persist both creds + keys as JSON.
export async function usePostgresAuthState (sessionId = 'default') {
  const baseId = `wa:${sessionId}`
  const existing = await dbGet(baseId)

  const state = existing || {
    creds: null,
    keys: {}
  }

  const saveState = async () => {
    await dbSet(baseId, state)
  }

  // key store wrapper Baileys expects: get/set for categories
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
    state: {
      creds: state.creds,
      keys
    },
    // Baileys triggers creds.update often; persist creds back
    saveCreds: async () => {
      // creds will be mutated by Baileys in memory
      await saveState()
    },
    clear: async () => {
      await dbDel(baseId)
    }
  }
}
