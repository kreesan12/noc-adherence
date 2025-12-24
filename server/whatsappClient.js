// server/whatsappClient.js
import dotenv from 'dotenv'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import { usePostgresAuthState } from './baileysPostgresAuth.js'

dotenv.config()

let sock
let isReady = false
let targetGroupId = null

const DEFAULT_GROUP_ID = '120363403922602776@g.us'
const SESSION_ID = process.env.WHATSAPP_SESSION_ID || 'noc-adherence'

function normalizeGroupId (id) {
  // Baileys expects the WhatsApp JID.
  // Groups end with @g.us
  if (!id) return null
  if (id.endsWith('@g.us')) return id
  return `${id}@g.us`
}

export async function initWhatsApp () {
  if (sock) return sock // singleton

  targetGroupId = normalizeGroupId(process.env.WHATSAPP_GROUP_ID || DEFAULT_GROUP_ID)
  if (!targetGroupId) {
    console.warn('[WA] No WHATSAPP_GROUP_ID set (and no DEFAULT_GROUP_ID). Sending will fail until configured.')
  } else {
    console.log('[WA] Target group JID:', targetGroupId)
  }

  const { state, saveCreds, clear } = await usePostgresAuthState(SESSION_ID)

  // pull latest compatible WA Web version
  const { version } = await fetchLatestBaileysVersion()
  console.log('[WA] Baileys using WA Web version:', version.join('.'))

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true, // shows QR in Heroku logs for first-time login
    markOnlineOnConnect: false,
    syncFullHistory: false
  })

  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds()
    } catch (e) {
      console.error('[WA] Failed to persist creds:', e?.message || e)
    }
  })

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update

    if (connection === 'open') {
      isReady = true
      console.log('[WA] Connected to WhatsApp (Baileys)')
      return
    }

    if (connection === 'close') {
      isReady = false
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const reason = statusCode

      console.log('[WA] Connection closed. statusCode:', statusCode)

      // If logged out, clear DB session and require re-scan.
      if (reason === DisconnectReason.loggedOut) {
        console.warn('[WA] Logged out. Clearing session from Postgres. You will need to scan QR again.')
        await clear()
      }

      // Reconnect unless logged out
      if (reason !== DisconnectReason.loggedOut) {
        console.log('[WA] Reconnecting...')
        sock = null
        await initWhatsApp()
      }
    }
  })

  return sock
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
    groupConfigured: !!targetGroupId
  }
}
