import './utils/dayjs.js'
import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'

import authRole from './middleware/auth.js'
import audit from './middleware/audit.js'
import authRoutesFactory, { verifyToken } from './routes/auth.js'
import prisma from './lib/prisma.js'

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
import overtimeRoutes from './routes/overtime.js'
import overtimeExportRoutes from './routes/overtimeExportRoutes.js'
import publicRatingGatewayRoutes from './routes/publicRatingGateway.js'
import {
  createPrismaPublicRatingGatewayRepo,
  sanitizePathForLogs
} from './lib/publicRatingGateway.js'

function buildCorsOptions() {
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

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`CORS blocked for origin ${origin}`))
    },
    credentials: true
  }
}

function createAccessLogFormat() {
  return (tokens, req, res) => {
    const method = tokens.method(req, res)
    const status = tokens.status(req, res)
    if (!method || !status) return null

    const path = sanitizePathForLogs(req.originalUrl || req.url)
    const responseTime = tokens['response-time'](req, res)
    const length = tokens.res(req, res, 'content-length') || '0'
    return `${method} ${path} ${status} ${length}b ${responseTime} ms`
  }
}

function registerCrashGuards() {
  if (process.__nocCrashGuardsRegistered) return

  process.on('unhandledRejection', (err) => {
    console.error('[FATAL] unhandledRejection:', err?.message || err)
  })

  process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err?.message || err)
  })

  process.__nocCrashGuardsRegistered = true
}

function addWhatsAppStatusRoute(app, webWhatsAppEnabled) {
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
}

function addWhatsAppNotifyRoute(app, webWhatsAppEnabled) {
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
}

function mountBusinessRoutes(app, prismaClient) {
  const authRoutes = authRoutesFactory(prismaClient)
  app.use('/api', authRoutes)

  app.use(
    '/api/roster',
    verifyToken, authRole('supervisor'), audit(prismaClient),
    rosterRoutes(prismaClient)
  )

  app.use(
    '/api/schedule',
    verifyToken, authRole('supervisor'),
    scheduleRoutes(prismaClient)
  )

  app.use(
    '/api/volume',
    verifyToken, authRole('supervisor'),
    volumeRoutes(prismaClient)
  )

  app.use(
    '/api/reports',
    verifyToken, authRole('supervisor'),
    reportRoutes(prismaClient)
  )

  app.use(
    '/api/agents',
    verifyToken, authRole('supervisor'),
    agentsRoutes(prismaClient)
  )

  app.use(
    '/api/supervisors',
    verifyToken, authRole('supervisor'),
    supervisorRoutes(prismaClient)
  )

  app.use(
    '/api/overtime',
    verifyToken,
    overtimeRoutes(prismaClient)
  )

  app.use(
    '/api/overtime/export',
    verifyToken,
    authRole('supervisor'),
    overtimeExportRoutes(prismaClient)
  )

  app.use(
    '/api/attendance',
    verifyToken, authRole('supervisor'), audit(prismaClient),
    attendanceRoutes(prismaClient)
  )

  app.use('/api/erlang', verifyToken, authRole('supervisor'), erlangRoutes(prismaClient))
  app.use('/api/leave', leaveRoutes(prismaClient))
  app.use('/api', workforceRouter)
  app.use('/api', nldsRoutes)

  app.use(
    '/api/shifts',
    verifyToken, authRole('supervisor'),
    shiftRoutes(prismaClient)
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
    managersRoutes(prismaClient)
  )

  app.use(
    '/api/admin/users',
    verifyToken, authRole('admin'),
    userAdminRoutes(prismaClient)
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
}

export function createApp({
  prismaClient = prisma,
  includeBusinessRoutes = true,
  publicRatingGatewayRepo,
  publicRatingGatewayToken = process.env.SCHEDULING_PUBLIC_RATING_GATEWAY_TOKEN
} = {}) {
  registerCrashGuards()

  const app = express()
  const webWhatsAppEnabled = process.env.ENABLE_WEB_WHATSAPP === '1'
  const corsOptions = buildCorsOptions()
  const ratingGatewayRepo = publicRatingGatewayRepo ?? createPrismaPublicRatingGatewayRepo(prismaClient)

  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  console.log(
    webWhatsAppEnabled
      ? '[Startup] Web WhatsApp endpoints enabled on this process'
      : '[Startup] Web process running API-only mode; WhatsApp automation is disabled here'
  )

  app.use(cors(corsOptions))
  app.options('*', cors(corsOptions))
  app.use(express.json({ limit: '100mb' }))
  app.use(express.urlencoded({ limit: '100mb', extended: true }))
  app.use(morgan(createAccessLogFormat()))

  addWhatsAppStatusRoute(app, webWhatsAppEnabled)
  addWhatsAppNotifyRoute(app, webWhatsAppEnabled)

  app.use(publicRatingGatewayRoutes({
    repo: ratingGatewayRepo,
    bearerToken: publicRatingGatewayToken
  }))

  if (includeBusinessRoutes) {
    mountBusinessRoutes(app, prismaClient)
  }

  app.use((err, req, res, _next) => {
    const statusCode = Number(err?.statusCode) || 400
    const logPath = sanitizePathForLogs(req.originalUrl || req.url)
    console.error('[API ERROR]', logPath, err?.stack || err?.message || err)

    if (logPath.startsWith('/rating/') || logPath.startsWith('/api/integration/')) {
      res.status(statusCode).json({ error: statusCode >= 500 ? 'request failed' : 'invalid request' })
      return
    }

    res.status(statusCode).json({ error: err?.message || 'request failed' })
  })

  return app
}
