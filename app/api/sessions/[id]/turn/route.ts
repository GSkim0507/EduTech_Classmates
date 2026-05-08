import { NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import {
  getSession,
  getLatestDraft,
  getCommittedDraft,
  getAllTurns,
  getHelpCount,
  getRevisionCount,
  getNextTurnIdx,
  touchSession,
} from '@/lib/queries';
import { buildSystemPrompt } from '@/lib/persona';
import { calibrate, computeResponseComplexity, computeLexicalDiversity } from '@/lib/calibrator';
import { callClaude, evaluateDraft, type ChatMessage } from '@/lib/claude';
import type { ChatRequestInput, Phase, Tone, Domain, Signals } from '@/lib/types';

const VALID_TRIGGERS = ['submit', 'help', 'chat'] as const;

// POST /api/sessions/[id]/turn
//   trigger='help'   → 학생이 현재 draft에 대해 도움 요청
//   trigger='submit' → 학생이 현재 phase draft를 제출 (calibration 포함)
//   trigger='chat'   → 학생이 자유 채팅 메시지 전송
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let body: ChatRequestInput;
  try {
    body = (await request.json()) as ChatRequestInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { apiKey, trigger, studentMessage } = body;

  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: 'Claude API 키가 필요합니다.' },
      { status: 400 }
    );
  }
  if (!VALID_TRIGGERS.includes(trigger)) {
    return NextResponse.json({ error: 'Invalid trigger' }, { status: 400 });
  }

  if (session.current_phase === 'done') {
    return NextResponse.json(
      { error: '이 세션은 이미 종료되었습니다 (closure 완료).' },
      { status: 409 }
    );
  }

  const phase = session.current_phase as Exclude<Phase, 'done'>;

  // ─── 학생 turn 저장 ───
  const latestDraft = await getLatestDraft(id, phase);
  const studentContent =
    studentMessage?.trim() ||
    (trigger === 'help' || trigger === 'submit'
      ? latestDraft?.content ?? ''
      : '');

  if (trigger === 'chat' && !studentContent) {
    return NextResponse.json(
      { error: 'chat 트리거는 메시지 본문이 필요합니다.' },
      { status: 400 }
    );
  }

  const studentIdx = await getNextTurnIdx(id);
  const studentTurnResult = await db.execute({
    sql: `INSERT INTO turns
            (session_id, idx, phase, role, content, triggered_by, related_draft_id, timestamp)
          VALUES (?, ?, ?, 'student', ?, ?, ?, ?)`,
    args: [
      id,
      studentIdx,
      phase,
      studentContent,
      trigger,
      latestDraft?.id ?? null,
      now(),
    ],
  });
  const studentTurnId = Number(studentTurnResult.lastInsertRowid);

  // ─── (submit/help) calibration 실행 ───
  let nextTone: Tone = 'less-annoying';
  let nextDomain: Domain = 'idea';
  let weakestDimension: string | null = null;
  let signals: Signals = {};

  if ((trigger === 'submit' || trigger === 'help') && latestDraft) {
    // 평가 시 이전 phase 글도 컨텍스트로 제공
    const precedingDraft: { intro?: string; body?: string } = {};
    if (phase !== 'intro') {
      const introCommit = await getCommittedDraft(id, 'intro');
      if (introCommit) precedingDraft.intro = introCommit.content;
    }
    if (phase === 'conclusion') {
      const bodyCommit = await getCommittedDraft(id, 'body');
      if (bodyCommit) precedingDraft.body = bodyCommit.content;
    }

    let evalScores: Record<string, number | null> = {};
    try {
      evalScores = await evaluateDraft({
        apiKey,
        draftText: latestDraft.content,
        phase,
        topic: session.topic,
        precedingDraft,
      });
    } catch (err) {
      console.warn('[turn] evaluateDraft failed:', err);
    }

    const helpCount = await getHelpCount(id, phase);
    const revisionCount = await getRevisionCount(id, phase);

    signals = {
      ...evalScores,
      help_request_count: helpCount,
      self_revision_count: revisionCount,
      response_complexity: computeResponseComplexity(latestDraft.content),
      lexical_diversity: computeLexicalDiversity(latestDraft.content),
    };

    const calib = calibrate({ phase, signals });
    nextTone = calib.nextTone;
    nextDomain = calib.nextDomain;
    weakestDimension = calib.weakestDimension;

    await db.execute({
      sql: `INSERT INTO calibrations
              (session_id, phase, trigger, draft_id, signals_json,
               next_tone, next_domain, weakest_dimension, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        phase,
        trigger,
        latestDraft.id,
        JSON.stringify(signals),
        nextTone,
        nextDomain,
        weakestDimension,
        now(),
      ],
    });
  }

  // ─── 시스템 프롬프트 빌드 + LLM 호출 ───
  const systemPrompt = buildSystemPrompt({
    session,
    tone: nextTone,
    domain: nextDomain,
    phase,
    weakestDimension,
  });

  const allTurns = await getAllTurns(id);
  const messages: ChatMessage[] = allTurns
    // 마지막 student turn 포함
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
            (session_id, idx, phase, role, content, triggered_by,
             related_draft_id, tone, domain, timestamp)
          VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      assistantIdx,
      phase,
      assistantMessage,
      trigger,
      latestDraft?.id ?? null,
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
      trigger !== 'chat'
        ? { nextTone, nextDomain, weakestDimension, signals }
        : undefined,
  });
}
