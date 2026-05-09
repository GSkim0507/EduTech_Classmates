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

  if (!body.apiKey?.trim()) {
    return NextResponse.json({ error: 'Claude API 키가 필요합니다.' }, { status: 400 });
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

  let raw: string;
  try {
    raw = await callClaude({
      apiKey: body.apiKey,
      systemPrompt: prompt,
      messages: [
        {
          role: 'user',
          content: '위 글에 대한 너의 closure를 위 형식대로 JSON으로 답해 줘.',
        },
      ],
      temperature: 0.4,
      maxTokens: 800,
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

  let parsed;
  try {
    parsed = parseClosureResponse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Closure 응답 파싱 실패',
        detail: err instanceof Error ? err.message : String(err),
        raw,
      },
      { status: 500 }
    );
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
