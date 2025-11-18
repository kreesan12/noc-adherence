// server/whatsappClient.js
import dotenv from 'dotenv'
import qrcode from 'qrcode-terminal'
import pkg from 'whatsapp-web.js'

dotenv.config()

const { Client, LocalAuth } = pkg

let client
let isReady = false
let targetGroupId = null

export function initWhatsApp () {
  if (client) return client // singleton

  client = new Client({
    authStrategy: new LocalAuth({
      // this folder will store the session; commit it for Heroku
      dataPath: './wwebjs_auth'
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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
      const groupName = process.env.GROUP_NAME
      console.log(`Looking for group: ${groupName}`)

      const chats = await client.getChats()
      const group = chats.find(
        chat => chat.isGroup && chat.name === groupName
      )

      if (!group) {
        console.error('Group not found. Available groups:')
        chats
          .filter(chat => chat.isGroup)
          .forEach(chat => console.log(`- ${chat.name}`))
      } else {
        targetGroupId = group.id._serialized
        console.log(`Found group: ${group.name}`)
        console.log(`Group ID: ${targetGroupId}`)
      }

      isReady = true
    } catch (err) {
      console.error('Error while fetching chats:', err)
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
