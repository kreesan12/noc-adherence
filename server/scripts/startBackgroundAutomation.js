import { loadServerEnv } from '../lib/loadEnv.js'

loadServerEnv()

const { initWhatsApp, sendSlaAlert } = await import('../whatsappClient.js')
const { startBackhaulWatcher } = await import('../backhaulWatcher.js')
const { startWhatsAppGroupDirectorySync } = await import('../groupDirectorySync.js')
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
  startBackhaulWatcher(sendSlaAlert)
} catch (err) {
  console.error('[AUTOMATION] Failed to start backhaul watcher:', err?.message || err)
}

try {
  startVipTicketWatcher(sendSlaAlert)
} catch (err) {
  console.error('[AUTOMATION] Failed to start VIP watcher:', err?.message || err)
}

try {
  startWhatsAppGroupDirectorySync()
} catch (err) {
  console.error('[AUTOMATION] Failed to start WhatsApp group directory sync:', err?.message || err)
}
