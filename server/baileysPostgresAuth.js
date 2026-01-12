// server/baileysPostgresAuth.js
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys'
import pkg from 'pg'

const { Pool } = pkg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const TABLE = 'public.whatsapp_auth'

// Optional: log DB identity once per connection (useful sanity)
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
    try {
      await pool.query(
        `
        insert into ${TABLE} (session_id, type, key, value)
        values ($1, 'creds', 'creds', $2::jsonb)
        on conflict (session_id, type, key)
        do update set value = excluded.value, updated_at = now()
        `,
        [sessionId, JSON.stringify(creds, BufferJSON.replacer)]
      )
    } catch (e) {
      console.error('[WA][DB] saveCreds failed:', e?.message || e)
      throw e
    }
  }

  // ---------- KEYS ----------
  const keys = {
    async get (type, ids) {
      try {
        if (!ids?.length) return {}

        const res = await pool.query(
          `
          select key, value from ${TABLE}
          where session_id = $1
            and type = $2
            and key = any($3::text[])
          `,
          [sessionId, type, ids]
        )

        const out = {}
        for (const row of res.rows) {
          out[row.key] = JSON.parse(JSON.stringify(row.value), BufferJSON.reviver)
        }
        return out
      } catch (e) {
        console.error('[WA][DB] keys.get failed:', { type, count: ids?.length }, e?.message || e)
        throw e
      }
    },

    async set (data) {
      // IMPORTANT: bulk upsert per type (much faster than one insert per key)
      try {
        const types = Object.keys(data || {})
        for (const type of types) {
          const obj = data[type] || {}
          const ks = Object.keys(obj)
          if (!ks.length) continue

          const valuesJson = ks.map(k => JSON.stringify(obj[k], BufferJSON.replacer))

          // Bulk upsert: unnest arrays to rows
          await pool.query(
            `
            insert into ${TABLE} (session_id, type, key, value)
            select
              $1::text as session_id,
              $2::text as type,
              u.key,
              u.value::jsonb
            from unnest($3::text[], $4::text[]) as u(key, value)
            on conflict (session_id, type, key)
            do update set value = excluded.value, updated_at = now()
            `,
            [sessionId, type, ks, valuesJson]
          )
        }
      } catch (e) {
        console.error('[WA][DB] keys.set failed:', e?.message || e)
        throw e
      }
    }
  }

  async function clear () {
    try {
      await pool.query(`delete from ${TABLE} where session_id = $1`, [sessionId])
    } catch (e) {
      console.error('[WA][DB] clear failed:', e?.message || e)
      throw e
    }
  }

  return {
    state: { creds, keys },
    saveCreds,
    clear
  }
}
