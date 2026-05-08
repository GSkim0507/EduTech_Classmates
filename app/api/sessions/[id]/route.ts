import { NextResponse } from 'next/server';
import {
  getSession,
  getAllDrafts,
  getAllTurns,
  getAllCalibrations,
  getClosure,
} from '@/lib/queries';

// GET /api/sessions/[id] — 세션 전체 상태 조회 (이어하기 / 복원용)
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

  return NextResponse.json({
    session,
    drafts,
    turns,
    calibrations,
    closure,
  });
}
