// server/whatsappClient.js
import dotenv from 'dotenv'
import qrcode from 'qrcode-terminal'
import pkg from 'whatsapp-web.js'

dotenv.config()

const { Client, LocalAuth } = pkg

let client
let isReady = false
let targetGroupId = null

const DEFAULT_GROUP_ID = '120363403922602776@g.us'

function getChromePath () {
  return (
    process.env.CHROME_BIN ||
    process.env.CHROME_FOR_TESTING_BIN ||
    process.env.GOOGLE_CHROME_BIN ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    null
  )
}

export function initWhatsApp () {
  if (client) return client // singleton

  const chromePath = getChromePath()
  if (chromePath) {
    console.log('[WA] Using Chrome executable:', chromePath)
  } else {
    console.warn('[WA] No Chrome executable env var found. Puppeteer will try defaults.')
  }

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: './wwebjs_auth'
    }),
    puppeteer: {
      headless: true,
      ...(chromePath ? { executablePath: chromePath } : {}),
      args: [
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

        '--disable-features=Translate,TranslateUI',

        '--disable-gpu',
        '--disable-software-rasterizer'

        // do NOT add --single-process (often worse on Heroku)
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

  await client.sendMessage(targetGroupId, text)
  console.log('WhatsApp message sent')
}

export function getStatus () {
  return {
    ready: isReady,
    groupConfigured: !!targetGroupId
  }
}
