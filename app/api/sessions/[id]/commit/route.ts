import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { db, now } from '@/lib/db';
import {
  getSession,
  getLatestDraftParagraph,
  touchSession,
} from '@/lib/queries';
import type { CommitRequestInput, Phase } from '@/lib/types';

const PHASE_ORDER: Exclude<Phase, 'done'>[] = ['intro', 'body', 'conclusion', 'title'];

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

  // body 페이즈에서 paragraphIdx 없으면 → 모든 paragraph 한 번에 commit
  const isBodyAllCommit =
    phase === 'body' && (body.paragraphIdx === null || body.paragraphIdx === undefined);

  let lastCommittedDraftId = 0;
  let paragraphIdx = Number(body.paragraphIdx ?? 0);

  if (isBodyAllCommit) {
    // 본론: 최소 1문단 commit 가능. 빈 문단은 건너뛴다.
    // 정석 3문단 미만이면 committedCount로 페널티(다른 모듈에서 적용).
    const totalBody = body.bodyParagraphCount ?? 3;
    let committedCount = 0;
    for (let i = 0; i < totalBody; i++) {
      const latest = await getLatestDraftParagraph(id, phase as Exclude<Phase, 'done'>, i);
      if (!latest?.content?.trim()) continue; // 빈 문단 skip
      const committedResult = await db.execute({
        sql: `INSERT INTO draft_revisions
                (session_id, phase, paragraph_idx, content, content_hash, source, preceding_turn_id, timestamp)
              VALUES (?, ?, ?, ?, ?, 'committed', NULL, ?)`,
        args: [id, phase, i, latest.content, hashContent(latest.content), now()],
      });
      const cid = Number(committedResult.lastInsertRowid);
      await db.execute({
        sql: `INSERT OR REPLACE INTO phase_paragraph_commits
                (session_id, phase, paragraph_idx, committed_draft_id, committed_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [id, phase, i, cid, now()],
      });
      lastCommittedDraftId = cid;
      paragraphIdx = i;
      committedCount += 1;
    }
    if (committedCount === 0) {
      return NextResponse.json(
        { error: '본론을 적어도 한 문단은 써야 결론으로 갈 수 있어.' },
        { status: 400 }
      );
    }
  } else {
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
    lastCommittedDraftId = Number(committedResult.lastInsertRowid);

    await db.execute({
      sql: `INSERT OR REPLACE INTO phase_paragraph_commits
              (session_id, phase, paragraph_idx, committed_draft_id, committed_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, phase, paragraphIdx, lastCommittedDraftId, now()],
    });
  }

  // 3. 다음 phase/paragraph 결정
  let nextPhase: Phase = phase;
  let nextParagraphIdx: number = paragraphIdx;

  if (phase === 'intro') {
    nextPhase = 'body';
    nextParagraphIdx = 0;
  } else if (phase === 'body') {
    if (isBodyAllCommit) {
      // 본론 전체 commit → 결론으로
      nextPhase = 'conclusion';
      nextParagraphIdx = 0;
    } else {
      const totalBody = body.bodyParagraphCount ?? 3;
      if (paragraphIdx < totalBody - 1) {
        nextPhase = 'body';
        nextParagraphIdx = paragraphIdx + 1;
      } else {
        nextPhase = 'conclusion';
        nextParagraphIdx = 0;
      }
    }
  } else if (phase === 'conclusion') {
    nextPhase = 'title';
    nextParagraphIdx = 0;
  } else if (phase === 'title') {
    nextPhase = 'done';
    nextParagraphIdx = 0;
  }

  // 4. session.current_phase 갱신 (+ title commit이면 sessions.title도 갱신)
  if (phase === 'title') {
    // title commit: sessions.title도 함께 update (latestContent 사용)
    const titleLatest = await getLatestDraftParagraph(id, 'title', 0);
    await db.execute({
      sql: 'UPDATE sessions SET current_phase = ?, title = ?, last_updated = ? WHERE id = ?',
      args: [nextPhase, titleLatest?.content ?? null, now(), id],
    });
  } else {
    await db.execute({
      sql: 'UPDATE sessions SET current_phase = ?, last_updated = ? WHERE id = ?',
      args: [nextPhase, now(), id],
    });
  }

  await touchSession(id);

  return NextResponse.json({
    committedDraftId: lastCommittedDraftId,
    nextPhase,
    nextParagraphIdx,
  });
}
