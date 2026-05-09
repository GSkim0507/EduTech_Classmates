import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// CSV 안전 인코딩 — 큰따옴표 escape + 셀 내 줄바꿈 보존 (RFC 4180)
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  // 일관성: \r\n → \n으로 normalize
  s = s.replace(/\r\n/g, '\n');
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines: string[] = [];
  lines.push(headers.map(csvCell).join(','));
  for (const r of rows) {
    lines.push(headers.map((h) => csvCell(r[h])).join(','));
  }
  return lines.join('\n');
}

// GET /api/admin/export-csv?table=all
//   ?table=sessions|drafts|turns|calibrations|closures|phase_commits|all  (default: all)
//   ?format=single|multi  (single: 한 join CSV / multi: 5개 분리. default: multi)
//
// multi 모드는 지금은 첫 번째 매칭 테이블만 단일 CSV로 반환 (zip 묶음 의존성 없이 단순화).
// 클라이언트에서 테이블별로 별도 호출하면 충분.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const table = url.searchParams.get('table') ?? 'all';

  // ─── 'all' = 모든 테이블을 join한 wide CSV (분석가 친화) ───
  if (table === 'all') {
    const sql = `
      SELECT
        s.id              AS session_id,
        s.persona_name,
        s.grade,
        s.topic,
        s.title,
        s.started_at,
        s.last_updated,
        s.status,
        s.current_phase,
        c.closure_type,
        c.persuasion_pct,
        c.agent_message   AS closure_message,
        c.rationale_json  AS closure_rationale_json,
        c.created_at      AS closure_created_at,
        (SELECT COUNT(*) FROM draft_revisions d WHERE d.session_id = s.id) AS total_drafts,
        (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id)            AS total_turns,
        (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id AND t.role = 'student') AS student_turns,
        (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id AND t.role = 'student' AND t.triggered_by = 'help') AS help_turns,
        (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id AND t.role = 'student' AND t.triggered_by = 'submit') AS submit_turns,
        (SELECT COUNT(*) FROM calibrations cal WHERE cal.session_id = s.id) AS total_calibrations
      FROM sessions s
      LEFT JOIN closures c ON c.session_id = s.id
      ORDER BY s.last_updated DESC
    `;
    const result = await db.execute(sql);
    const rows = result.rows.map((r) => r as unknown as Record<string, unknown>);
    const headers = [
      'session_id',
      'persona_name',
      'grade',
      'topic',
      'title',
      'started_at',
      'last_updated',
      'status',
      'current_phase',
      'closure_type',
      'persuasion_pct',
      'closure_message',
      'closure_rationale_json',
      'closure_created_at',
      'total_drafts',
      'total_turns',
      'student_turns',
      'help_turns',
      'submit_turns',
      'total_calibrations',
    ];
    const csv = rowsToCsv(headers, rows);
    return csvResponse(csv, 'sessions_summary');
  }

  // ─── 단일 테이블 dump ───
  let sql = '';
  let baseFilename = table;
  switch (table) {
    case 'sessions':
      sql = 'SELECT * FROM sessions ORDER BY last_updated DESC';
      break;
    case 'drafts':
      sql = 'SELECT * FROM draft_revisions ORDER BY session_id, id';
      baseFilename = 'draft_revisions';
      break;
    case 'turns':
      sql = 'SELECT * FROM turns ORDER BY session_id, idx';
      break;
    case 'calibrations':
      sql = 'SELECT * FROM calibrations ORDER BY session_id, id';
      break;
    case 'closures':
      sql = 'SELECT * FROM closures ORDER BY created_at DESC';
      break;
    case 'phase_commits':
      sql = 'SELECT * FROM phase_paragraph_commits ORDER BY session_id, phase, paragraph_idx';
      baseFilename = 'phase_paragraph_commits';
      break;
    default:
      return NextResponse.json({ error: `Unknown table: ${table}` }, { status: 400 });
  }

  const result = await db.execute(sql);
  if (result.rows.length === 0) {
    return csvResponse('', baseFilename);
  }
  const rows = result.rows.map((r) => r as unknown as Record<string, unknown>);
  const headers = Object.keys(rows[0]);
  const csv = rowsToCsv(headers, rows);
  return csvResponse(csv, baseFilename);
}

function csvResponse(csv: string, baseFilename: string): NextResponse {
  // BOM 추가 — Excel이 UTF-8 한글을 깨지지 않게 인식
  const withBom = '\uFEFF' + csv;
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const asciiName = `classmates_${baseFilename}_${ts}.csv`;
  const utf8Name = `어노잉친구_${baseFilename}_${ts}.csv`;
  const encoded = encodeURIComponent(utf8Name);

  return new NextResponse(withBom, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
    },
  });
}
