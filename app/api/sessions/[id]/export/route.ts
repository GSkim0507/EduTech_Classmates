import { NextResponse } from 'next/server';
import {
  getSession,
  getAllDrafts,
  getAllTurns,
  getAllCalibrations,
  getClosure,
} from '@/lib/queries';
import { db } from '@/lib/db';

// GET /api/sessions/[id]/export — 세션 전체를 단일 JSON으로 내보냄
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const [drafts, turns, calibrations, closure] = await Promise.all([
    getAllDrafts(id),
    getAllTurns(id),
    getAllCalibrations(id),
    getClosure(id),
  ]);

  // phase_paragraph_commits도 함께
  const commitsResult = await db.execute({
    sql: 'SELECT * FROM phase_paragraph_commits WHERE session_id = ?',
    args: [id],
  });

  const payload = {
    schema_version: '2.0',
    exported_at: new Date().toISOString(),
    session,
    drafts,
    turns,
    calibrations: calibrations.map((c) => ({
      ...c,
      signals: JSON.parse(c.signals_json),
      curriculum_signals: c.curriculum_signals_json
        ? JSON.parse(c.curriculum_signals_json)
        : null,
    })),
    phase_commits: commitsResult.rows,
    closure: closure
      ? {
          ...closure,
          rationale: JSON.parse(closure.rationale_json),
        }
      : null,
  };

  // 한글 파일명 — RFC 5987 (filename* with UTF-8 encoding) + ASCII fallback
  const personaSafe = session.persona_name.replace(/[^a-zA-Z0-9_-]/g, '');
  const asciiName = `session_${id}${personaSafe ? `_${personaSafe}` : ''}.json`;
  const utf8Name = `세션_${id}_${session.persona_name}.json`;
  const encoded = encodeURIComponent(utf8Name);

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
    },
  });
}
