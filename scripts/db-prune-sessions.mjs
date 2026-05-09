// 지정 세션 3개를 제외한 모든 세션과 자식 row 삭제.
// 기본은 dry-run. 실제 실행은 `node --env-file=.env.local scripts/db-prune-sessions.mjs --apply`.

import { createClient } from '@libsql/client';

const KEEP = ['_YqsDZGXS7j5', 'eNtaeQMs9ida', 'yusdEkL4fzPv'];

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error('❌ TURSO_DATABASE_URL not set. Run with --env-file=.env.local');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const db = createClient({ url, authToken });

console.log(`Mode: ${apply ? '🔥 APPLY (실제 삭제)' : '🧪 DRY-RUN (조회만)'}`);
console.log(`보존 대상 (${KEEP.length}): ${KEEP.join(', ')}`);
console.log('');

// 1. 보존 대상이 실제 존재하는지 확인
const keepPlaceholders = KEEP.map(() => '?').join(',');
const keepRows = await db.execute({
  sql: `SELECT id, persona_name, topic FROM sessions WHERE id IN (${keepPlaceholders})`,
  args: KEEP,
});
console.log(`✓ DB에 존재하는 보존 세션: ${keepRows.rows.length}개`);
for (const r of keepRows.rows) {
  console.log(`   - ${r.id}  ${r.persona_name}  ${r.topic}`);
}
const foundIds = new Set(keepRows.rows.map((r) => r.id));
const missing = KEEP.filter((id) => !foundIds.has(id));
if (missing.length > 0) {
  console.warn(`⚠️ 보존 대상인데 DB에 없음: ${missing.join(', ')}`);
}
console.log('');

// 2. 삭제 대상 조회
const targets = await db.execute({
  sql: `SELECT id, persona_name, topic, last_updated, status, current_phase
        FROM sessions WHERE id NOT IN (${keepPlaceholders})
        ORDER BY last_updated DESC`,
  args: KEEP,
});
console.log(`🗑 삭제 대상 세션: ${targets.rows.length}개`);
for (const r of targets.rows) {
  console.log(
    `   - ${r.id}  ${r.persona_name ?? '?'}  [${r.status}/${r.current_phase}]  ${r.topic?.slice(0, 40) ?? ''}`
  );
}
console.log('');

if (targets.rows.length === 0) {
  console.log('삭제할 세션이 없습니다.');
  process.exit(0);
}

const targetIds = targets.rows.map((r) => r.id);
const inList = targetIds.map(() => '?').join(',');

// 3. 자식 row 카운트 (참고용) — 삭제 순서는 FK 의존성 따름
//    turns → calibrations → phase_paragraph_commits → closures → drafts (drafts에 FK 의존하는 다른 테이블 먼저)
const tables = [
  'turns',
  'calibrations',
  'phase_paragraph_commits',
  'closures',
  'draft_revisions',
];
console.log('자식 row count (지워질 row):');
for (const t of tables) {
  const c = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM ${t} WHERE session_id IN (${inList})`,
    args: targetIds,
  });
  console.log(`   - ${t}: ${c.rows[0].n}`);
}
console.log('');

if (!apply) {
  console.log('Dry-run 종료. 실제 삭제는 --apply 플래그 추가.');
  process.exit(0);
}

// 4. 실제 삭제 — FK가 ON DELETE CASCADE이지만 Turso(libSQL)에서 안전하게 명시 삭제
console.log('🔥 삭제 진행...');
for (const t of tables) {
  const r = await db.execute({
    sql: `DELETE FROM ${t} WHERE session_id IN (${inList})`,
    args: targetIds,
  });
  console.log(`   ✓ ${t}: rowsAffected=${r.rowsAffected}`);
}
const sessRes = await db.execute({
  sql: `DELETE FROM sessions WHERE id IN (${inList})`,
  args: targetIds,
});
console.log(`   ✓ sessions: rowsAffected=${sessRes.rowsAffected}`);

// 5. 검증
const remain = await db.execute('SELECT COUNT(*) AS n FROM sessions');
console.log('');
console.log(`✅ 완료. 남은 세션: ${remain.rows[0].n}개`);
