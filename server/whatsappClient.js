// server/whatsappClient.js
import dotenv from 'dotenv'
import qrcode from 'qrcode-terminal'
import pkg from 'whatsapp-web.js'
import { execSync } from 'node:child_process'

dotenv.config()

const { Client, LocalAuth } = pkg

let client
let isReady = false
let targetGroupId = null

// Default to your known group ID, but allow override via env
const DEFAULT_GROUP_ID = '120363403922602776@g.us'

// --- Internal send queue to prevent burst memory spikes ---
const sendQueue = []
let sending = false

async function drainQueue () {
  if (sending) return
  sending = true

  try {
    while (sendQueue.length) {
      const job = sendQueue.shift()
      try {
        await job()
      } catch (e) {
        console.error('[WA] Send job failed:', e?.message || e)
      }

      // small delay between sends helps keep Chrome stable
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  } finally {
    sending = false
  }
}

function resolveChromePath () {
  // Try common env vars first
  const envPath =
    process.env.CHROME_BIN ||
    process.env.GOOGLE_CHROME_BIN ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    null

  if (envPath) return envPath

  // Chrome-for-testing buildpack puts "chrome" on PATH. Try "which chrome".
  try {
    const p = execSync('which chrome', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim()
    return p || null
  } catch {
    return null
  }
}

export function initWhatsApp () {
  if (client) return client // singleton

  const chromePath = resolveChromePath()
  if (chromePath) {
    console.log('[WA] Chrome executable:', chromePath)
  } else {
    console.warn('[WA] Could not resolve Chrome path. Puppeteer will try defaults (likely to fail on Heroku).')
  }

  client = new Client({
    authStrategy: new LocalAuth({
      // NOTE: on Heroku, filesystem is ephemeral.
      // LocalAuth will persist within a running dyno, but resets on restart unless you use a persistent store.
      dataPath: './wwebjs_auth'
    }),
    puppeteer: {
      headless: true,
      ...(chromePath ? { executablePath: chromePath } : {}),
      args: [
        '--headless=new',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',

        '--no-first-run',
        '--no-default-browser-check',
        '--mute-audio',

        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-breakpad',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--metrics-recording-only',
        '--safebrowsing-disable-auto-update',

        '--disable-gpu',
        '--disable-software-rasterizer'
      ]
    }
  })

  client.on('qr', qr => {
    console.log('Scan this QR code with WhatsApp on your phone:')
    qrcode.generate(qr, { small: true })
  })

  client.on('authenticated', () => {
    console.log('WhatsApp authenticated')
  })

  client.on('auth_failure', msg => {
    console.error('WhatsApp auth failure:', msg)
    isReady = false
  })

  client.on('ready', async () => {
    console.log('WhatsApp client is ready')

    targetGroupId = process.env.WHATSAPP_GROUP_ID || DEFAULT_GROUP_ID
    if (!targetGroupId) {
      console.error('No WhatsApp group ID configured')
      isReady = false
      return
    }

    console.log(`Using WhatsApp group ID: ${targetGroupId}`)
    isReady = true
  })

  client.on('disconnected', reason => {
    console.log('WhatsApp client disconnected:', reason)
    isReady = false
  })

  client.initialize()
  return client
}

export async function sendSlaAlert (message) {
  if (!client || !isReady) throw new Error('WhatsApp client not ready')
  if (!targetGroupId) throw new Error('Target WhatsApp group not configured')

  const text =
    message ||
    process.env.DEFAULT_WHATSAPP_MSG ||
    'SLA breach alert. Please check.'

  // Queue the send so bursts don’t spike Chrome
  return new Promise((resolve, reject) => {
    sendQueue.push(async () => {
      try {
        await client.sendMessage(targetGroupId, text)
        console.log('[WA] Message sent')
        resolve()
      } catch (e) {
        reject(e)
      }
    })

    drainQueue()
  })
}

export function getStatus () {
  return {
    ready: isReady,
    groupConfigured: !!targetGroupId
  }
}
