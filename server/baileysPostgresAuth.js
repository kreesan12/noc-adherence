// server/baileysPostgresAuth.js
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys'
import pkg from 'pg'

const { Pool } = pkg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const TABLE = 'public.whatsapp_auth'

// One-time DB identity log (helps confirm pgAdmin and dyno are on same DB)
pool.on('connect', async (client) => {
  try {
    const r = await client.query(
      'select current_database() as db, inet_server_addr() as host, inet_server_port() as port'
    )
    console.log('[WA][DB]', r.rows[0])
  } catch (e) {
    console.log('[WA][DB] unable to read db identity:', e?.message || e)
  }
})

async function ensureSchema () {
  // Create table if missing
  await pool.query(`
    create table if not exists ${TABLE} (
      session_id text not null,
      type text not null,
      key text not null,
      value jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (session_id, type, key)
    )
  `)

  // Heal older schemas
  const colsRes = await pool.query(
    `
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_auth'
    `
  )
  const cols = new Set(colsRes.rows.map(r => r.column_name))

  // If old schema used "data" instead of "value"
  if (cols.has('data') && !cols.has('value')) {
    await pool.query(`alter table ${TABLE} rename column data to value`)
  }

  // If value is missing for any reason
  if (!cols.has('value')) {
    await pool.query(`alter table ${TABLE} add column if not exists value jsonb`)
  }

  // updated_at is nice to have
  if (!cols.has('updated_at')) {
    await pool.query(`alter table ${TABLE} add column if not exists updated_at timestamptz not null default now()`)
  }
}

export async function usePostgresAuthState (sessionId) {
  await ensureSchema()

  // ---------- CREDS ----------
  const credsRes = await pool.query(
    `select value from ${TABLE}
     where session_id = $1 and type = 'creds' and key = 'creds'`,
    [sessionId]
  )

  const creds = credsRes.rows.length
    ? JSON.parse(JSON.stringify(credsRes.rows[0].value), BufferJSON.reviver)
    : initAuthCreds()

  async function saveCreds () {
    await pool.query(
      `
      insert into ${TABLE} (session_id, type, key, value)
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
        select key, value from ${TABLE}
        where session_id = $1 and type = $2 and key = any($3)
        `,
        [sessionId, type, ids]
      )

      const out = {}
      for (const row of res.rows) {
        out[row.key] = JSON.parse(JSON.stringify(row.value), BufferJSON.reviver)
      }
      return out
    },

    async set (data) {
      for (const type of Object.keys(data)) {
        for (const key of Object.keys(data[type])) {
          const value = JSON.parse(JSON.stringify(data[type][key], BufferJSON.replacer))

          await pool.query(
            `
            insert into ${TABLE} (session_id, type, key, value)
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
    await pool.query(`delete from ${TABLE} where session_id = $1`, [sessionId])
  }

  return {
    state: { creds, keys },
    saveCreds,
    clear
  }
}
