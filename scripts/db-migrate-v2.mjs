import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error('❌ TURSO_DATABASE_URL is not set. Run with --env-file=.env.local');
  process.exit(1);
}

const db = createClient({ url, authToken });

// v1과 v2 모두 다룬다 (v1의 phase_commits + v2의 phase_paragraph_commits)
const DROP_TABLES = [
  'closures',
  'calibrations',
  'phase_paragraph_commits',
  'phase_commits',
  'turns',
  'draft_revisions',
  'sessions',
];

console.log(`\n⚠️  Dropping all v1 tables on:\n   ${url}\n`);
for (const t of DROP_TABLES) {
  try {
    await db.execute(`DROP TABLE IF EXISTS ${t}`);
    console.log(`   ✓ DROP ${t}`);
  } catch (e) {
    console.warn(`   ⚠ DROP ${t}: ${e.message}`);
  }
}

const schemaPath = path.join(projectRoot, 'data/schema.sql');
const raw = fs.readFileSync(schemaPath, 'utf-8');
const cleaned = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
const stmts = cleaned
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`\n🚀 Creating v2 schema (${stmts.length} statements)\n`);
let ok = 0;
for (const s of stmts) {
  try {
    await db.execute(s);
    const preview = s.replace(/\s+/g, ' ').slice(0, 70);
    console.log(`   ✓ ${preview}${s.length > 70 ? '...' : ''}`);
    ok++;
  } catch (e) {
    console.error(`   ✗ ${s.slice(0, 70)}\n     ${e.message}`);
    process.exit(1);
  }
}

console.log(`\n✅ Migrated ${ok} statements successfully.\n`);
