import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { db, now } from '@/lib/db';
import {
  getSession,
  getCommittedDraftParagraph,
  touchSession,
} from '@/lib/queries';
import type { UncommitRequestInput, Phase } from '@/lib/types';

const PHASE_ORDER: Exclude<Phase, 'done'>[] = ['intro', 'body', 'conclusion'];

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// POST /api/sessions/[id]/uncommit
// 학생이 회귀 (commit 해제) — 해당 phase/paragraph commit row 삭제 +
// draft_revisions에 'regress_uncommit' source row 1개 INSERT (timeline 보존)
// session.current_phase는 학생이 회귀한 위치로 되돌림.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let body: UncommitRequestInput;
  try {
    body = (await request.json()) as UncommitRequestInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!PHASE_ORDER.includes(body.phase as Exclude<Phase, 'done'>)) {
    return NextResponse.json({ error: 'Invalid phase' }, { status: 400 });
  }

  const paragraphIdx = Number(body.paragraphIdx ?? 0);
  if (!Number.isInteger(paragraphIdx) || paragraphIdx < 0 || paragraphIdx > 4) {
    return NextResponse.json({ error: 'Invalid paragraphIdx (0~4)' }, { status: 400 });
  }

  // 1. 기존 commit row 조회 (없으면 회귀 불가)
  const existing = await getCommittedDraftParagraph(
    id,
    body.phase as Exclude<Phase, 'done'>,
    paragraphIdx
  );
  if (!existing) {
    return NextResponse.json(
      { error: '아직 확정되지 않은 부분입니다.' },
      { status: 409 }
    );
  }

  // 2. phase_paragraph_commits row 삭제
  await db.execute({
    sql: `DELETE FROM phase_paragraph_commits
          WHERE session_id = ? AND phase = ? AND paragraph_idx = ?`,
    args: [id, body.phase, paragraphIdx],
  });

  // 3. draft_revisions에 regress_uncommit row INSERT (content는 직전 commit 그대로)
  await db.execute({
    sql: `INSERT INTO draft_revisions
            (session_id, phase, paragraph_idx, content, content_hash, source, preceding_turn_id, timestamp)
          VALUES (?, ?, ?, ?, ?, 'regress_uncommit', NULL, ?)`,
    args: [
      id,
      body.phase,
      paragraphIdx,
      existing.content,
      hashContent(existing.content),
      now(),
    ],
  });

  // 4. session.current_phase = 회귀한 위치
  await db.execute({
    sql: 'UPDATE sessions SET current_phase = ?, last_updated = ? WHERE id = ?',
    args: [body.phase, now(), id],
  });

  await touchSession(id);

  return NextResponse.json({
    ok: true,
    currentPhase: body.phase,
    currentParagraphIdx: paragraphIdx,
  });
}
