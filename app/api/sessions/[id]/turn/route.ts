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

  const { apiKey, trigger, helpDomain, studentMessage } = body;

  if (!apiKey?.trim()) {
    return NextResponse.json({ error: 'Claude API 키가 필요합니다.' }, { status: 400 });
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

  const phase = session.current_phase as Exclude<Phase, 'done'>;
  const paragraphIdx =
    typeof body.paragraphIdx === 'number'
      ? body.paragraphIdx
      : phase === 'body'
        ? 0
        : 0;

  // ─── 학생 turn 저장 ───
  const latestDraft = await getLatestDraftParagraph(id, phase, paragraphIdx);
  const studentContent = studentMessage?.trim() || latestDraft?.content || '';

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
      phase === 'body' ? paragraphIdx : null,
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
  if (phase === 'conclusion') {
    const allBody = await getCommittedBodyParagraphs(id);
    preceding.bodyParagraphs = allBody.map((p) => p.content);
  }

  // ─── tone/domain/calibration 결정 ───
  let nextTone: Tone = 'less-annoying';
  let nextDomain: Domain = 'idea';
  let weakestViolationLabel: string | null = null;
  let signals: Signals = {};
  let curriculumSignals: CurriculumSignals | null = null;
  let calibrationId: number | null = null;

  if (trigger === 'submit' && latestDraft) {
    // LLM 평가 (5 평가요소 + 헌법 신호)
    try {
      const evalResult = await evaluateDraft({
        apiKey,
        draftText: latestDraft.content,
        phase,
        topic: session.topic,
        paragraphIdx: phase === 'body' ? paragraphIdx : undefined,
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
      phase === 'body' ? paragraphIdx : null
    );
    signals.self_revision_count = await getRevisionCount(
      id,
      phase,
      phase === 'body' ? paragraphIdx : null
    );
    signals.response_complexity = computeResponseComplexity(latestDraft.content);
    signals.lexical_diversity = computeLexicalDiversity(latestDraft.content);

    // calibrate
    const calib = calibrate({ phase, paragraphIdx, signals, curriculumSignals });
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
        phase === 'body' ? paragraphIdx : null,
        latestDraft.id,
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

  // ─── 시스템 프롬프트 빌드 + LLM 호출 ───
  const systemPrompt = buildSystemPrompt({
    session,
    tone: nextTone,
    domain: nextDomain,
    phase,
    paragraphIdx: phase === 'body' ? paragraphIdx : null,
    weakestViolationLabel,
    preceding,
    forcedHelpDomain: trigger === 'help' ? helpDomain ?? null : null,
  });

  const allTurns = await getAllTurns(id);
  const messages: ChatMessage[] = allTurns.map((t) => ({
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
      phase === 'body' ? paragraphIdx : null,
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
