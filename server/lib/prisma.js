// lib/prisma.js
import { PrismaClient } from '@prisma/client'

// avoid creating multiple clients in hot-reload environments
const globalForPrisma = globalThis
const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ log: ['query', 'error', 'warn'] })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
