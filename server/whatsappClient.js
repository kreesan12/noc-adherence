// server/whatsappClient.js
import dotenv from 'dotenv'
import qrcode from 'qrcode-terminal'
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
  if (!id) return null
  return id.endsWith('@g.us') ? id : `${id}@g.us`
}

export async function initWhatsApp () {
  if (sock) return sock

  targetGroupId = normalizeGroupId(process.env.WHATSAPP_GROUP_ID || DEFAULT_GROUP_ID)
  console.log('[WA] Target group JID:', targetGroupId)

  const { state, saveCreds, clear } = await usePostgresAuthState(SESSION_ID)

  const { version } = await fetchLatestBaileysVersion()
  console.log('[WA] Baileys using WA Web version:', version.join('.'))

  sock = makeWASocket({
    version,
    auth: state,
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
    const { connection, lastDisconnect, qr } = update

    // QR handling (Baileys deprecated printQRInTerminal)
    if (qr) {
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
      const code = lastDisconnect?.error?.output?.statusCode
      console.log('[WA] Connection closed. statusCode:', code)

      if (code === DisconnectReason.loggedOut) {
        console.warn('[WA] Logged out. Clearing session from Postgres. Scan QR again.')
        await clear()
      }

      if (code !== DisconnectReason.loggedOut) {
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
