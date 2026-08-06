import dotenv from 'dotenv'

dotenv.config()
dotenv.config({ path: '.env.local', override: true })

const { initWhatsApp, sendSlaAlert } = await import('../whatsappClient.js')
const { startNldOutageWatcher } = await import('../nldOutageWatcher.js')
const { startVipTicketWatcher } = await import('../vipTicketWatcher.js')

process.on('unhandledRejection', (err) => {
  console.error('[AUTOMATION][FATAL] unhandledRejection:', err?.message || err)
})

process.on('uncaughtException', (err) => {
  console.error('[AUTOMATION][FATAL] uncaughtException:', err?.message || err)
})

console.log('[AUTOMATION] Starting WhatsApp automation process')

try {
  await initWhatsApp({ waitForReady: false })
  console.log('[AUTOMATION] WhatsApp init complete, starting watchers')
} catch (err) {
  console.error('[AUTOMATION] WhatsApp init failed; starting watchers anyway:', err?.message || err)
}

try {
  startNldOutageWatcher(sendSlaAlert)
} catch (err) {
  console.error('[AUTOMATION] Failed to start NLD watcher:', err?.message || err)
}

try {
  startVipTicketWatcher(sendSlaAlert)
} catch (err) {
  console.error('[AUTOMATION] Failed to start VIP watcher:', err?.message || err)
}
