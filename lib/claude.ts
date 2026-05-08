import Anthropic from '@anthropic-ai/sdk';
import { FIVE_DIMENSIONS } from './curriculum';

// ──────────────────────────────────────────────────────────
// Claude API wrapper
// ──────────────────────────────────────────────────────────

// 사용자가 채팅에 입력한 키를 매 요청마다 사용 (서버에 영구 저장 안 함)
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallClaudeParams {
  apiKey: string;
  systemPrompt: string;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export async function callClaude({
  apiKey,
  systemPrompt,
  messages,
  model = DEFAULT_MODEL,
  maxTokens = 1024,
  temperature = 0.7,
}: CallClaudeParams): Promise<string> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages,
  });

  const textBlocks = response.content.filter((b) => b.type === 'text');
  return textBlocks
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');
}

// ──────────────────────────────────────────────────────────
// 5개 평가요소 LLM 정성 평가
// ──────────────────────────────────────────────────────────

export interface EvaluateDraftInput {
  apiKey: string;
  draftText: string;
  phase: 'intro' | 'body' | 'conclusion';
  topic: string;
  /** body/conclusion일 때 직전 phase의 글 (맥락 제공용) */
  precedingDraft?: { intro?: string; body?: string };
}

const PHASE_LABEL: Record<EvaluateDraftInput['phase'], string> = {
  intro: '서론',
  body: '본론',
  conclusion: '결론',
};

export async function evaluateDraft(
  input: EvaluateDraftInput
): Promise<Record<string, number | null>> {
  const { apiKey, draftText, phase, topic, precedingDraft } = input;

  const dimensionsText = FIVE_DIMENSIONS.map(
    (d) => `- ${d.id} (${d.label}): ${d.prompt}`
  ).join('\n');

  const systemPrompt = `너는 한국 초등 4-6학년 주장글쓰기 평가자다. 학생의 글을 5개 평가요소로 평가해서 각각 0과 1 사이의 소수로 점수를 매긴다 (0=매우 약함, 1=매우 우수). 평가 자체로는 친절할 필요 없이 객관적으로.

5개 평가요소:
${dimensionsText}

페이즈에 따라 측정 어려운 항목은 null로 표시한다.
- 서론: 보통 claim_clarity와 expression_appropriateness만 측정 가능. 나머지는 null.
- 본론: 5개 모두 측정 가능 (단, structural_coherence는 부분적).
- 결론: 5개 모두 측정 가능.

반드시 아래 JSON 형식으로만 응답한다.
\`\`\`json
{
  "claim_clarity": 0.0~1.0 또는 null,
  "evidence_appropriateness": 0.0~1.0 또는 null,
  "evidence_relevance": 0.0~1.0 또는 null,
  "expression_appropriateness": 0.0~1.0 또는 null,
  "structural_coherence": 0.0~1.0 또는 null,
  "notes": "왜 이렇게 점수를 줬는지 1-2문장 한국어"
}
\`\`\``;

  let userContent = `[주제] ${topic}\n[평가 페이즈] ${PHASE_LABEL[phase]}\n\n`;
  if (phase !== 'intro' && precedingDraft) {
    if (precedingDraft.intro) {
      userContent += `[서론 (참고)]\n${precedingDraft.intro}\n\n`;
    }
    if (phase === 'conclusion' && precedingDraft.body) {
      userContent += `[본론 (참고)]\n${precedingDraft.body}\n\n`;
    }
  }
  userContent += `[현재 페이즈 학생 글]\n${draftText || '(아직 작성 안 함)'}`;

  const raw = await callClaude({
    apiKey,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    temperature: 0.2,
    maxTokens: 512,
  });

  // JSON 추출
  const blockMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
  const objMatch = !blockMatch ? raw.match(/\{[\s\S]*\}/) : null;
  const jsonStr = blockMatch ? blockMatch[1] : objMatch ? objMatch[0] : null;

  if (!jsonStr) {
    console.warn('[evaluateDraft] no JSON in response, returning empty.');
    return {};
  }

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const result: Record<string, number | null> = {};
    for (const dim of FIVE_DIMENSIONS) {
      const v = parsed[dim.id];
      if (typeof v === 'number') {
        result[dim.id] = Math.max(0, Math.min(1, v));
      } else if (v === null) {
        result[dim.id] = null;
      }
    }
    return result;
  } catch (err) {
    console.warn('[evaluateDraft] JSON parse error:', err);
    return {};
  }
}
