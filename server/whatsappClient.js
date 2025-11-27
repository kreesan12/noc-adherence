// server/whatsappClient.js
import dotenv from 'dotenv'
import qrcode from 'qrcode-terminal'
import pkg from 'whatsapp-web.js'

dotenv.config()

const { Client, LocalAuth } = pkg

let client
let isReady = false
let targetGroupId = null

// Default to your known group ID, but allow override via env
const DEFAULT_GROUP_ID = '120363403922602776@g.us'

export function initWhatsApp () {
  if (client) return client // singleton

  client = new Client({
    authStrategy: new LocalAuth({
      // this folder will store the session; commit it for Heroku
      dataPath: './wwebjs_auth'
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-features=Translate',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-zygote',
        '--single-process',
        '--mute-audio'
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
  })

  client.on('ready', async () => {
    console.log('WhatsApp client is ready')
    try {
      // Prefer env var, fall back to the hard-coded ID you found
      targetGroupId = process.env.WHATSAPP_GROUP_ID || DEFAULT_GROUP_ID

      if (!targetGroupId) {
        console.error('No WhatsApp group ID configured')
      } else {
        console.log(`Using WhatsApp group ID: ${targetGroupId}`)
      }

      isReady = true
    } catch (err) {
      console.error('Error during WhatsApp ready handler:', err)
    }
  })

  client.on('disconnected', reason => {
    console.log('WhatsApp client disconnected:', reason)
    isReady = false
  })

  client.initialize()
  return client
}

export async function sendSlaAlert (message) {
  if (!client || !isReady) {
    throw new Error('WhatsApp client not ready')
  }
  if (!targetGroupId) {
    throw new Error('Target WhatsApp group not configured')
  }

  const text =
    message ||
    process.env.DEFAULT_WHATSAPP_MSG ||
    'SLA breach alert. Please check.'

  await client.sendMessage(targetGroupId, text)
  console.log('WhatsApp message sent:', text)
}

export function getStatus () {
  return {
    ready: isReady,
    groupConfigured: !!targetGroupId
  }
}
