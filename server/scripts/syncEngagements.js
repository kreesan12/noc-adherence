// scripts/syncEngagements.js
import { PrismaClient } from '@prisma/client'
import dayjs from 'dayjs'

const prisma = new PrismaClient()

async function main() {
  const today = dayjs().startOf('day').toDate()

  // 1️⃣ Clear roles for any engagement that ended on or before today
  const ended = await prisma.engagement.findMany({
    where: { endDate: { lte: today } }
  })
  for (const e of ended) {
    await prisma.agent.update({
      where: { id: e.agentId },
      data:  { role: null }
    })
  }

  // 2️⃣ Assign roles for any engagement that started on or before today
  //    AND is still active (no endDate or ends after today)
  const active = await prisma.engagement.findMany({
    where: {
      startDate: { lte: today },
      OR: [
        { endDate: null },
        { endDate: { gt: today } }
      ]
    }
  })
  for (const e of active) {
    // look up the team name once per engagement
    const team = await prisma.team.findUnique({ where:{ id: e.teamId } })
    await prisma.agent.update({
      where: { id: e.agentId },
      data:  { role: team.name }
    })
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
