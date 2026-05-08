import { db, now } from './db';
import type { Phase, SessionRow, DraftRow, TurnRow, CalibrationRow, ClosureRow } from './types';

// ──────────────────────────────────────────────────────────
// 자주 쓰는 DB 쿼리 모음
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

export async function getLatestDraft(
  sessionId: string,
  phase: Phase
): Promise<DraftRow | null> {
  const result = await db.execute({
    sql: `SELECT * FROM draft_revisions WHERE session_id = ? AND phase = ?
          ORDER BY id DESC LIMIT 1`,
    args: [sessionId, phase],
  });
  return (result.rows[0] as unknown as DraftRow) ?? null;
}

export async function getCommittedDraft(
  sessionId: string,
  phase: Phase
): Promise<DraftRow | null> {
  const result = await db.execute({
    sql: `SELECT d.* FROM phase_commits c
          JOIN draft_revisions d ON c.committed_draft_id = d.id
          WHERE c.session_id = ? AND c.phase = ?`,
    args: [sessionId, phase],
  });
  return (result.rows[0] as unknown as DraftRow) ?? null;
}

export async function getAllDrafts(sessionId: string): Promise<DraftRow[]> {
  const result = await db.execute({
    sql: `SELECT * FROM draft_revisions WHERE session_id = ?
          ORDER BY phase, id`,
    args: [sessionId],
  });
  return result.rows as unknown as DraftRow[];
}

export async function getAllTurns(sessionId: string): Promise<TurnRow[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM turns WHERE session_id = ? ORDER BY idx',
    args: [sessionId],
  });
  return result.rows as unknown as TurnRow[];
}

export async function getAllCalibrations(sessionId: string): Promise<CalibrationRow[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM calibrations WHERE session_id = ? ORDER BY id',
    args: [sessionId],
  });
  return result.rows as unknown as CalibrationRow[];
}

export async function getClosure(sessionId: string): Promise<ClosureRow | null> {
  const result = await db.execute({
    sql: 'SELECT * FROM closures WHERE session_id = ?',
    args: [sessionId],
  });
  return (result.rows[0] as unknown as ClosureRow) ?? null;
}

export async function getHelpCount(sessionId: string, phase: Phase): Promise<number> {
  const result = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM turns
          WHERE session_id = ? AND phase = ? AND triggered_by = 'help' AND role = 'student'`,
    args: [sessionId, phase],
  });
  return Number(result.rows[0].cnt);
}

export async function getRevisionCount(sessionId: string, phase: Phase): Promise<number> {
  const result = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM draft_revisions
          WHERE session_id = ? AND phase = ? AND source = 'student_revise'`,
    args: [sessionId, phase],
  });
  return Number(result.rows[0].cnt);
}

export async function getNextTurnIdx(sessionId: string): Promise<number> {
  const result = await db.execute({
    sql: 'SELECT COALESCE(MAX(idx), -1) AS max_idx FROM turns WHERE session_id = ?',
    args: [sessionId],
  });
  return Number(result.rows[0].max_idx) + 1;
}

export async function getCommittedDraftsAll(
  sessionId: string
): Promise<{ intro: string; body: string; conclusion: string }> {
  const intro = await getCommittedDraft(sessionId, 'intro');
  const body = await getCommittedDraft(sessionId, 'body');
  const conclusion = await getCommittedDraft(sessionId, 'conclusion');
  return {
    intro: intro?.content ?? '',
    body: body?.content ?? '',
    conclusion: conclusion?.content ?? '',
  };
}

/**
 * 본론에서 AI가 던진 반박 turn + 그 직후 학생 응답을 페어로 추출.
 * Closure 생성 시 LLM에게 컨텍스트로 제공.
 */
export async function getBodyRebuttalsText(sessionId: string): Promise<string> {
  const turns = await getAllTurns(sessionId);
  const bodyTurns = turns.filter((t) => t.phase === 'body');

  const lines: string[] = [];
  for (let i = 0; i < bodyTurns.length; i++) {
    const t = bodyTurns[i];
    if (t.role === 'assistant' && (t.tone === 'annoying' || t.domain === 'writing')) {
      lines.push(`[AI 반박] ${t.content}`);
      // 다음 turn이 student이면 응답으로 페어
      const next = bodyTurns[i + 1];
      if (next && next.role === 'student') {
        lines.push(`[학생 응답] ${next.content.slice(0, 200)}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}
