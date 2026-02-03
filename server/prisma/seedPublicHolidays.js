import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

async function main() {
  // Add only a few for now, you can bulk upload later
  const rows = [
    { date: new Date("2026-01-01"), name: "New Years Day" },
    { date: new Date("2026-03-21"), name: "Human Rights Day" },
  ]

  for (const r of rows) {
    await prisma.publicHoliday.upsert({
      where: { date: r.date },
      update: { name: r.name, isActive: true },
      create: { date: r.date, name: r.name, isActive: true },
    })
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async e => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
