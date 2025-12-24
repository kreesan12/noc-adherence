// server/whatsappClient.js
import dotenv from 'dotenv'
import qrcode from 'qrcode-terminal'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import { usePostgresAuthState } from './baileysPostgresAuth.js'

dotenv.config()

let sock = null
let isReady = false
let targetGroupId = null

const DEFAULT_GROUP_ID = '120363403922602776@g.us'
const SESSION_ID = process.env.WHATSAPP_SESSION_ID || 'noc-adherence'

// Prevent multiple simultaneous reconnect loops
let isConnecting = false

function normalizeGroupId (id) {
  if (!id) return null
  return id.endsWith('@g.us') ? id : `${id}@g.us`
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function initWhatsApp () {
  if (sock) return sock
  if (isConnecting) return sock
  isConnecting = true

  try {
    targetGroupId = normalizeGroupId(process.env.WHATSAPP_GROUP_ID || DEFAULT_GROUP_ID)
    console.log('[WA] Target group JID:', targetGroupId)

    // Auth state persisted in Postgres
    const { state, saveCreds, clear } = await usePostgresAuthState(SESSION_ID)

    // Baileys version
    let version
    try {
      const latest = await fetchLatestBaileysVersion()
      version = latest?.version
      if (version?.length) {
        console.log('[WA] Baileys using WA Web version:', version.join('.'))
      }
    } catch (e) {
      console.warn('[WA] fetchLatestBaileysVersion failed, continuing with defaults:', e?.message || e)
    }

    sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 60_000,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000
    })

    // Persist creds to Postgres whenever updated
    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds()
      } catch (e) {
        console.error('[WA] Failed to persist creds:', e?.message || e)
      }
    })

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      // QR handling (Baileys no longer prints automatically)
      if (qr) {
        isReady = false
        console.log('[WA] Scan this QR with WhatsApp (Linked Devices):')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'open') {
        isReady = true
        console.log('[WA] Connected to WhatsApp (Baileys)')
        return
      }

      if (connection === 'close') {
        isReady = false

        const statusCode = lastDisconnect?.error?.output?.statusCode
        console.log('[WA] Connection closed. statusCode:', statusCode)

        // Logged out: nuke session so next boot forces fresh QR
        if (statusCode === DisconnectReason.loggedOut) {
          console.warn('[WA] Logged out. Clearing session from Postgres. Scan QR again.')
          try {
            await clear()
          } catch (e) {
            console.error('[WA] Failed clearing session:', e?.message || e)
          }
          sock = null
          return
        }

        // Otherwise: backoff + reconnect
        console.log('[WA] Reconnecting in 5s...')
        sock = null
        await sleep(5000)
        await initWhatsApp()
      }
    })

    return sock
  } finally {
    isConnecting = false
  }
}

export async function sendSlaAlert (message) {
  if (!sock || !isReady) throw new Error('WhatsApp client not ready')
  if (!targetGroupId) throw new Error('Target WhatsApp group not configured')

  const text =
    message ||
    process.env.DEFAULT_WHATSAPP_MSG ||
    'SLA breach alert. Please check.'

  await sock.sendMessage(targetGroupId, { text })
  console.log('[WA] Message sent')
}

export function getStatus () {
  return {
    ready: isReady,
    groupConfigured: !!targetGroupId,
    sessionId: SESSION_ID
  }
}
