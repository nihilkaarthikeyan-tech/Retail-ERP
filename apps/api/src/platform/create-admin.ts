// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 14: makes a Retail ERP admin account, or gives an existing one a new
// password, and prints the password once. Run on the server only:
//   node dist/platform/create-admin.js <email> "<name>"
// On the company server the output goes straight into a root-only file
// (see deploy/README.md); the password is never typed into a chat or a ticket.
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword, passwordProblem } from '../auth/password.js';
import { loadRootEnv, requireEnv } from '../env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** 20 letters and digits, always with both, so it passes the password rules. */
function newPassword(): string {
  for (;;) {
    const p = randomBytes(24).toString('base64url').replace(/[-_]/g, '').slice(0, 20);
    if (p.length === 20 && !passwordProblem(p, 12)) return p;
  }
}

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ').trim();
  if (!email || !email.includes('@') || !name) {
    console.error('Usage: node dist/platform/create-admin.js <email> "<name>"');
    process.exit(2);
  }
  loadRootEnv();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }) });
  try {
    const password = newPassword();
    const passwordHash = await hashPassword(password);
    const address = email.trim().toLowerCase();
    const existing = await prisma.platformAdmin.findUnique({ where: { email: address } });
    if (existing) {
      await prisma.$transaction([
        prisma.platformAdmin.update({ where: { id: existing.id }, data: { name, passwordHash, active: true, failedLoginCount: 0, lockedUntil: null } }),
        // A new password ends every open session of this admin.
        prisma.platformSession.updateMany({ where: { adminId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
    } else {
      await prisma.platformAdmin.create({ data: { email: address, name, passwordHash } });
    }
    console.log(`Retail ERP admin ${existing ? 'password reset' : 'created'}`);
    console.log(`Email:    ${address}`);
    console.log(`Password: ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
