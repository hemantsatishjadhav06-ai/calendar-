// Emits schema.graphql (full) for codegen and CI schema-diff.
import { writeFileSync } from 'node:fs';
import { printSchema } from 'graphql';
import { schema } from './schema/index.js';

writeFileSync(new URL('../../schema.graphql', import.meta.url), printSchema(schema));
console.log('wrote apps/api/schema.graphql');
