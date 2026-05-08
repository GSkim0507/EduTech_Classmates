import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/admin/sessions — 전체 세션 목록 (관리자용)
export async function GET() {
  const result = await db.execute(`
    SELECT
      s.*,
      (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turn_count,
      (SELECT COUNT(*) FROM draft_revisions d WHERE d.session_id = s.id) AS draft_count,
      (SELECT closure_type FROM closures c WHERE c.session_id = s.id) AS closure_type,
      (SELECT persuasion_pct FROM closures c WHERE c.session_id = s.id) AS persuasion_pct
    FROM sessions s
    ORDER BY s.last_updated DESC
  `);

  return NextResponse.json({ sessions: result.rows });
}
