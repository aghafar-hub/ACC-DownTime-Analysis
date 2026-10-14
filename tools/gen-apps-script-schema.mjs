#!/usr/bin/env node
/**
 * Generates backend/apps-script/Schema.js from schema/tables.json so the
 * Apps Script backend and the schema can never drift apart.
 *
 *   node tools/gen-apps-script-schema.mjs          write Schema.js
 *   node tools/gen-apps-script-schema.mjs --check  exit 1 if Schema.js is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA_JSON = resolve(root, 'schema/tables.json');
export const OUTPUT_JS = resolve(root, 'backend/apps-script/Schema.js');

/** Build the SCHEMA object the backend uses (no free-text descriptions on columns). */
export function buildSchema(src) {
  const tables = {};
  const tableOrder = [];
  for (const t of src.tables) {
    tableOrder.push(t.name);
    tables[t.name] = {
      description: t.description,
      key: t.key,
      columns: t.columns.map((c) => {
        const col = { name: c.name, type: c.type, required: !!c.required };
        if (c.enum) col.enum = c.enum;
        return col;
      }),
    };
  }
  return {
    version: src.version,
    tableOrder,
    tables,
    seeds: {
      settings: src.settingsDefaults,
      roles: src.roleSeeds,
      tabAccess: src.tabAccessDefaults,
      classifications: src.classificationSeeds,
      lines: src.lineSeeds,
      areas: src.areaSeeds,
      contractors: src.contractorSeeds || [],
    },
  };
}

export function render(src) {
  const body = JSON.stringify(buildSchema(src), null, 1);
  return (
    '// GENERATED FILE - do not edit by hand.\n' +
    '// Source: schema/tables.json. Regenerate with: node tools/gen-apps-script-schema.mjs\n' +
    'var SCHEMA = ' + body + ';\n'
  );
}

export function expected() {
  return render(JSON.parse(readFileSync(SCHEMA_JSON, 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = expected();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUTPUT_JS, 'utf8'); } catch { /* missing */ }
    if (current !== out) {
      console.error('Schema.js is out of date. Run: node tools/gen-apps-script-schema.mjs');
      process.exit(1);
    }
    console.log('Schema.js is up to date.');
  } else {
    writeFileSync(OUTPUT_JS, out);
    console.log('Wrote ' + OUTPUT_JS);
  }
}
