import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Driver-adapter config for the JavaScript (WASM) Schema Engine.
 *
 * With this in place, `prisma migrate` / `db push` / `migrate diff` run on the WASM schema
 * engine through the `pg` driver adapter instead of the native schema-engine binary — the same
 * engine-free path the runtime clients use (see src/index.ts). Migrations connect with the admin
 * role so RLS is bypassed while DDL is applied.
 */
export default defineConfig({
  experimental: { adapter: true },
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
  adapter: async () =>
    new PrismaPg({ connectionString: process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL }),
});
