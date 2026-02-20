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

// Promise that resolves when WA becomes ready
let readyPromise = null
let readyResolve = null
let readyReject = null

function normalizeGroupId (id) {
  if (!id) return null
  return id.endsWith('@g.us') ? id : `${id}@g.us`
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function makeReadyPromise () {
  readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
}

function markReady () {
  if (!isReady) isReady = true
  if (readyResolve) {
    readyResolve(true)
    readyResolve = null
    readyReject = null
    // keep promise as resolved; next init will recreate it if needed
  }
}

function markNotReady (err) {
  isReady = false
  // don’t reject a resolved promise; only reject if we are still waiting
  if (readyReject) {
    readyReject(err || new Error('WhatsApp not ready'))
    readyResolve = null
    readyReject = null
  }
}

async function waitUntilReady (timeoutMs = 60_000) {
  if (isReady) return true
  if (!readyPromise) makeReadyPromise()

  // Timeout wrapper so we don’t hang forever if QR is required
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`WhatsApp not ready after ${timeoutMs}ms`)), timeoutMs)
  )

  return Promise.race([readyPromise, timeout])
}

export async function initWhatsApp ({ waitForReady = false, readyTimeoutMs = 60_000 } = {}) {
  if (sock && isReady) return sock

  // If a connection is already in progress, just wait for readiness if requested
  if (isConnecting) {
    if (waitForReady) await waitUntilReady(readyTimeoutMs)
    return sock
  }

  isConnecting = true

  try {
    targetGroupId = normalizeGroupId(process.env.WHATSAPP_GROUP_ID || DEFAULT_GROUP_ID)
    console.log('[WA] Target group JID:', targetGroupId)

    // Reset the ready promise each fresh init attempt
    makeReadyPromise()
    isReady = false

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
      shouldSyncHistoryMessage: () => false,
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

      if (qr) {
        markNotReady()
        console.log('[WA] Scan this QR with WhatsApp (Linked Devices):')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'open') {
        console.log('[WA] Connected to WhatsApp (Baileys)')
        markReady()
        return
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode
        console.log('[WA] Connection closed. statusCode:', statusCode)
        markNotReady(lastDisconnect?.error)

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
        await initWhatsApp({ waitForReady: false })
      }
    })

    // If caller wants strong guarantee, wait for open
    if (waitForReady) {
      await waitUntilReady(readyTimeoutMs)
    }

    return sock
  } finally {
    isConnecting = false
  }
}

export async function sendSlaAlert (message, opts = {}) {
  // Hard guarantee: ensure WA is connected before sending
  await initWhatsApp({ waitForReady: true, readyTimeoutMs: 60_000 })

  if (!sock || !isReady) throw new Error('WhatsApp client not ready')

  const fallbackGroupId = targetGroupId
  const override = opts?.groupId ? normalizeGroupId(opts.groupId) : null
  const jid = override || fallbackGroupId

  if (!jid) throw new Error('Target WhatsApp group not configured')

  const text =
    message ||
    process.env.DEFAULT_WHATSAPP_MSG ||
    'SLA breach alert. Please check.'

  await sock.sendMessage(jid, { text })
  console.log('[WA] Message sent to', jid)
}

export function getStatus () {
  return {
    ready: isReady,
    groupConfigured: !!targetGroupId,
    sessionId: SESSION_ID
  }
}