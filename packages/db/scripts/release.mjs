#!/usr/bin/env node
/**
 * Idempotent database release step for Railway (or any managed Postgres).
 *
 * Runs as the admin/superuser (DATABASE_URL_ADMIN). Creates the RLS roles, extensions and
 * schema, applies the RLS / Timescale / vault SQL, and seeds once. Safe to run on every deploy.
 *
 * The schema DDL is generated from the Prisma DMMF (packages/db/scripts/gen-ddl.mjs) rather than
 * `prisma migrate`, so no Prisma schema-engine binary is required at release time.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPkg = join(__dirname, '..'); // packages/db

const ADMIN_URL = process.env.DATABASE_URL_ADMIN;
if (!ADMIN_URL) { console.error('DATABASE_URL_ADMIN is required'); process.exit(1); }
const RELAY_PW = process.env.RELAY_DB_PASSWORD || 'relay';

const client = new pg.Client({ connectionString: ADMIN_URL, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined });

const run = async (label, sql) => {
  process.stdout.write(`→ ${label} ... `);
  await client.query(sql);
  console.log('ok');
};
const tryRun = async (label, sql) => {
  process.stdout.write(`→ ${label} ... `);
  try { await client.query(sql); console.log('ok'); }
  catch (e) { console.log('skipped (' + e.message.split('\n')[0] + ')'); }
};

const UUID_V7 = `
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
DECLARE unix_ts_ms bytea; uuid_bytes bytea;
BEGIN
  unix_ts_ms = substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  uuid_bytes = unix_ts_ms || gen_random_bytes(10);
  uuid_bytes = set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  uuid_bytes = set_byte(uuid_bytes, 8, (b'10' || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END $$ LANGUAGE plpgsql VOLATILE;`;

const roles = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='relay') THEN CREATE ROLE relay LOGIN PASSWORD '${RELAY_PW}'; ELSE ALTER ROLE relay LOGIN PASSWORD '${RELAY_PW}'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='relay_vault') THEN CREATE ROLE relay_vault LOGIN PASSWORD '${RELAY_PW}' BYPASSRLS; ELSE ALTER ROLE relay_vault LOGIN PASSWORD '${RELAY_PW}' BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO relay, relay_vault;`;

async function main() {
  await client.connect();

  // 1. Extensions (best-effort: timescaledb / vector may be absent on some images)
  for (const ext of ['pgcrypto', 'uuid-ossp', 'pg_trgm', 'vector', 'timescaledb']) {
    await tryRun(`extension ${ext}`, `CREATE EXTENSION IF NOT EXISTS "${ext}"`);
  }
  await run('uuid_generate_v7()', UUID_V7);
  await run('roles relay / relay_vault', roles);

  // 2. Schema, then grants, then RLS/Timescale/vault — in dependency order.
  const sqlDir = join(dbPkg, 'sql');
  const readSql = (f) => readFileSync(join(sqlDir, f), 'utf8');

  await run('schema (0001)', readSql('0001_schema.sql'));

  // Enum values added after the initial release need ALTER TYPE on existing databases (fresh DBs
  // already have them from 0001's CREATE TYPE). Runs as its own autocommit statement — ADD VALUE
  // cannot run inside a transaction block on older Postgres. IF NOT EXISTS makes it idempotent.
  await tryRun('Network enum: DEVTO', `ALTER TYPE "Network" ADD VALUE IF NOT EXISTS 'DEVTO'`);
  await tryRun('Network enum: DISCORD', `ALTER TYPE "Network" ADD VALUE IF NOT EXISTS 'DISCORD'`);

  // Auto-repost ("boost"): enum type + two Post columns on existing databases (fresh DBs get them
  // from 0001). CREATE TYPE / ADD COLUMN are idempotent via IF NOT EXISTS / duplicate_object guard.
  await tryRun('AutoRepost enum', `DO $$ BEGIN CREATE TYPE "AutoRepost" AS ENUM ('OFF', 'ALWAYS', 'SMART'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
  await tryRun('Post.autoRepost', `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "autoRepost" "AutoRepost" NOT NULL DEFAULT 'OFF'::"AutoRepost"`);
  await tryRun('Post.boostedAt', `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "boostedAt" timestamp(3)`);

  await run('grants', `
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO relay, relay_vault;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO relay, relay_vault;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO relay, relay_vault;`);

  for (const f of readdirSync(sqlDir).filter((f) => f.endsWith('.sql') && f !== '0001_schema.sql').sort()) {
    if (f.includes('timescale')) await tryRun(`sql ${f}`, readSql(f)); // needs timescaledb
    else await run(`sql ${f}`, readSql(f));
  }

  // 5. Seed once (idempotent upserts)
  if (process.env.SKIP_SEED !== '1') {
    process.stdout.write('→ seed ... ');
    try {
      execSync('node --import tsx prisma/seed.ts', { cwd: dbPkg, env: { ...process.env }, stdio: 'pipe' });
      console.log('ok');
    } catch (e) { console.log('skipped (' + String(e.message).split('\n')[0] + ')'); }
  }

  await client.end();
  console.log('\nRelease complete.');
}

main().catch((e) => { console.error('Release failed:', e.message); process.exit(1); });
