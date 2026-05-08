import type { ClosureType, ClosureRationale, ClosureResponseOutput } from './types';

// ──────────────────────────────────────────────────────────
// Persuasion Closure — LLM JSON 응답 파싱
// ──────────────────────────────────────────────────────────

const VALID_TYPES: ClosureType[] = ['full', 'partial', 'impasse'];

export function parseClosureResponse(rawText: string): ClosureResponseOutput {
  // ```json ... ``` 블록 또는 raw {} 추출
  const blockMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
  let jsonStr: string;
  if (blockMatch) {
    jsonStr = blockMatch[1];
  } else {
    const objMatch = rawText.match(/\{[\s\S]*\}/);
    if (!objMatch) {
      throw new Error('Closure response does not contain valid JSON.');
    }
    jsonStr = objMatch[0];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Closure JSON parse failed: ${(err as Error).message}`);
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
  const rationale: ClosureRationale = {
    passed: Array.isArray(rationaleObj.passed)
      ? (rationaleObj.passed as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
    failed: Array.isArray(rationaleObj.failed)
      ? (rationaleObj.failed as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
    reasoning: typeof rationaleObj.reasoning === 'string' ? rationaleObj.reasoning : undefined,
  };

  return {
    closureType: closureType as ClosureType,
    persuasionPct,
    agentMessage,
    rationale,
  };
}
