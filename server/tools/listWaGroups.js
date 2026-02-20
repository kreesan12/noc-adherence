// server/tools/listWaGroups.js
import 'dotenv/config'
import { initWhatsApp } from '../whatsappClient.js'

async function main () {
  const sock = await initWhatsApp()

  // Give Baileys a moment to finish initial sync
  await new Promise(resolve => setTimeout(resolve, 3000))

  const groups = await sock.groupFetchAllParticipating()
  const rows = Object.values(groups)
    .map(g => ({
      id: g.id,
      subject: g.subject,
      participants: g.participants?.length || 0
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject))

  console.table(rows)

  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})