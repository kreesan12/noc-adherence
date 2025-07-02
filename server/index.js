import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

import auth from './middleware/auth.js'
import audit from './middleware/audit.js'
import authRoutes from './routes/auth.js'
import rosterRoutes from './routes/roster.js'
import scheduleRoutes from './routes/schedule.js'
import volumeRoutes from './routes/volume.js'
import reportRoutes from './routes/reports.js'

dotenv.config()
const prisma = new PrismaClient()
const app = express()

app.use(cors({ origin: process.env.CLIENT_ORIGIN }))
app.use(express.json())
app.use(morgan('dev'))

// public
app.use('/api', authRoutes(prisma))

// protected
app.use('/api/roster',   auth('supervisor'), audit(prisma), rosterRoutes(prisma))
app.use('/api/schedule', auth('supervisor'), scheduleRoutes(prisma))
app.use('/api/volume',   auth('supervisor'), volumeRoutes(prisma))
app.use('/api/reports',  auth('supervisor'), reportRoutes(prisma))

app.use((err,_req,res,_next)=>res.status(400).json({ error:err.message }))

app.listen(process.env.PORT||4000,
  ()=>console.log('API • http://localhost:'+ (process.env.PORT||4000)))
