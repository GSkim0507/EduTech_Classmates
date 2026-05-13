import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * 세션별 JSON 저널 — 학생이 명시 액션(같이 고민 / 친구 설득 / 친구한테 보여주기 / 다음으로)을
 * 트리거할 때만 호출된다. 자동저장(sessionStorage)은 여기 기록되지 않는다.
 *
 * 파일 위치: data/sessions/[sessionId].json (.gitignore 처리됨)
 * 구조: { sessionId, createdAt, events: [{ type, timestamp, ...payload }] }
 */

export type JournalEventType =
  | 'draft_saved'           // flushAutosave가 액션 직전 1회 DB write 한 직후 미러
  | 'turn_student'          // 학생이 submit/help 트리거 → student turn row INSERT
  | 'turn_assistant'        // assistant 응답 turn row INSERT
  | 'commit'                // 페이즈/문단 commit
  | 'calibration'           // signals/curriculum signals INSERT
  | 'closure';              // 세션 종료 평가 (closure row INSERT)

export interface JournalEvent {
  type: JournalEventType;
  timestamp: string;
  [key: string]: unknown;
}

interface JournalFile {
  sessionId: string;
  createdAt: string;
  events: JournalEvent[];
}

function getJournalDir(): string {
  return path.join(process.cwd(), 'data', 'sessions');
}

function getJournalPath(sessionId: string): string {
  // sessionId는 nanoid 기반이라 path-safe하지만 방어적으로 검증
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error(`Invalid sessionId for journal: ${sessionId}`);
  }
  return path.join(getJournalDir(), `${sessionId}.json`);
}

async function readJournal(sessionId: string): Promise<JournalFile | null> {
  try {
    const raw = await fs.readFile(getJournalPath(sessionId), 'utf-8');
    return JSON.parse(raw) as JournalFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJournal(file: JournalFile): Promise<void> {
  await fs.mkdir(getJournalDir(), { recursive: true });
  const target = getJournalPath(file.sessionId);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
  await fs.rename(tmp, target);
}

/**
 * 세션 저널에 이벤트 1건 append. 파일 없으면 생성.
 * 실패해도 호출부의 DB 트랜잭션을 막지 않도록 throw 대신 console.warn.
 */
export async function appendJournalEvent(
  sessionId: string,
  event: JournalEvent
): Promise<void> {
  try {
    const existing = (await readJournal(sessionId)) ?? {
      sessionId,
      createdAt: new Date().toISOString(),
      events: [],
    };
    existing.events.push(event);
    await writeJournal(existing);
  } catch (err) {
    console.warn(`[sessionJournal] append failed for ${sessionId}:`, err);
  }
}
