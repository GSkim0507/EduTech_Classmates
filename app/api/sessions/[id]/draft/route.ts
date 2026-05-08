import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { db, now } from '@/lib/db';
import { getSession, findDuplicateDraft, touchSession } from '@/lib/queries';
import type { Phase, DraftSource, DraftRequestInput } from '@/lib/types';

const VALID_PHASES: Phase[] = ['intro', 'body', 'conclusion'];
const VALID_SOURCES: DraftSource[] = [
  'student_write',
  'student_revise',
  'committed',
  'regress_uncommit',
];

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// POST /api/sessions/[id]/draft — draft 스냅샷 저장
// v2: paragraph_idx + content_hash 기반 중복 INSERT skip
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let body: DraftRequestInput;
  try {
    body = (await request.json()) as DraftRequestInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!VALID_PHASES.includes(body.phase) || !VALID_SOURCES.includes(body.source)) {
    return NextResponse.json({ error: 'Invalid phase or source' }, { status: 400 });
  }

  const paragraphIdx = Number(body.paragraphIdx ?? 0);
  if (!Number.isInteger(paragraphIdx) || paragraphIdx < 0 || paragraphIdx > 4) {
    return NextResponse.json({ error: 'Invalid paragraphIdx (0~4)' }, { status: 400 });
  }

  const content = body.content ?? '';
  const contentHash = hashContent(content);

  // 중복 체크 — 직전 (session, phase, paragraphIdx) row와 hash 동일하면 skip
  const dup = await findDuplicateDraft(id, body.phase, paragraphIdx, contentHash);
  if (dup) {
    await touchSession(id);
    return NextResponse.json({ draftId: dup.id, deduped: true });
  }

  const result = await db.execute({
    sql: `INSERT INTO draft_revisions
            (session_id, phase, paragraph_idx, content, content_hash, source, preceding_turn_id, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      body.phase,
      paragraphIdx,
      content,
      contentHash,
      body.source,
      body.precedingTurnId ?? null,
      now(),
    ],
  });

  await touchSession(id);
  return NextResponse.json({ draftId: Number(result.lastInsertRowid), deduped: false });
}
