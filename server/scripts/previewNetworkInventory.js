// Local review server, using the normal application JWT/login flow. No device runner.
import express from 'express'
import { loadServerEnv } from '../lib/loadEnv.js'
import authRoutesFactory from '../routes/auth.js'
import prisma from '../lib/prisma.js'
import networkInventoryRoutes from '../routes/networkInventory.js'
loadServerEnv()
if (process.env.NODE_ENV === 'production') throw Error('Use the main application server for production.')
const app = express(); app.use(express.json({ limit: '14mb' }))
app.use('/api', authRoutesFactory(prisma))
app.use('/api/network-inventory', networkInventoryRoutes())
app.use((error, _req, res, _next) => res.status(error.statusCode || 400).json({ error: error.message }))
app.listen(4107, '127.0.0.1', () => console.log('Inventory review API: http://127.0.0.1:4107'))
