/* server/prisma/seed.demo.js  */
import { PrismaClient } from '@prisma/client'
import bcrypt   from 'bcryptjs'
import dayjs    from 'dayjs'

const prisma = new PrismaClient()
const hash = pwd => bcrypt.hashSync(pwd, 10)

/* ------------------------------------------------------------------ */
/* demo data                                                           */
/* ------------------------------------------------------------------ */
const startOfMonth = dayjs().startOf('month')

const agentRows = [
  ['Alice Mokoena',  'alice@nocs.local',  'NOC-I'],
  ['Bongani Dlamini','bongani@nocs.local','NOC-I'],
  ['Carmen Naidoo',  'carmen@nocs.local', 'NOC-II'],
  ['Darren Pillay',  'darren@nocs.local', 'NOC-II']
]

const demoSupervisor = {
  fullName: 'Demo Supervisor',
  email:    'supervisor@frogfoot.net',
  password: 'Password!23',
  role:     'supervisor'
}

/* ------------------------------------------------------------------ */
/* reset tables                                                        */
/* ------------------------------------------------------------------ */
await prisma.auditLog.deleteMany()
await prisma.attendanceLog.deleteMany()
await prisma.shift.deleteMany()
await prisma.duty.deleteMany()
await prisma.agent.deleteMany()
await prisma.supervisor.deleteMany()       // new
await prisma.volumeForecast.deleteMany()
await prisma.volumeActual.deleteMany()

/* ------------------------------------------------------------------ */
/* duties                                                              */
/* ------------------------------------------------------------------ */
await prisma.duty.createMany({
  data: ['Monitoring', 'Escalations', 'Vendor Liaison', 'QC']
    .map(name => ({ name }))
})

/* ------------------------------------------------------------------ */
/* agents                                                              */
/* ------------------------------------------------------------------ */
const createdAgents = await Promise.all(
  agentRows.map(([name,email,role]) =>
    prisma.agent.create({
      data: {
        fullName: name,
        email,
        hash: hash('Password!23'),
        role,
        standbyFlag: false
      }
    })
  )
)

/* ------------------------------------------------------------------ */
/* supervisor (login user)                                             */
/* ------------------------------------------------------------------ */
await prisma.supervisor.create({
  data: {
    fullName: demoSupervisor.fullName,
    email:    demoSupervisor.email,
    hash:     hash(demoSupervisor.password),
    role:     demoSupervisor.role
  }
})

/* ------------------------------------------------------------------ */
/* shifts for current month                                            */
/* ------------------------------------------------------------------ */
const shiftPromises = []
for (let d = 0; d < 31; d++) {
  const day = startOfMonth.add(d, 'day')
  if (day.month() !== startOfMonth.month()) break

  createdAgents.forEach((ag, i) => {
    const start = day.add(i % 2 ? 12 : 0, 'hour')   // 00:00 or 12:00
    shiftPromises.push(
      prisma.shift.create({
        data: {
          agentId:   ag.id,
          shiftDate: day.toDate(),
          startAt:   start.toDate(),
          endAt:     start.add(12, 'hour').toDate()
        }
      })
    )
  })
}
await Promise.all(shiftPromises)

/* ------------------------------------------------------------------ */
/* volume forecast                                                     */
/* ------------------------------------------------------------------ */
const dowPattern = [25, 25, 25, 25, 30, 30, 20]   // Sun…Sat
const rows = []

for (let dow = 0; dow < 7; dow++) {
  for (let hr = 0; hr < 24; hr++) {
    const factor = hr >= 8 && hr < 17 ? 2 : 1
    rows.push({
      dayOfWeek:       dow,
      hour:            hr,
      expectedCalls:   dowPattern[dow] * factor,
      expectedTickets: Math.round(dowPattern[dow] * 0.6 * factor)
    })
  }
}
await prisma.volumeForecast.createMany({ data: rows })

console.log('🌱  Demo seed with Supervisor complete')
process.exit()
