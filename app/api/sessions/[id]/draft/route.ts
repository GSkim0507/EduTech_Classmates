import { NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { getSession, touchSession } from '@/lib/queries';
import type { Phase, DraftSource } from '@/lib/types';

interface DraftBody {
  phase: Phase;
  content: string;
  source: DraftSource;
  precedingTurnId?: number | null;
}

const VALID_PHASES: Phase[] = ['intro', 'body', 'conclusion'];
const VALID_SOURCES: DraftSource[] = ['student_write', 'student_revise', 'committed'];

// POST /api/sessions/[id]/draft — draft 스냅샷 저장 (자동저장 등)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let body: DraftBody;
  try {
    body = (await request.json()) as DraftBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!VALID_PHASES.includes(body.phase) || !VALID_SOURCES.includes(body.source)) {
    return NextResponse.json({ error: 'Invalid phase or source' }, { status: 400 });
  }

  const result = await db.execute({
    sql: `INSERT INTO draft_revisions
            (session_id, phase, content, source, preceding_turn_id, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, body.phase, body.content ?? '', body.source, body.precedingTurnId ?? null, now()],
  });

  await touchSession(id);

  return NextResponse.json({ draftId: Number(result.lastInsertRowid) });
}
