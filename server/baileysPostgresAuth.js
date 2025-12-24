// server/baileysPostgresAuth.js
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys'
import pkg from 'pg'

const { Pool } = pkg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

export async function usePostgresAuthState (sessionId) {
  // Ensure table exists
  await pool.query(`
    create table if not exists whatsapp_auth (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `)

  async function readData () {
    const res = await pool.query(
      'select data from whatsapp_auth where id = $1',
      [sessionId]
    )

    if (!res.rows.length) return null

    // 🔑 CRITICAL: revive Buffers
    return JSON.parse(
      JSON.stringify(res.rows[0].data),
      BufferJSON.reviver
    )
  }

  async function writeData (data) {
    await pool.query(
      `
      insert into whatsapp_auth (id, data, updated_at)
      values ($1, $2, now())
      on conflict (id)
      do update set data = excluded.data, updated_at = now()
      `,
      [sessionId, JSON.parse(JSON.stringify(data, BufferJSON.replacer))]
    )
  }

  async function clear () {
    await pool.query('delete from whatsapp_auth where id = $1', [sessionId])
  }

  const stored = await readData()

  const state = stored ?? {
    creds: initAuthCreds(),
    keys: {}
  }

  return {
    state,
    saveCreds: async () => writeData(state),
    clear
  }
}
