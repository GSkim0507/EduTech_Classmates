import type {
  ClosureType,
  ClosureRationale,
  ClosureAxisAssessment,
  ClosureResponseOutput,
} from './types';

// ──────────────────────────────────────────────────────────
// Persuasion Closure — LLM JSON 응답 파싱 (v3: 3축 평가 + persuasion 훅)
// ──────────────────────────────────────────────────────────

const VALID_TYPES: ClosureType[] = ['full', 'partial', 'impasse'];

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function parseAxis(raw: unknown): ClosureAxisAssessment | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const score =
    typeof o.score === 'number'
      ? Math.max(0, Math.min(100, Math.round(o.score)))
      : null;
  const comment =
    typeof o.comment === 'string' && o.comment.trim().length > 0
      ? o.comment.trim()
      : null;
  if (score === null && !comment) return undefined;
  return {
    score: score ?? 50,
    comment: comment ?? '(코멘트 없음)',
    passed: asStringArray(o.passed),
    failed: asStringArray(o.failed),
  };
}

// LLM이 보내는 비표준 JSON 흔한 케이스를 정규화.
// - Smart quotes(“ ” ‘ ’) → ASCII
// - 마지막 요소 뒤 trailing comma 제거
function normalizeJsonText(s: string): string {
  return s
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/,(\s*[}\]])/g, '$1');
}

// 잘려서 닫는 괄호가 부족한 경우 마지막 } 까지만 잘라본다 (best-effort).
function recoverTruncatedJson(s: string): string | null {
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace < 0) return null;
  return s.slice(0, lastBrace + 1);
}

export function parseClosureResponse(rawText: string): ClosureResponseOutput {
  // ```json ... ``` 또는 ``` ... ``` 블록 또는 raw {} 순으로 추출
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let jsonStr: string;
  if (fenced) {
    jsonStr = fenced[1];
  } else {
    // 가장 바깥 { ... }를 greedy로 잡아낸다
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) {
      throw new Error('Closure response does not contain valid JSON.');
    }
    jsonStr = rawText.slice(start, end + 1);
  }

  jsonStr = normalizeJsonText(jsonStr.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err1) {
    // 잘렸을 가능성 — 마지막 } 까지로 잘라 다시 시도
    const recovered = recoverTruncatedJson(jsonStr);
    if (recovered && recovered !== jsonStr) {
      try {
        parsed = JSON.parse(normalizeJsonText(recovered));
      } catch (err2) {
        throw new Error(
          `Closure JSON parse failed (recovery attempted): ${(err2 as Error).message}`
        );
      }
    } else {
      throw new Error(`Closure JSON parse failed: ${(err1 as Error).message}`);
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Closure response is not an object.');
  }

  const obj = parsed as Record<string, unknown>;
  const closureType = obj.closure_type;
  if (typeof closureType !== 'string' || !VALID_TYPES.includes(closureType as ClosureType)) {
    throw new Error(`Invalid closure_type: ${String(closureType)}`);
  }

  const persuasionPct =
    typeof obj.persuasion_pct === 'number'
      ? Math.max(0, Math.min(100, Math.round(obj.persuasion_pct)))
      : closureType === 'full'
        ? 95
        : closureType === 'partial'
          ? 60
          : 15;

  const agentMessage =
    typeof obj.agent_message === 'string' && obj.agent_message.trim().length > 0
      ? obj.agent_message.trim()
      : '(메시지 없음)';

  const rationaleObj = (obj.rationale ?? {}) as Record<string, unknown>;

  // v3: 3축 평가 + persuasion 훅
  const structure = parseAxis(rationaleObj.structure_assessment);
  const content = parseAxis(rationaleObj.content_assessment);
  const feedback = parseAxis(rationaleObj.feedback_acceptance);
  const persuasionHook =
    typeof rationaleObj.persuasion_hook === 'string'
      && rationaleObj.persuasion_hook.trim().length > 0
      ? rationaleObj.persuasion_hook.trim()
      : `결론적으로 나는 네 주장에 ${persuasionPct}% 확신이 들었어.`;

  const rationale: ClosureRationale = {
    structure_assessment: structure,
    content_assessment: content,
    feedback_acceptance: feedback,
    persuasion_hook: persuasionHook,
    // 호환 필드 — 예전 포맷이 들어오면 그대로
    passed: asStringArray(rationaleObj.passed),
    failed: asStringArray(rationaleObj.failed),
    reasoning: typeof rationaleObj.reasoning === 'string' ? rationaleObj.reasoning : undefined,
  };

  return {
    closureType: closureType as ClosureType,
    persuasionPct,
    agentMessage,
    rationale,
  };
}
