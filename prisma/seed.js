import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
const prisma = new PrismaClient()

await prisma.duty.createMany({ data:[
  { name:'Monitoring' }, { name:'Escalations' },
  { name:'Vendor Liaison' }, { name:'QC' }
] })

const pw = bcrypt.hashSync('Password!23',10)
await prisma.agent.create({
  data:{ fullName:'Admin User', email:'admin@frogfoot.net',
         hash:pw, role:'admin', standbyFlag:false }
})

console.log('Seed done ✔')
process.exit()
