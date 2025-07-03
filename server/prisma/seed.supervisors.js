// server/prisma/seed.supervisor.js
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
const prisma = new PrismaClient()

const pwHash = bcrypt.hashSync('Password!23', 10)

await prisma.supervisor.create({
  data: {
    fullName : 'First Supervisor',
    email    : 'supervisor@frogfoot.net',
    hash     : pwHash,
    role     : 'supervisor'
  }
})

console.log('✅  Supervisor seeded')
process.exit()
