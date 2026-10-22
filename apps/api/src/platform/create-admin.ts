// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 14: makes a Retail ERP admin account, or gives an existing one a new
// password, and prints the password once. Run on the server only:
//   node dist/platform/create-admin.js <email> "<name>"
// On the company server the output goes straight into a root-only file
// (see deploy/README.md); the password is never typed into a chat or a ticket.
import { randomInt } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword, passwordProblem } from '../auth/password.js';
import { loadRootEnv, requireEnv } from '../env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** Plain words that are easy to read out and type; three of them with a number make the password. */
const WORDS = [
  'mango', 'temple', 'river', 'silver', 'lotus', 'cotton', 'copper', 'garden', 'monsoon', 'saffron',
  'jasmine', 'coral', 'marble', 'bamboo', 'ginger', 'pepper', 'tiger', 'falcon', 'parrot', 'peacock',
  'harbour', 'lantern', 'meadow', 'orchid', 'pebble', 'planet', 'rocket', 'sunset', 'thunder', 'velvet',
  'walnut', 'window', 'yellow', 'zebra', 'anchor', 'basket', 'candle', 'dragon', 'engine', 'forest',
  'guitar', 'hammer', 'island', 'jungle', 'kettle', 'ladder', 'magnet', 'needle', 'orange', 'pencil',
  'quartz', 'rabbit', 'saddle', 'teapot', 'umbrella', 'violet', 'whistle', 'cobalt', 'sparrow', 'summit',
];

/** Easy to read and type, e.g. "Mango-Temple-River-4821"; letters and digits, so it passes the password rules. */
function newPassword(): string {
  for (;;) {
    const words = Array.from({ length: 3 }, () => WORDS[randomInt(WORDS.length)]).map((w) => w[0].toUpperCase() + w.slice(1));
    const p = `${words.join('-')}-${randomInt(1000, 10_000)}`;
    if (!passwordProblem(p, 12)) return p;
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
