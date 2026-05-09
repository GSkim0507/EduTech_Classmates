import { db, now } from './db';
import type {
  Phase,
  SessionRow,
  DraftRow,
  TurnRow,
  CalibrationRow,
  ClosureRow,
  PhaseParagraphCommitRow,
} from './types';

// ──────────────────────────────────────────────────────────
// v2 — paragraph 단위 쿼리 + content_hash 중복 체크
// spec: docs/superpowers/specs/2026-05-09-system-redesign-design.md §3
// ──────────────────────────────────────────────────────────

export async function getSession(id: string): Promise<SessionRow | null> {
  const result = await db.execute({
    sql: 'SELECT * FROM sessions WHERE id = ?',
    args: [id],
  });
  return (result.rows[0] as unknown as SessionRow) ?? null;
}

export async function touchSession(id: string): Promise<void> {
  await db.execute({
    sql: 'UPDATE sessions SET last_updated = ? WHERE id = ?',
    args: [now(), id],
  });
}

// ─── Drafts (paragraph 단위) ───

export async function getLatestDraftParagraph(
  sessionId: string,
  phase: Phase,
  paragraphIdx: number
): Promise<DraftRow | null> {
  const result = await db.execute({
    sql: `SELECT * FROM draft_revisions
          WHERE session_id = ? AND phase = ? AND paragraph_idx = ?
          ORDER BY id DESC LIMIT 1`,
    args: [sessionId, phase, paragraphIdx],
  });
  return (result.rows[0] as unknown as DraftRow) ?? null;
}

/** v1 호환 (paragraph_idx=0 기본) */
export async function getLatestDraft(
  sessionId: string,
  phase: Phase
): Promise<DraftRow | null> {
  return getLatestDraftParagraph(sessionId, phase, 0);
}

export async function getCommittedDraftParagraph(
  sessionId: string,
  phase: Phase,
  paragraphIdx: number
): Promise<DraftRow | null> {
  const result = await db.execute({
    sql: `SELECT d.* FROM phase_paragraph_commits c
          JOIN draft_revisions d ON c.committed_draft_id = d.id
          WHERE c.session_id = ? AND c.phase = ? AND c.paragraph_idx = ?`,
    args: [sessionId, phase, paragraphIdx],
  });
  return (result.rows[0] as unknown as DraftRow) ?? null;
}

/** v1 호환 (paragraph_idx=0 기본) */
export async function getCommittedDraft(
  sessionId: string,
  phase: Phase
): Promise<DraftRow | null> {
  return getCommittedDraftParagraph(sessionId, phase, 0);
}

export async function getCommittedBodyParagraphs(
  sessionId: string
): Promise<DraftRow[]> {
  const result = await db.execute({
    sql: `SELECT d.* FROM phase_paragraph_commits c
          JOIN draft_revisions d ON c.committed_draft_id = d.id
          WHERE c.session_id = ? AND c.phase = 'body'
          ORDER BY c.paragraph_idx ASC`,
    args: [sessionId],
  });
  return result.rows as unknown as DraftRow[];
}

export async function getAllDrafts(sessionId: string): Promise<DraftRow[]> {
  const result = await db.execute({
    sql: `SELECT * FROM draft_revisions WHERE session_id = ?
          ORDER BY phase, paragraph_idx, id`,
    args: [sessionId],
  });
  return result.rows as unknown as DraftRow[];
}

/**
 * 동일 (session, phase, paragraphIdx)에서 같은 content_hash를 가진 가장 최근 row 찾기.
 * v2 중복 INSERT 방지용.
 */
export async function findDuplicateDraft(
  sessionId: string,
  phase: Phase,
  paragraphIdx: number,
  contentHash: string
): Promise<DraftRow | null> {
  const result = await db.execute({
    sql: `SELECT * FROM draft_revisions
          WHERE session_id = ? AND phase = ? AND paragraph_idx = ?
          ORDER BY id DESC LIMIT 1`,
    args: [sessionId, phase, paragraphIdx],
  });
  const last = result.rows[0] as unknown as DraftRow | undefined;
  if (last && last.content_hash === contentHash) return last;
  return null;
}

// ─── Turns ───

export async function getAllTurns(sessionId: string): Promise<TurnRow[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM turns WHERE session_id = ? ORDER BY idx',
    args: [sessionId],
  });
  return result.rows as unknown as TurnRow[];
}

export async function getNextTurnIdx(sessionId: string): Promise<number> {
  const result = await db.execute({
    sql: 'SELECT COALESCE(MAX(idx), -1) AS max_idx FROM turns WHERE session_id = ?',
    args: [sessionId],
  });
  return Number(result.rows[0].max_idx) + 1;
}

