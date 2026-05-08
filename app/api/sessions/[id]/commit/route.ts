import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { db, now } from '@/lib/db';
import {
  getSession,
  getLatestDraftParagraph,
  touchSession,
} from '@/lib/queries';
import type { CommitRequestInput, Phase } from '@/lib/types';

const PHASE_ORDER: Exclude<Phase, 'done'>[] = ['intro', 'body', 'conclusion'];

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// POST /api/sessions/[id]/commit
// v2: paragraph_idx 단위 commit
// 본론은 i문단 commit 후 → 다음 i+1문단 (또는 마지막 문단이면 결론으로)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let body: CommitRequestInput;
  try {
    body = (await request.json()) as CommitRequestInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const phase = body.phase;
  if (!PHASE_ORDER.includes(phase as Exclude<Phase, 'done'>)) {
    return NextResponse.json({ error: 'Invalid phase' }, { status: 400 });
  }

  const paragraphIdx = Number(body.paragraphIdx ?? 0);
  if (!Number.isInteger(paragraphIdx) || paragraphIdx < 0 || paragraphIdx > 4) {
    return NextResponse.json({ error: 'Invalid paragraphIdx (0~4)' }, { status: 400 });
  }

  const latest = await getLatestDraftParagraph(
    id,
    phase as Exclude<Phase, 'done'>,
    paragraphIdx
  );
  if (!latest || !latest.content.trim()) {
    return NextResponse.json(
      { error: '확정할 글이 비어있어요. 먼저 작성해 주세요.' },
      { status: 400 }
    );
  }

  // 1. 'committed' source의 새 draft revision 생성 (timeline 명시)
  const committedResult = await db.execute({
    sql: `INSERT INTO draft_revisions
            (session_id, phase, paragraph_idx, content, content_hash, source, preceding_turn_id, timestamp)
          VALUES (?, ?, ?, ?, ?, 'committed', NULL, ?)`,
    args: [
      id,
      phase,
      paragraphIdx,
      latest.content,
      hashContent(latest.content),
      now(),
    ],
  });
  const committedDraftId = Number(committedResult.lastInsertRowid);

  // 2. phase_paragraph_commits 마킹 (재commit 시 REPLACE)
  await db.execute({
    sql: `INSERT OR REPLACE INTO phase_paragraph_commits
            (session_id, phase, paragraph_idx, committed_draft_id, committed_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, phase, paragraphIdx, committedDraftId, now()],
  });

  // 3. 다음 phase/paragraph 결정
  let nextPhase: Phase = phase;
  let nextParagraphIdx: number = paragraphIdx;

  if (phase === 'intro') {
    nextPhase = 'body';
    nextParagraphIdx = 0;
  } else if (phase === 'body') {
    const totalBody = body.bodyParagraphCount ?? 3;
    if (paragraphIdx < totalBody - 1) {
      // 같은 phase 다음 문단으로
      nextPhase = 'body';
      nextParagraphIdx = paragraphIdx + 1;
    } else {
      // 본론 마지막 문단 → 결론
      nextPhase = 'conclusion';
      nextParagraphIdx = 0;
    }
  } else if (phase === 'conclusion') {
    nextPhase = 'done';
    nextParagraphIdx = 0;
  }

  // 4. session.current_phase 갱신
  await db.execute({
    sql: 'UPDATE sessions SET current_phase = ?, last_updated = ? WHERE id = ?',
    args: [nextPhase, now(), id],
  });

  await touchSession(id);

  return NextResponse.json({
    committedDraftId,
    nextPhase,
    nextParagraphIdx,
  });
}
