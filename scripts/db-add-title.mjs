// 2026-05-09 — sessions.title TEXT 컬럼 추가
// 기존 데이터 보존 + nullable column 신규 추가
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error('❌ TURSO_DATABASE_URL is not set.');
  process.exit(1);
}
const db = createClient({ url, authToken });

try {
  await db.execute('ALTER TABLE sessions ADD COLUMN title TEXT');
  console.log('✅ Added sessions.title column');
} catch (e) {
  const msg = e.message ?? String(e);
  if (msg.includes('duplicate column') || msg.includes('already exists')) {
    console.log('ℹ️  sessions.title column already exists — skipping');
  } else {
    console.error('✗ ALTER failed:', msg);
    process.exit(1);
  }
}
