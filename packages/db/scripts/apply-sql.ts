// Applies the raw SQL files (RLS, Timescale) after Prisma migrations. Idempotent; run on every deploy.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_ADMIN }) });
const dir = join(import.meta.dirname ?? __dirname, '..', 'sql');
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(dir, f), 'utf8');
  process.stdout.write(`applying ${f}... `);
  await prisma.$executeRawUnsafe(sql);
  console.log('ok');
}
await prisma.$disconnect();
