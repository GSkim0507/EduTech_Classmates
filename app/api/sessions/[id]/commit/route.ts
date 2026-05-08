import { NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { getSession, getLatestDraft, touchSession } from '@/lib/queries';
import type { Phase } from '@/lib/types';

interface CommitBody {
  phase: Phase;
}

const PHASE_ORDER: Exclude<Phase, 'done'>[] = ['intro', 'body', 'conclusion'];

// POST /api/sessions/[id]/commit — 현재 phase의 최신 draft를 확정하고 다음 phase로 이동
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let body: CommitBody;
  try {
    body = (await request.json()) as CommitBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const phase = body.phase;
  if (!PHASE_ORDER.includes(phase as Exclude<Phase, 'done'>)) {
    return NextResponse.json({ error: 'Invalid phase' }, { status: 400 });
  }

  const latest = await getLatestDraft(id, phase);
  if (!latest || !latest.content.trim()) {
    return NextResponse.json(
      { error: '확정할 draft가 비어있습니다. 먼저 글을 작성해 주세요.' },
      { status: 400 }
    );
  }

  // 1. 'committed' source의 새 draft revision 생성 (timeline 명시화)
  const committedResult = await db.execute({
    sql: `INSERT INTO draft_revisions
            (session_id, phase, content, source, preceding_turn_id, timestamp)
          VALUES (?, ?, ?, 'committed', NULL, ?)`,
    args: [id, phase, latest.content, now()],
  });
  const committedDraftId = Number(committedResult.lastInsertRowid);

  // 2. phase_commits에 마킹 (REPLACE = 같은 phase 재commit 가능)
  await db.execute({
    sql: `INSERT OR REPLACE INTO phase_commits
            (session_id, phase, committed_draft_id, committed_at)
          VALUES (?, ?, ?, ?)`,
    args: [id, phase, committedDraftId, now()],
  });

  // 3. session.current_phase를 다음 페이즈로
  const idx = PHASE_ORDER.indexOf(phase as Exclude<Phase, 'done'>);
  const nextPhase: Phase = idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : 'done';

  await db.execute({
    sql: `UPDATE sessions SET current_phase = ?, last_updated = ? WHERE id = ?`,
    args: [nextPhase, now(), id],
  });

  await touchSession(id);

  return NextResponse.json({ committedDraftId, nextPhase });
}
