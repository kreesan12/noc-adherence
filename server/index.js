// server/index.js
import 'express-async-errors'
import express          from 'express'
import cors             from 'cors'
import morgan           from 'morgan'
import dotenv           from 'dotenv'
import { PrismaClient } from '@prisma/client'

import authRole         from './middleware/auth.js'      // role checker
import audit            from './middleware/audit.js'
import authRoutesFactory from './routes/auth.js'         // /login + /me (+ verifyToken)

import rosterRoutes   from './routes/roster.js'
import scheduleRoutes from './routes/schedule.js'
import volumeRoutes   from './routes/volume.js'
import reportRoutes   from './routes/reports.js'

dotenv.config()
const prisma = new PrismaClient()
const app    = express()

/* ---------- CORS / common middleware ---------- */
app.use(cors({
  origin: process.env.CLIENT_ORIGIN,      // e.g. https://kreesan12.github.io
  credentials: true
}))
app.use(express.json())
app.use(morgan('dev'))

/* ---------- Auth routes (public /login, token-protected /me) ---------- */
const authRoutes   = authRoutesFactory(prisma)
const verifyToken  = authRoutes.verifyToken     // exported helper
app.use('/api', authRoutes)

/* ---------- Protected business routes ---------- */
app.use('/api/roster',   verifyToken, authRole('supervisor'), audit(prisma), rosterRoutes(prisma))
app.use('/api/schedule', verifyToken, authRole('supervisor'),                 scheduleRoutes(prisma))
app.use('/api/volume',   verifyToken, authRole('supervisor'),                 volumeRoutes(prisma))
app.use('/api/reports',  verifyToken, authRole('supervisor'),                 reportRoutes(prisma))

/* ---------- Global error handler ---------- */
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(400).json({ error: err.message })
})

/* ---------- Start server ---------- */
const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`API • http://localhost:${PORT}`))
