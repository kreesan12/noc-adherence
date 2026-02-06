// server/scripts/seedRocMnt.js
import dotenv from 'dotenv'
dotenv.config()

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const techs = [
    {
      name: 'Reuben M',
      phone: '0820000001',
      region: 'CPT',
      area: 'CBD',
      vehicleRegistration: 'CA 123 456',
      vehicleType: 'Bakkie',
      homeAddress: 'Gardens, Cape Town',
      homeLat: -33.9376,
      homeLng: 18.4110,
      isActive: true
    },
    {
      name: 'Lutendo T',
      phone: '0820000002',
      region: 'CPT',
      area: 'Northern Suburbs',
      vehicleRegistration: 'CA 654 321',
      vehicleType: 'Van',
      homeAddress: 'Plattekloof, Cape Town',
      homeLat: -33.8658,
      homeLng: 18.5453,
      isActive: true
    }
  ]

  for (const t of techs) {
    await prisma.technician.upsert({
      where: { phone: t.phone },
      update: t,
      create: t
    })
  }

  const tickets = [
    {
      externalRef: 'TEST-1001',
      customerName: 'Acme Foods',
      customerPhone: '0215550001',
      address: 'Kloof Street, Gardens, Cape Town',
      lat: -33.9379,
      lng: 18.4118,
      notes: 'Client reports no light on ONT'
    },
    {
      externalRef: 'TEST-1002',
      customerName: 'Skyline Offices',
      customerPhone: '0215550002',
      address: 'Sea Point, Cape Town',
      lat: -33.9189,
      lng: 18.3886,
      notes: 'Intermittent drops'
    },
    {
      externalRef: 'TEST-1003',
      customerName: 'Riverside Retail',
      customerPhone: '0215550003',
      address: 'Bellville, Cape Town',
      lat: -33.9000,
      lng: 18.6300,
      notes: 'Down since morning'
    }
  ]

  for (const tk of tickets) {
    await prisma.ticket.upsert({
      where: { externalRef: tk.externalRef },
      update: tk,
      create: tk
    })
  }

  console.log('Seeded technicians and tickets')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
