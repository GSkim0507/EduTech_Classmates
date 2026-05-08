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

const schemaPath = path.join(projectRoot, 'data', 'schema.sql');
const schemaSQL = fs.readFileSync(schemaPath, 'utf-8');

// 라인 단위 주석 (--로 시작) 제거 후 ;로 분리
const cleanedSQL = schemaSQL
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const statements = cleanedSQL
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`\nApplying ${statements.length} SQL statements to:\n  ${url}\n`);

let count = 0;
for (const stmt of statements) {
  try {
    await db.execute(stmt);
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 70);
    console.log(`  ✓ ${preview}${stmt.length > 70 ? '...' : ''}`);
    count++;
  } catch (err) {
    console.error(`  ✗ ${stmt.slice(0, 70).replace(/\s+/g, ' ')}...`);
    console.error('    error:', err.message);
    process.exit(1);
  }
}

console.log(`\n✅ Applied ${count} statements successfully.\n`);
