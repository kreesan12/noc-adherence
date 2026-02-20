import 'dotenv/config'
import { initWhatsApp } from '../whatsappClient.js'

const q = (process.argv.slice(2).join(' ') || '').trim()
if (!q) {
  console.log('Usage: node server/tools/findWaGroup.js "part of group name"')
  process.exit(1)
}

async function main () {
  const sock = await initWhatsApp()
  await new Promise(r => setTimeout(r, 3000))

  const groups = await sock.groupFetchAllParticipating()
  const all = Object.values(groups).map(g => ({
    name: g.subject || '',
    id: g.id,
    participants: g.participants?.length || 0
  }))

  console.log('[DEBUG] Total groups visible to Baileys:', all.length)
  console.log('[DEBUG] Search term:', JSON.stringify(q))

  const matches = all
    .filter(x => x.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  console.log('[DEBUG] Matches:', matches.length)
  console.table(matches)

  process.exit(matches.length ? 0 : 2)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})