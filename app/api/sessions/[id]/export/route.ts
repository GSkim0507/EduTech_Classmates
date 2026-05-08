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

  // phase_commits도 함께
  const commitsResult = await db.execute({
    sql: 'SELECT * FROM phase_commits WHERE session_id = ?',
    args: [id],
  });

  const payload = {
    schema_version: '1.0',
    exported_at: new Date().toISOString(),
    session,
    drafts,
    turns,
    calibrations: calibrations.map((c) => ({
      ...c,
      signals: JSON.parse(c.signals_json),
    })),
    phase_commits: commitsResult.rows,
    closure: closure
      ? {
          ...closure,
          rationale: JSON.parse(closure.rationale_json),
        }
      : null,
  };

  const filename = `session_${id}_${session.persona_name}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
