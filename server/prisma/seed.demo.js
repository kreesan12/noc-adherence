import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

// ------- helpers
const hash = pwd => bcrypt.hashSync(pwd, 10);
const startOfMonth = dayjs().startOf('month');
const roles = ['NOC-I', 'NOC-II', 'Supervisor'];

const agents = [
  ['Alice Mokoena',  'alice@nocs.local',  'NOC-I'],
  ['Bongani Dlamini','bongani@nocs.local','NOC-I'],
  ['Carmen Naidoo',  'carmen@nocs.local', 'NOC-II'],
  ['Darren Pillay',  'darren@nocs.local', 'NOC-II'],
  ['Esmé Jacobs',    'esme@nocs.local',   'Supervisor']
];

async function main () {
  // 1️⃣  clear previous demo data (optional)
  await prisma.auditLog.deleteMany();
  await prisma.attendanceLog.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.duty.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.volumeForecast.deleteMany();
  await prisma.volumeActual.deleteMany();

  // 2️⃣  duties
  await prisma.duty.createMany({
    data: ['Monitoring', 'Escalations', 'Vendor Liaison', 'QC']
      .map(name => ({ name }))
  });

  // 3️⃣  agents
  const createdAgents = await Promise.all(
    agents.map(([name,email,role],i)=>prisma.agent.create({
      data:{
        fullName: name,
        email,
        hash: hash('Password!23'),
        role,
        standbyFlag: i===4  // make Esmé on standby
      }
    }))
  );

  // 4️⃣  shifts for the entire current month (24 × 7 coverage)
  const shiftPromises = [];
  for (let d = 0; d < 31; d++) {
    const day = startOfMonth.add(d,'day');
    if (day.month() !== startOfMonth.month()) break; // stop after the month
    createdAgents.forEach((ag,i)=>{
      // simple pattern: two 12-h shifts, staggered
      const start = day.add(i%2 ? 12 : 0,'hour'); // 00:00 or 12:00
      shiftPromises.push(prisma.shift.create({
        data:{
          agentId: ag.id,
          shiftDate: day.toDate(),
          startAt:  start.toDate(),
          endAt:    start.add(12,'hour').toDate()
        }
      }));
    });
  }
  await Promise.all(shiftPromises);

  // 5️⃣  volume forecast – typical Mon-Sun pattern
  const dowPattern = [ // calls, tickets per hour base load
    25, 25, 25, 25, 30, 30, 20 // Sun…Sat
  ];
  const volRows = [];
  for (let dow=0; dow<7; dow++){
    for (let hr=0; hr<24; hr++){
      const factor = hr>=8 && hr<17 ? 2 : 1;        // daytime busier
      volRows.push({
        dayOfWeek: dow,
        hour: hr,
        expectedCalls:   dowPattern[dow]*factor,
        expectedTickets: Math.round(dowPattern[dow]*0.6*factor)
      });
    }
  }
  await prisma.volumeForecast.createMany({ data: volRows });

  console.log('🌱  Demo seed complete');
}

main().finally(()=>prisma.$disconnect());
