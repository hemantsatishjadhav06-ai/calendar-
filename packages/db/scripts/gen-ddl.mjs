// Deterministic DDL generator from the Prisma DMMF.
// Used only to create the schema in environments where the Prisma schema-engine
// binary cannot be downloaded (egress-restricted sandbox). On Railway/production the
// normal `prisma migrate deploy` path is used instead.
import { Prisma } from '@prisma/client';

const dm = Prisma.dmmf.datamodel;
const q = (s) => `"${s}"`;
const colName = (f) => q(f.dbName ?? f.name);
const tableName = (m) => q(m.dbName ?? m.name);

function pgType(f) {
  if (f.kind === 'enum') return q(f.type) + (f.isList ? '[]' : '');
  const nt = f.nativeType ? f.nativeType[0] : null;
  const args = f.nativeType && f.nativeType[1] && f.nativeType[1].length ? `(${f.nativeType[1].join(',')})` : '';
  let base;
  switch (f.type) {
    case 'String': base = nt === 'Uuid' ? 'uuid' : nt === 'VarChar' ? `varchar${args}` : nt === 'Char' ? `char${args}` : nt === 'Citext' ? 'citext' : 'text'; break;
    case 'Boolean': base = 'boolean'; break;
    case 'Int': base = nt === 'SmallInt' ? 'smallint' : 'integer'; break;
    case 'BigInt': base = 'bigint'; break;
    case 'Float': base = 'double precision'; break;
    case 'Decimal': base = nt === 'Decimal' && args ? `decimal${args}` : 'decimal(65,30)'; break;
    case 'DateTime': base = nt === 'Timestamptz' ? `timestamptz${args}` : nt === 'Date' ? 'date' : nt === 'Time' ? `time${args}` : `timestamp${args || '(3)'}`; break;
    case 'Json': base = 'jsonb'; break;
    case 'Bytes': base = 'bytea'; break;
    default: base = 'text';
  }
  return base + (f.isList ? '[]' : '');
}

function pgDefault(f) {
  const d = f.default;
  if (d === undefined || d === null) {
    if (f.isUpdatedAt) return 'now()';
    if (f.isList && f.isRequired) return "'{}'";
    return null;
  }
  if (typeof d === 'object' && !Array.isArray(d) && d.name) {
    if (d.name === 'dbgenerated') return d.args[0];
    if (d.name === 'now') return 'now()';
    if (d.name === 'uuid') return 'gen_random_uuid()';
    if (d.name === 'autoincrement') return null; // handled via serial
    return null; // cuid/nanoid etc: client provides
  }
  if (f.kind === 'enum') return `'${d}'::${q(f.type)}`;
  if (f.isList && Array.isArray(d)) return `'{${d.join(',')}}'`;
  if (typeof d === 'string') return `'${d.replace(/'/g, "''")}'`;
  if (typeof d === 'boolean') return d ? 'true' : 'false';
  return String(d);
}

// IDEMPOTENT=1 → non-destructive (CREATE IF NOT EXISTS, no DROP): safe to re-run on every deploy.
const IDEMPOTENT = process.env.IDEMPOTENT === '1';
const out = [];
out.push('-- Generated from Prisma DMMF.' + (IDEMPOTENT ? ' Idempotent (no DROP).' : ''));

// enums
for (const e of dm.enums) {
  const vals = e.values.map((v) => `'${v.dbName ?? v.name}'`).join(', ');
  if (IDEMPOTENT) {
    out.push(`DO $$ BEGIN CREATE TYPE ${q(e.name)} AS ENUM (${vals}); EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  } else {
    out.push(`DROP TYPE IF EXISTS ${q(e.name)} CASCADE;`);
    out.push(`CREATE TYPE ${q(e.name)} AS ENUM (${vals});`);
  }
}

// tables (columns + pk + unique; FKs added afterwards)
const fks = [];
for (const m of dm.models) {
  const cols = [];
  for (const f of m.fields) {
    if (f.kind === 'object') {
      // relation field: emit FK from the owning side (has relationFromFields)
      if (f.relationFromFields && f.relationFromFields.length) {
        const from = f.relationFromFields.map(q).join(', ');
        const to = f.relationToFields.map(q).join(', ');
        const onDel = (f.relationOnDelete || (f.isRequired ? 'Restrict' : 'SetNull'))
          .replace('SetNull', 'SET NULL').replace('NoAction', 'NO ACTION').replace('SetDefault', 'SET DEFAULT').toUpperCase();
        fks.push(`ALTER TABLE ${tableName(m)} ADD CONSTRAINT ${q(`${m.name}_${f.name}_fkey`)} FOREIGN KEY (${from}) REFERENCES ${q(f.type)} (${to}) ON DELETE ${onDel} ON UPDATE CASCADE;`);
      }
      continue;
    }
    if (f.isList && f.kind === 'object') continue;
    // scalar / enum column
    let type = pgType(f);
    let line;
    const isSerial = f.default && f.default.name === 'autoincrement';
    if (isSerial) {
      type = f.type === 'BigInt' ? 'bigserial' : 'serial';
      line = `  ${colName(f)} ${type}`;
    } else {
      line = `  ${colName(f)} ${type}`;
    }
    if (f.isRequired) line += ' NOT NULL';
    const def = isSerial ? null : pgDefault(f);
    if (def !== null) line += ` DEFAULT ${def}`;
    cols.push(line);
  }
  // primary key
  const pk = m.primaryKey ? m.primaryKey.fields : m.fields.filter((f) => f.isId).map((f) => f.name);
  if (pk && pk.length) cols.push(`  PRIMARY KEY (${pk.map(q).join(', ')})`);
  // single-field unique
  for (const f of m.fields) if (f.isUnique) cols.push(`  UNIQUE (${colName(f)})`);
  // composite unique
  for (const u of m.uniqueIndexes ?? []) cols.push(`  UNIQUE (${u.fields.map(q).join(', ')})`);

  if (!IDEMPOTENT) out.push(`DROP TABLE IF EXISTS ${tableName(m)} CASCADE;`);
  out.push(`CREATE TABLE ${IDEMPOTENT ? 'IF NOT EXISTS ' : ''}${tableName(m)} (\n${cols.join(',\n')}\n);`);
}

out.push('-- foreign keys');
for (const fk of fks) {
  if (IDEMPOTENT) {
    // add the FK only if a constraint of that name does not already exist
    const m = fk.match(/ADD CONSTRAINT "([^"]+)"/);
    const name = m ? m[1] : '';
    const tbl = fk.match(/ALTER TABLE (\S+)/)[1];
    out.push(`DO $$ BEGIN ${fk.replace(/;$/, '')}; EXCEPTION WHEN duplicate_object THEN null; WHEN duplicate_table THEN null; END $$;`);
  } else {
    out.push(fk);
  }
}

process.stdout.write(out.join('\n') + '\n');
