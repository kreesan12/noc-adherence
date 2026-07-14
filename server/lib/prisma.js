import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis

function buildPrismaClientOptions() {
  const options = {
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['query', 'error', 'warn']
  }

  const baseUrl = process.env.DATABASE_URL
  if (!baseUrl) {
    return options
  }

  const url = new URL(baseUrl)

  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set(
      'connection_limit',
      process.env.PRISMA_CONNECTION_LIMIT || '5'
    )
  }

  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set(
      'pool_timeout',
      process.env.PRISMA_POOL_TIMEOUT || '20'
    )
  }

  options.datasources = {
    db: {
      url: url.toString()
    }
  }

  return options
}

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient(buildPrismaClientOptions())

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
