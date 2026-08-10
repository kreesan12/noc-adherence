// server/index.js
import './utils/dayjs.js' // registers plugins for the process
import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'

import authRole from './middleware/auth.js'
import audit from './middleware/audit.js'
import authRoutesFactory, { verifyToken } from './routes/auth.js'
import prisma from './lib/prisma.js'
import { loadServerEnv } from './lib/loadEnv.js'

import rosterRoutes from './routes/roster.js'
import scheduleRoutes from './routes/schedule.js'
import volumeRoutes from './routes/volume.js'
import reportRoutes from './routes/reports.js'
import agentsRoutes from './routes/agents.js'
import attendanceRoutes from './routes/attendance.js'
import supervisorRoutes from './routes/supervisors.js'
import erlangRoutes from './routes/erlang.js'
import shiftRoutes from './routes/shifts.js'
import leaveRoutes from './routes/leave.js'
import workforceRouter from './routes/workforce.js'
import engineeringRoutes from './routes/engineering.js'
import managersRoutes from './routes/managers.js'
import userAdminRoutes from './routes/userAdmin.js'
import whatsappGroupsRoutes from './routes/whatsappGroups.js'
import whatsappWatchersRoutes from './routes/whatsappWatchers.js'
import nldsRoutes from './routes/nlds.js'
import nldServices from './routes/nldServices.js'
import nldMonitoringRoutes from './routes/nldMonitoring.js'
import nodes from './routes/nodes.js'
import nocMonitoringRoutes from './routes/nocMonitoring.js'
import slaReportingRoutes from './routes/slaReporting.js'
import stockManagementRoutes from './routes/stockManagement.js'

loadServerEnv()

// Overtime (single source of truth)
import overtimeRoutes from './routes/overtime.js'
import overtimeExportRoutes from './routes/overtimeExportRoutes.js'

// ---- Crash guards (prevents Heroku restart loops) ----
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] unhandledRejection:', err?.message || err)
})
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err?.message || err)
})

const app = express()
const webWhatsAppEnabled = process.env.ENABLE_WEB_WHATSAPP === '1'

const configuredOrigins = String(process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const defaultLocalOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]

const allowedOrigins = configuredOrigins.length > 0
  ? configuredOrigins
  : defaultLocalOrigins

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    callback(new Error(`CORS blocked for origin ${origin}`))
  },
  credentials: true
}

console.log(
  webWhatsAppEnabled
    ? '[Startup] Web WhatsApp endpoints enabled on this process'
    : '[Startup] Web process running API-only mode; WhatsApp automation is disabled here'
)

/* ---------- CORS / common middleware ---------- */
app.use(cors(corsOptions))

app.options('*', cors(corsOptions))

app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ limit: '100mb', extended: true }))
app.use(morgan('dev'))

/* ---------- Public auth routes (/api/login, /api/me) ---------- */
const authRoutes = authRoutesFactory(prisma)

/* ---------- WhatsApp endpoints ---------- */

// status check (no auth while testing)
app.get('/whatsapp/status', async (_req, res, next) => {
  if (!webWhatsAppEnabled) {
    res.json({
      enabled: false,
      ready: false,
      mode: 'web_api_only',
      message: 'WhatsApp is disabled on the web dyno to keep the API stable.'
    })
    return
  }

  try {
    const { getStatus } = await import('./whatsappClient.js')
    res.json({
      enabled: true,
      mode: 'web',
      ...getStatus()
    })
  } catch (err) {
    next(err)
  }
})

// send alert (no auth while testing)
app.post('/whatsapp/notify', async (req, res, next) => {
  if (!webWhatsAppEnabled) {
    res.status(503).json({
      ok: false,
      error: 'WhatsApp notifications are disabled on the web dyno.'
    })
    return
  }

  try {
    const { message } = req.body || {}
    const { sendSlaAlert } = await import('./whatsappClient.js')
    await sendSlaAlert(message)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

app.use('/api', authRoutes)

/* ---------- Protected business routes ---------- */
app.use(
  '/api/roster',
  verifyToken, authRole('supervisor'), audit(prisma),
  rosterRoutes(prisma)
)

app.use(
  '/api/schedule',
  verifyToken, authRole('supervisor'),
  scheduleRoutes(prisma)
)

app.use(
  '/api/volume',
  verifyToken, authRole('supervisor'),
  volumeRoutes(prisma)
)

app.use(
  '/api/reports',
  verifyToken, authRole('supervisor'),
  reportRoutes(prisma)
)

app.use(
  '/api/agents',
  verifyToken, authRole('supervisor'),
  agentsRoutes(prisma)
)

app.use(
  '/api/supervisors',
  verifyToken, authRole('supervisor'),
  supervisorRoutes(prisma)
)

/* Overtime (protected) */
app.use(
  '/api/overtime',
  verifyToken,
  overtimeRoutes(prisma)
)

/* Overtime export (protected) */
app.use(
  '/api/overtime/export',
  verifyToken,
  authRole('supervisor'),
  overtimeExportRoutes(prisma)
)

/* ---------- Attendance WITH audit middleware ---------- */
app.use(
  '/api/attendance',
  verifyToken, authRole('supervisor'), audit(prisma),
  attendanceRoutes(prisma)
)

app.use('/api/erlang', verifyToken, authRole('supervisor'), erlangRoutes(prisma))

app.use('/api/leave', leaveRoutes(prisma))
app.use('/api', workforceRouter)
app.use('/api', nldsRoutes)

app.use(
  '/api/shifts',
  verifyToken, authRole('supervisor'),
  shiftRoutes(prisma)
)

app.use('/api', nldServices)
app.use('/api', nldMonitoringRoutes)
app.use('/api', nodes)
app.use('/api/noc-monitoring', nocMonitoringRoutes())
app.use('/api/engineering', engineeringRoutes)
app.use('/api/sla-reporting', slaReportingRoutes)
app.use('/api/stock-management', stockManagementRoutes)

app.use(
  '/api/managers',
  verifyToken, authRole('admin'),
  managersRoutes(prisma)
)

app.use(
  '/api/admin/users',
  verifyToken, authRole('admin'),
  userAdminRoutes(prisma)
)

app.use(
  '/api/admin/whatsapp-watchers',
  verifyToken, authRole('admin'),
  whatsappWatchersRoutes()
)

app.use(
  '/api/admin/whatsapp-groups',
  verifyToken, authRole('admin'),
  whatsappGroupsRoutes()
)

/* ---------- Global error handler ---------- */
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(400).json({ error: err.message })
})

/* ---------- Start server ---------- */
const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`API - http://localhost:${PORT}`))
