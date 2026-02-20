import 'dotenv/config'
import { initWhatsApp } from '../whatsappClient.js'

const q = process.argv.slice(2).join(' ').trim()
if (!q) {
  console.log('Usage: node server/tools/findWaGroup.js "part of group name"')
  process.exit(1)
}

async function main () {
  const sock = await initWhatsApp()
  await new Promise(r => setTimeout(r, 3000))

  const groups = await sock.groupFetchAllParticipating()
  const rows = Object.values(groups)
    .map(g => ({ name: g.subject || '', id: g.id, participants: g.participants?.length || 0 }))
    .filter(x => x.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (!rows.length) {
    console.log('No groups matched:', q)
    process.exit(2)
  }

  console.table(rows)
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})