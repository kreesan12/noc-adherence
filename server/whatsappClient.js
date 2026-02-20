// server/whatsappClient.js
import dotenv from 'dotenv'
import qrcode from 'qrcode-terminal'
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import { usePostgresAuthState } from './baileysPostgresAuth.js'

dotenv.config()

let sock = null
let isReady = false
let targetGroupId = null

const DEFAULT_GROUP_ID = '120363403922602776@g.us'
const SESSION_ID = process.env.WHATSAPP_SESSION_ID || 'noc-adherence'

// Single-flight init
let initPromise = null

// Ready gate
let readyPromise = null
let readyResolve = null
let readyReject = null

// QR tracking (QR rotates quickly until scanned)
let lastQr = null
let lastQrPrintedAt = 0
const QR_PRINT_THROTTLE_MS = Number(process.env.WA_QR_PRINT_THROTTLE_MS || 25000)

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
  isReady = true
  if (readyResolve) {
    readyResolve(true)
    readyResolve = null
    readyReject = null
  }
}

function markNotReady (err) {
  isReady = false
  if (readyReject) {
    readyReject(err || new Error('WhatsApp not ready'))
    readyResolve = null
    readyReject = null
  }
}

async function waitUntilReady (timeoutMs = 60_000) {
  if (isReady) return true
  if (!readyPromise) makeReadyPromise()

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`WhatsApp not ready after ${timeoutMs}ms`)), timeoutMs)
  )

  return Promise.race([readyPromise, timeout])
}

export async function initWhatsApp ({ waitForReady = false, readyTimeoutMs = 60_000 } = {}) {
  if (sock && isReady) return sock

  if (initPromise) {
    const s = await initPromise
    if (waitForReady) await waitUntilReady(readyTimeoutMs)
    return s
  }

  initPromise = (async () => {
    targetGroupId = normalizeGroupId(process.env.WHATSAPP_GROUP_ID || DEFAULT_GROUP_ID)
    console.log('[WA] Target group JID:', targetGroupId)

    makeReadyPromise()
    isReady = false

    const { state, saveCreds, clear } = await usePostgresAuthState(SESSION_ID)

    let version
    try {
      const latest = await fetchLatestBaileysVersion()
      version = latest?.version
      if (version?.length) console.log('[WA] Baileys using WA Web version:', version.join('.'))
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
        lastQr = qr
        markNotReady()

        const now = Date.now()
        if (now - lastQrPrintedAt >= QR_PRINT_THROTTLE_MS) {
          lastQrPrintedAt = now
          console.log('[WA] QR (raw):', qr)
          console.log('[WA] Scan this QR with WhatsApp (Linked Devices):')
          qrcode.generate(qr, { small: true })
        } else {
          console.log('[WA] QR refreshed (suppressed log; still waiting for scan)')
        }
      }

      if (connection === 'open') {
        console.log('[WA] Connected to WhatsApp (Baileys)')
        lastQr = null
        markReady()
        return
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode
        console.log('[WA] Connection closed. statusCode:', statusCode)
        markNotReady(lastDisconnect?.error)

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

        console.log('[WA] Reconnecting in 5s...')
        sock = null
        await sleep(5000)

        initWhatsApp({ waitForReady: false }).catch(e => {
          console.error('[WA] Reconnect init failed:', e?.message || e)
        })
      }
    })

    return sock
  })()

  try {
    const s = await initPromise
    if (waitForReady) await waitUntilReady(readyTimeoutMs)
    return s
  } finally {
    initPromise = null
  }
}

export async function sendSlaAlert (message, opts = {}) {
  await initWhatsApp({ waitForReady: true, readyTimeoutMs: 60_000 })
  if (!sock || !isReady) throw new Error('WhatsApp client not ready')

  const override = opts?.groupId ? normalizeGroupId(opts.groupId) : null
  const jid = override || targetGroupId
  if (!jid) throw new Error('Target WhatsApp group not configured')

  const text =
    message ||
    process.env.DEFAULT_WHATSAPP_MSG ||
    'SLA breach alert. Please check.'

  await sock.sendMessage(jid, { text }, { linkPreview: false })
  console.log('[WA] Message sent to', jid)
}

export function getStatus () {
  return {
    ready: isReady,
    groupConfigured: !!targetGroupId,
    sessionId: SESSION_ID,
    hasQr: !!lastQr
  }
}