export async function getHelpCount(
  sessionId: string,
  phase: Phase,
  paragraphIdx: number | null = null
): Promise<number> {
  const sql = paragraphIdx === null
    ? `SELECT COUNT(*) AS cnt FROM turns
       WHERE session_id = ? AND phase = ? AND triggered_by = 'help' AND role = 'student'`
    : `SELECT COUNT(*) AS cnt FROM turns
       WHERE session_id = ? AND phase = ? AND paragraph_idx = ?
         AND triggered_by = 'help' AND role = 'student'`;
  const args: (string | number)[] = paragraphIdx === null
    ? [sessionId, phase]
    : [sessionId, phase, paragraphIdx];
  const result = await db.execute({ sql, args });
  return Number(result.rows[0].cnt);
}

export async function getRevisionCount(
  sessionId: string,
  phase: Phase,
  paragraphIdx: number | null = null
): Promise<number> {
  const sql = paragraphIdx === null
    ? `SELECT COUNT(*) AS cnt FROM draft_revisions
       WHERE session_id = ? AND phase = ? AND source = 'student_revise'`
    : `SELECT COUNT(*) AS cnt FROM draft_revisions
       WHERE session_id = ? AND phase = ? AND paragraph_idx = ? AND source = 'student_revise'`;
  const args: (string | number)[] = paragraphIdx === null
    ? [sessionId, phase]
    : [sessionId, phase, paragraphIdx];
  const result = await db.execute({ sql, args });
  return Number(result.rows[0].cnt);
}

// ─── Calibrations ───

export async function getAllCalibrations(sessionId: string): Promise<CalibrationRow[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM calibrations WHERE session_id = ? ORDER BY id',
    args: [sessionId],
  });
  return result.rows as unknown as CalibrationRow[];
}

export async function getLatestCalibration(
  sessionId: string
): Promise<CalibrationRow | null> {
  const result = await db.execute({
    sql: `SELECT * FROM calibrations WHERE session_id = ? ORDER BY id DESC LIMIT 1`,
    args: [sessionId],
  });
  return (result.rows[0] as unknown as CalibrationRow) ?? null;
}

// ─── Phase commits ───

export async function getPhaseParagraphCommits(
  sessionId: string
): Promise<PhaseParagraphCommitRow[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM phase_paragraph_commits WHERE session_id = ? ORDER BY phase, paragraph_idx',
    args: [sessionId],
  });
  return result.rows as unknown as PhaseParagraphCommitRow[];
}

// ─── Closure ───

export async function getClosure(sessionId: string): Promise<ClosureRow | null> {
  const result = await db.execute({
    sql: 'SELECT * FROM closures WHERE session_id = ?',
    args: [sessionId],
  });
  return (result.rows[0] as unknown as ClosureRow) ?? null;
}

// ─── Aggregation helpers ───

/**
 * 본론 다문단을 paragraph_idx 순으로 합쳐서 반환 (closure 등에서 사용).
 */
export async function getCommittedDraftsAll(
  sessionId: string
): Promise<{ intro: string; body: string; conclusion: string; title?: string }> {
  const intro = await getCommittedDraftParagraph(sessionId, 'intro', 0);
  const conclusion = await getCommittedDraftParagraph(sessionId, 'conclusion', 0);
  const titleCommit = await getCommittedDraftParagraph(sessionId, 'title', 0);
  const bodyParagraphs = await getCommittedBodyParagraphs(sessionId);

  const bodyJoined = bodyParagraphs
    .map((p, i) => `(${i + 1}문단) ${p.content}`)
    .join('\n\n');

  return {
    intro: intro?.content ?? '',
    body: bodyJoined,
    conclusion: conclusion?.content ?? '',
    title: titleCommit?.content ?? undefined,
  };
}

/**
 * 본론에서 AI가 던진 반박 + 학생 응답을 페어로 추출 (closure prompt용).
 */
export async function getBodyRebuttalsText(sessionId: string): Promise<string> {
  const turns = await getAllTurns(sessionId);
  const bodyTurns = turns.filter((t) => t.phase === 'body');

  const lines: string[] = [];
  for (let i = 0; i < bodyTurns.length; i++) {
    const t = bodyTurns[i];
    if (t.role === 'assistant' && (t.tone === 'annoying' || t.domain === 'writing')) {
      const paraTag =
        typeof t.paragraph_idx === 'number' ? `[본론 ${t.paragraph_idx + 1}문단] ` : '';
      lines.push(`${paraTag}[AI 반박] ${t.content}`);
      const next = bodyTurns[i + 1];
      if (next && next.role === 'student') {
        lines.push(`${paraTag}[학생 응답] ${next.content.slice(0, 200)}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}
