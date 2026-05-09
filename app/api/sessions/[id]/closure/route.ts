import { NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import {
  getSession,
  getCommittedDraftsAll,
  getBodyRebuttalsText,
  getClosure,
  touchSession,
} from '@/lib/queries';
import { buildClosurePrompt } from '@/lib/persona';
import { callClaude } from '@/lib/claude';
import { parseClosureResponse } from '@/lib/closure';

interface ClosureBody {
  apiKey: string;
}

// POST /api/sessions/[id]/closure — 학생 글 전체 + 본론 반박 기록을 LLM에게 전달, closure 생성
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // 이미 closure 있으면 그대로 반환 (idempotent)
  const existing = await getClosure(id);
  if (existing) {
    return NextResponse.json({
      closureType: existing.closure_type,
      persuasionPct: existing.persuasion_pct,
      agentMessage: existing.agent_message,
      rationale: JSON.parse(existing.rationale_json),
      reused: true,
    });
  }

  let body: ClosureBody;
  try {
    body = (await request.json()) as ClosureBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Claude API 키가 설정되지 않았습니다 (서버 환경변수 + 클라이언트 입력 모두 비어있음).' },
      { status: 400 }
    );
  }

  if (session.current_phase !== 'done' && session.current_phase !== 'title') {
    return NextResponse.json(
      {
        error:
          '제목까지 확정한 후에 closure를 생성할 수 있습니다. (현재 phase: ' +
          session.current_phase +
          ')',
      },
      { status: 409 }
    );
  }

  const fullDraft = await getCommittedDraftsAll(id);
  const rebuttalsAndResponses = await getBodyRebuttalsText(id);

  const prompt = buildClosurePrompt({
    session,
    fullDraft,
    rebuttalsAndResponses,
  });

  // 최대 2회 시도 — 첫 실패 시 더 엄격한 지시로 retry
  async function callOnce(reinforce: boolean): Promise<string> {
    const userMsg = reinforce
      ? '직전 응답이 형식을 어겼어. 반드시 ```json 코드 블록 안에 명세된 모든 필드를 채운 JSON 하나만 답해. 코드 블록 밖에는 어떤 글자도 쓰지 마.'
      : '위 글에 대한 너의 closure를 위 형식대로 JSON으로 답해 줘.';
    return await callClaude({
      apiKey: apiKey!,
      systemPrompt: prompt,
      messages: [{ role: 'user', content: userMsg }],
      temperature: reinforce ? 0.2 : 0.4,
      // 3축 평가 + persuasion_hook + reasoning + agent_message → 800은 부족할 수 있음
      maxTokens: 1500,
    });
  }

  let raw = '';
  let parsed: ReturnType<typeof parseClosureResponse> | null = null;
  let lastParseError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      raw = await callOnce(attempt > 0);
    } catch (err) {
      // API 호출 자체 실패는 재시도해도 같은 결과 — 즉시 502
      return NextResponse.json(
        {
          error: 'Claude API 호출 실패',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 }
      );
    }
    try {
      parsed = parseClosureResponse(raw);
      break;
    } catch (err) {
      lastParseError = err instanceof Error ? err.message : String(err);
      // retry
    }
  }

  // 두 번 다 실패 — fallback closure 생성 (학생을 막지 않기 위해)
  if (!parsed) {
    console.warn('[closure] 2회 retry 후에도 파싱 실패 — fallback 사용:', lastParseError);
    parsed = {
      closureType: 'partial',
      persuasionPct: 60,
      agentMessage:
        '음... 솔직히 글 전체를 한 번 더 차근차근 읽어볼게. 일단 끝까지 쓴 건 인정! ' +
        '결론적으로 나는 네 주장에 60%쯤 확신이 들어.',
      rationale: {
        persuasion_hook: '결론적으로 나는 네 주장에 60% 확신이 들었어.',
        reasoning: '응답 형식 오류로 자동 fallback closure가 사용됐어요.',
        passed: [],
        failed: [],
      },
    };
  }

  await db.execute({
    sql: `INSERT INTO closures
            (session_id, closure_type, persuasion_pct, agent_message, rationale_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      parsed.closureType,
      parsed.persuasionPct,
      parsed.agentMessage,
      JSON.stringify(parsed.rationale),
      now(),
    ],
  });

  await db.execute({
    sql: `UPDATE sessions SET status = 'completed', current_phase = 'done', last_updated = ?
          WHERE id = ?`,
    args: [now(), id],
  });

  await touchSession(id);

  return NextResponse.json({
    closureType: parsed.closureType,
    persuasionPct: parsed.persuasionPct,
    agentMessage: parsed.agentMessage,
    rationale: parsed.rationale,
    reused: false,
  });
}
