import { NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import {
  getSession,
  getLatestDraftParagraph,
  getCommittedDraftParagraph,
  getCommittedBodyParagraphs,
  getAllTurns,
  getHelpCount,
  getRevisionCount,
  getNextTurnIdx,
  getLatestCalibration,
  touchSession,
} from '@/lib/queries';
import { buildSystemPrompt } from '@/lib/persona';
import {
  calibrate,
  computeResponseComplexity,
  computeLexicalDiversity,
} from '@/lib/calibrator';
import { callClaude, evaluateDraft, type ChatMessage } from '@/lib/claude';
import type {
  TurnRequestInput,
  Phase,
  Tone,
  Domain,
  Signals,
  CurriculumSignals,
  HelpDomain,
  PrecedingContent,
} from '@/lib/types';

const VALID_TRIGGERS = ['submit', 'help'] as const;
const VALID_HELP_DOMAINS: HelpDomain[] = ['idea', 'writing', 'both'];

// POST /api/sessions/[id]/turn
//   trigger='help'   → 학생이 helpDomain 명시 선택 → 그 영역만 친구가 응답
//   trigger='submit' → 시스템이 자동 평가 (evaluateDraft + calibrate) + 게임 페르소나 응답
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let body: TurnRequestInput;
  try {
    body = (await request.json()) as TurnRequestInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { trigger, helpDomain, studentMessage } = body;
  // 클라이언트 입력 우선, 없으면 서버 환경변수 fallback
  const apiKey = body.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Claude API 키가 설정되지 않았습니다 (서버 환경변수 + 클라이언트 입력 모두 비어있음).' },
      { status: 400 }
    );
  }
  if (!VALID_TRIGGERS.includes(trigger as 'submit' | 'help')) {
    return NextResponse.json({ error: 'Invalid trigger (submit | help)' }, { status: 400 });
  }
  if (trigger === 'help' && (!helpDomain || !VALID_HELP_DOMAINS.includes(helpDomain))) {
    return NextResponse.json(
      { error: 'help trigger requires helpDomain (idea | writing | both)' },
      { status: 400 }
    );
  }
  if (session.current_phase === 'done') {
    return NextResponse.json({ error: '이미 종료된 세션입니다.' }, { status: 409 });
  }

  // ─── help 카드 잔여 검증 ───
  // body: 같은 paragraph_idx 단위 / 그 외: phase 단위
  if (trigger === 'help') {
    const phaseForCount = session.current_phase as Phase;
    const paraForCount =
      phaseForCount === 'body' && body.paragraphIdx !== null && body.paragraphIdx !== undefined
        ? Number(body.paragraphIdx)
        : null;
    const HELP_LIMIT = 2;
    const allTurnsForLimit = await getAllTurns(id);
    const usedHelp = allTurnsForLimit.filter((t) => {
      if (t.role !== 'student') return false;
      if (t.triggered_by !== 'help') return false;
      if (t.phase !== phaseForCount) return false;
      if (phaseForCount === 'body') {
        return t.paragraph_idx === paraForCount;
      }
      return true;
    }).length;
    if (usedHelp >= HELP_LIMIT) {
      return NextResponse.json(
        {
          error:
            '이 부분의 도움 카드를 모두 썼어요. 친구 설득하기로 평가 받아보거나 다음 부분으로 넘어가세요.',
        },
        { status: 429 }
      );
    }
  }

  const phase = session.current_phase as Exclude<Phase, 'done'>;
  // body 페이즈는 paragraphIdx가 없으면 본론 전체 모드 (UX 단순화)
  const isBodyAllMode =
    phase === 'body' && (body.paragraphIdx === null || body.paragraphIdx === undefined);
  const paragraphIdx = typeof body.paragraphIdx === 'number' ? body.paragraphIdx : 0;

  // ─── 학생 turn 저장 ───
  // body 전체 모드 — 모든 paragraph의 최신 draft를 합침
  let latestDraft: Awaited<ReturnType<typeof getLatestDraftParagraph>> = null;
  let combinedDraftText = '';
  if (isBodyAllMode) {
    // 본론 모든 paragraph (0~4) 중 작성된 것 합침
    const parts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = await getLatestDraftParagraph(id, phase, i);
      if (d?.content?.trim()) {
        parts.push(`(${i + 1}문단) ${d.content}`);
        if (!latestDraft) latestDraft = d; // 대표 draft (logging용)
      }
    }
    combinedDraftText = parts.join('\n\n');
  } else {
    latestDraft = await getLatestDraftParagraph(id, phase, paragraphIdx);
    combinedDraftText = latestDraft?.content || '';
  }
  const studentContent = studentMessage?.trim() || combinedDraftText || '';

  if (!studentContent.trim()) {
    return NextResponse.json(
      { error: '먼저 글을 조금이라도 써 주세요.' },
      { status: 400 }
    );
  }

  const studentIdx = await getNextTurnIdx(id);
  const studentTurnResult = await db.execute({
    sql: `INSERT INTO turns
            (session_id, idx, phase, paragraph_idx, role, content,
             triggered_by, help_domain, related_draft_id, timestamp)
          VALUES (?, ?, ?, ?, 'student', ?, ?, ?, ?, ?)`,
    args: [
      id,
      studentIdx,
      phase,
      // body 전체 모드면 paragraph_idx=null, 단일 모드면 idx
      phase === 'body' && !isBodyAllMode ? paragraphIdx : null,
      studentContent,
      trigger,
      trigger === 'help' ? (helpDomain ?? null) : null,
      latestDraft?.id ?? null,
      now(),
    ],
  });
  const studentTurnId = Number(studentTurnResult.lastInsertRowid);

  // ─── preceding 컨텍스트 수집 ───
  const preceding: PrecedingContent = {};
  if (phase !== 'intro') {
    const introCommit = await getCommittedDraftParagraph(id, 'intro', 0);
    if (introCommit) preceding.intro = introCommit.content;
  }
  if (phase === 'body' && paragraphIdx > 0) {
    const allBody = await getCommittedBodyParagraphs(id);
    preceding.bodyParagraphs = allBody
      .filter((p) => p.paragraph_idx < paragraphIdx)
      .map((p) => p.content);
  }
  if (phase === 'conclusion' || phase === 'title') {
    const allBody = await getCommittedBodyParagraphs(id);
    preceding.bodyParagraphs = allBody.map((p) => p.content);
  }
  if (phase === 'title') {
    const conclCommit = await getCommittedDraftParagraph(id, 'conclusion', 0);
    if (conclCommit) preceding.conclusion = conclCommit.content;
  }

  // ─── tone/domain/calibration 결정 ───
  let nextTone: Tone = 'less-annoying';
  let nextDomain: Domain = 'idea';
  let weakestViolationLabel: string | null = null;
  let signals: Signals = {};
  let curriculumSignals: CurriculumSignals | null = null;
  let calibrationId: number | null = null;

  if (trigger === 'submit' && (latestDraft || isBodyAllMode)) {
    // LLM 평가 (5 평가요소 + 헌법 신호)
    // body 전체 모드면 combinedDraftText 사용, 단일 모드면 latestDraft.content
    const evalDraftText = isBodyAllMode ? combinedDraftText : (latestDraft?.content ?? '');
    try {
      const evalResult = await evaluateDraft({
        apiKey,
        draftText: evalDraftText,
        phase,
        topic: session.topic,
        paragraphIdx: phase === 'body' && !isBodyAllMode ? paragraphIdx : undefined,
        preceding,
      });
      signals = { ...evalResult.scores, notes: evalResult.notes };
      curriculumSignals = evalResult.curriculum;
    } catch (err) {
      console.warn('[turn] evaluateDraft failed:', err);
    }

    // 행동 신호
    signals.help_request_count = await getHelpCount(
      id,
      phase,
      phase === 'body' && !isBodyAllMode ? paragraphIdx : null
    );
    signals.self_revision_count = await getRevisionCount(
      id,
      phase,
      phase === 'body' && !isBodyAllMode ? paragraphIdx : null
    );
    signals.response_complexity = computeResponseComplexity(evalDraftText);
    signals.lexical_diversity = computeLexicalDiversity(evalDraftText);

    // calibrate
    const calib = calibrate({
      phase,
      paragraphIdx: phase === 'body' && !isBodyAllMode ? paragraphIdx : undefined,
      signals,
      curriculumSignals,
    });
    nextTone = calib.nextTone;
    nextDomain = calib.nextDomain;
    weakestViolationLabel = calib.weakestViolationLabel;

    // calibration 저장
    const calibRow = await db.execute({
      sql: `INSERT INTO calibrations
              (session_id, phase, paragraph_idx, trigger, draft_id,
               signals_json, curriculum_signals_json, next_tone, next_domain,
               weakest_violation_label, timestamp)
            VALUES (?, ?, ?, 'submit', ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        phase,
        phase === 'body' && !isBodyAllMode ? paragraphIdx : null,
        latestDraft?.id ?? 0,
        JSON.stringify(signals),
        curriculumSignals ? JSON.stringify(curriculumSignals) : null,
        nextTone,
        nextDomain,
        weakestViolationLabel,
        now(),
      ],
    });
    calibrationId = Number(calibRow.lastInsertRowid);
  } else if (trigger === 'help') {
    // help는 calibrator 안 부름. 직전 calibration의 tone 유지 + helpDomain → domain.
    const lastCalib = await getLatestCalibration(id);
    nextTone = (lastCalib?.next_tone as Tone) ?? 'less-annoying';
    nextDomain =
      helpDomain === 'idea'
        ? 'idea'
        : helpDomain === 'writing'
          ? 'writing'
          : 'idea';
    weakestViolationLabel = lastCalib?.weakest_violation_label ?? null;
  }

  // ─── revision 메타데이터 계산 ───
  // 같은 phase + paragraph_idx에서 student turn (submit/help)이 몇 번째인지
  const allTurns = await getAllTurns(id);
  const sameContextStudentTurns = allTurns.filter((t) => {
    if (t.role !== 'student') return false;
    if (t.phase !== phase) return false;
    if (phase === 'body') {
      // body 전체 모드(null)와 단일 모드(idx) 구분
      const targetIdx = isBodyAllMode ? null : paragraphIdx;
      return t.paragraph_idx === targetIdx;
    }
    return true;
  });
  const revisionIdx = sameContextStudentTurns.length; // 이번 turn 포함 안 한 직전까지 카운트
  const previousVersion =
    revisionIdx > 0
      ? sameContextStudentTurns[sameContextStudentTurns.length - 1].content
      : null;

  // ─── 시스템 프롬프트 빌드 + LLM 호출 ───
  const systemPrompt = buildSystemPrompt({
    session,
    tone: nextTone,
    domain: nextDomain,
    phase,
    paragraphIdx: phase === 'body' && !isBodyAllMode ? paragraphIdx : null,
    weakestViolationLabel,
    preceding,
    forcedHelpDomain: trigger === 'help' ? helpDomain ?? null : null,
    revisionIdx,
    previousVersion,
  });

  // history 정리: 같은 phase·paragraph 내 마지막 student-assistant pair만 + 다른 phase는 요약 생략
  // → LLM이 "또 같은 거 봤다" 인지하지 않도록 history를 단순화
  const recentSameContext = sameContextStudentTurns.slice(-1); // 직전 student turn 하나만
  const recentSameContextIds = new Set(recentSameContext.map((t) => t.id));

  // 직전 student turn 다음에 오는 assistant turn (같은 idx 또는 그 직후)
  const recentAssistantIds = new Set<number>();
  for (const t of allTurns) {
    if (t.role !== 'assistant') continue;
    // 같은 phase·paragraph_idx 매칭
    if (t.phase !== phase) continue;
    if (phase === 'body') {
      const targetIdx = isBodyAllMode ? null : paragraphIdx;
      if (t.paragraph_idx !== targetIdx) continue;
    }
    recentAssistantIds.add(t.id);
  }

  const messages: ChatMessage[] = allTurns
    .filter((t) => recentSameContextIds.has(t.id) || recentAssistantIds.has(t.id))
    .slice(-6) // 안전: 최대 최근 6개 turn
    .map((t) => ({
      role: t.role === 'student' ? ('user' as const) : ('assistant' as const),
      content: t.content,
    }));

  let assistantMessage: string;
  try {
    assistantMessage = await callClaude({
      apiKey,
      systemPrompt,
      messages,
      temperature: 0.7,
      maxTokens: 600,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Claude API 호출 실패',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  // ─── assistant turn 저장 ───
  const assistantIdx = studentIdx + 1;
  const assistantResult = await db.execute({
    sql: `INSERT INTO turns
            (session_id, idx, phase, paragraph_idx, role, content,
             triggered_by, help_domain, related_draft_id, calibration_id,
             tone, domain, timestamp)
          VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      assistantIdx,
      phase,
      phase === 'body' && !isBodyAllMode ? paragraphIdx : null,
      assistantMessage,
      trigger,
      trigger === 'help' ? (helpDomain ?? null) : null,
      latestDraft?.id ?? null,
      calibrationId,
      nextTone,
      nextDomain,
      now(),
    ],
  });

  await touchSession(id);

  return NextResponse.json({
    studentTurnId,
    assistantTurnId: Number(assistantResult.lastInsertRowid),
    assistantMessage,
    tone: nextTone,
    domain: nextDomain,
    calibration:
      trigger === 'submit'
        ? {
            nextTone,
            nextDomain,
            weakestViolationLabel,
            signals,
            curriculumSignals,
          }
        : undefined,
  });
}
