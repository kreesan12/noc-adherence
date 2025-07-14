// server/index.js
import './utils/dayjs.js'          // registers plugins for the process
import 'express-async-errors'
import express          from 'express'
import cors             from 'cors'
import morgan           from 'morgan'
import dotenv           from 'dotenv'
import { PrismaClient } from '@prisma/client'

import authRole                            from './middleware/auth.js'
import audit                               from './middleware/audit.js'
import authRoutesFactory, { verifyToken }  from './routes/auth.js'

import rosterRoutes     from './routes/roster.js'
import scheduleRoutes   from './routes/schedule.js'
import volumeRoutes     from './routes/volume.js'
import reportRoutes     from './routes/reports.js'
import agentsRoutes     from './routes/agents.js'
import attendanceRoutes from './routes/attendance.js'
import supervisorRoutes from './routes/supervisors.js'
import erlangRoutes     from './routes/erlang.js'
import shiftRoutes      from './routes/shifts.js'
import leaveRoutes      from './routes/leave.js'

dotenv.config()
const prisma = new PrismaClient()
const app    = express()

/* ---------- CORS / common middleware ---------- */
app.use(cors({
  origin:      process.env.CLIENT_ORIGIN,   // e.g. https://kreesan12.github.io
  credentials: true
}))

app.options('*',
  cors({
    origin: process.env.CLIENT_ORIGIN,
    credentials: true
  })
)

app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ limit: '100mb', extended: true }))
app.use(morgan('dev'))

/* ---------- Public auth routes (/api/login, /api/me) ---------- */
const authRoutes = authRoutesFactory(prisma)
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

// Supervisors management (only accessible to supervisors)
app.use(
  '/api/supervisors',
  verifyToken, authRole('supervisor'),
  supervisorRoutes(prisma)
)

/* ---------- Mount attendance WITH audit middleware ---------- */
app.use(
  '/api/attendance',
  verifyToken, authRole('supervisor'), audit(prisma),
  attendanceRoutes(prisma)
)

app.use('/api/erlang', verifyToken, authRole('supervisor'), erlangRoutes(prisma))

app.use('/api/leave', leaveRoutes(prisma))

app.use(
  '/api/shifts',
  verifyToken, authRole('supervisor'),
  shiftRoutes(prisma)
);

/* ---------- Global error handler ---------- */
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(400).json({ error: err.message })
})

/* ---------- Start server ---------- */
const PORT = process.env.PORT || 4000
app.listen(PORT, () =>
  console.log(`API • http://localhost:${PORT}`)
)
