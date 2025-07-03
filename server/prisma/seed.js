import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

try {
  /* ---------- duties ---------- */
  await prisma.duty.createMany({
    data: [
      { name: 'Monitoring' },
      { name: 'Escalations' },
      { name: 'Vendor Liaison' },
      { name: 'QC' }
    ],
    skipDuplicates: true          // ← ignore rows that already exist
  });

  /* ---------- admin user ---------- */
  const pw = bcrypt.hashSync('Password!23', 10);

  await prisma.agent.upsert({
    where:  { email: 'admin@frogfoot.net' },  // ← look-up key
    update: {},                               // nothing to change if found
    create: {
      fullName:    'Admin User',
      email:       'admin@frogfoot.net',
      hash:        pw,
      role:        'admin',
      standbyFlag: false
    }
  });

  console.log('Seed done ✔');
} catch (err) {
  console.error('Seed error:', err);
} finally {
  await prisma.$disconnect();
}
