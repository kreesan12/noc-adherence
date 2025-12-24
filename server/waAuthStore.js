import { BufferJSON } from '@whiskeysockets/baileys'
import { prisma } from './prismaClient.js'

export async function loadAuthState () {
  const row = await prisma.whatsapp_auth.findUnique({
    where: { id: 'default' }
  })

  if (!row) {
    return null
  }

  return JSON.parse(JSON.stringify(row.data), BufferJSON.reviver)
}

export async function saveAuthState (state) {
  const data = JSON.parse(JSON.stringify(state, BufferJSON.replacer))

  await prisma.whatsapp_auth.upsert({
    where: { id: 'default' },
    update: { data },
    create: { id: 'default', data }
  })
}
