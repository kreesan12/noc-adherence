// server/baileysPostgresAuth.js
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys'
import pkg from 'pg'

const { Pool } = pkg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

export async function usePostgresAuthState (sessionId) {
  await pool.query(`
    create table if not exists whatsapp_auth (
      session_id text not null,
      type text not null,
      key text not null,
      value jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (session_id, type, key)
    )
  `)

  // ---------- CREDS ----------
  const credsRes = await pool.query(
    `select value from whatsapp_auth
     where session_id = $1 and type = 'creds' and key = 'creds'`,
    [sessionId]
  )

  const creds = credsRes.rows.length
    ? JSON.parse(JSON.stringify(credsRes.rows[0].value), BufferJSON.reviver)
    : initAuthCreds()

  async function saveCreds () {
    await pool.query(
      `
      insert into whatsapp_auth (session_id, type, key, value)
      values ($1, 'creds', 'creds', $2)
      on conflict (session_id, type, key)
      do update set value = excluded.value, updated_at = now()
      `,
      [sessionId, JSON.parse(JSON.stringify(creds, BufferJSON.replacer))]
    )
  }

  // ---------- KEYS ----------
  const keys = {
    async get (type, ids) {
      const res = await pool.query(
        `
        select key, value from whatsapp_auth
        where session_id = $1 and type = $2 and key = any($3)
        `,
        [sessionId, type, ids]
      )

      const out = {}
      for (const row of res.rows) {
        out[row.key] = JSON.parse(
          JSON.stringify(row.value),
          BufferJSON.reviver
        )
      }
      return out
    },

    async set (data) {
      for (const type of Object.keys(data)) {
        for (const key of Object.keys(data[type])) {
          const value = JSON.parse(
            JSON.stringify(data[type][key], BufferJSON.replacer)
          )

          await pool.query(
            `
            insert into whatsapp_auth (session_id, type, key, value)
            values ($1, $2, $3, $4)
            on conflict (session_id, type, key)
            do update set value = excluded.value, updated_at = now()
            `,
            [sessionId, type, key, value]
          )
        }
      }
    }
  }

  async function clear () {
    await pool.query(
      'delete from whatsapp_auth where session_id = $1',
      [sessionId]
    )
  }

  return {
    state: { creds, keys },
    saveCreds,
    clear
  }
}
