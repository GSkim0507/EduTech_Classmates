import Anthropic from '@anthropic-ai/sdk';
import { FIVE_DIMENSIONS } from './curriculum';
import type {
  CurriculumSignals,
  PrecedingContent,
  IntroCurriculumSignals,
  BodyCurriculumSignals,
  ConclusionCurriculumSignals,
} from './types';

// ──────────────────────────────────────────────────────────
// Claude API wrapper
// ──────────────────────────────────────────────────────────

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
// 5개 평가요소 + 페이즈별 헌법 신호 LLM 정성 평가
// ──────────────────────────────────────────────────────────

export interface EvaluateDraftInput {
  apiKey: string;
  draftText: string;
  phase: 'intro' | 'body' | 'conclusion';
  topic: string;
  paragraphIdx?: number;          // 본론 i문단 평가 시 i (0-based)
  preceding?: PrecedingContent;   // 직전 phase/문단 commit 본
}

export interface EvaluateDraftOutput {
  scores: Record<string, number | null>;
  curriculum: CurriculumSignals | null;
  notes?: string;
}

const PHASE_LABEL_KO: Record<EvaluateDraftInput['phase'], string> = {
  intro: '서론',
  body: '본론',
  conclusion: '결론',
};

function buildEvaluatePrompt(input: EvaluateDraftInput): string {
  const dims = FIVE_DIMENSIONS.map((d) => `- ${d.id} (${d.label}): ${d.prompt}`).join('\n');

  let curriculumSchema = '';
  if (input.phase === 'intro') {
    curriculumSchema = `
"curriculum": {
  "phase": "intro",
  "thesis_present": boolean,
  "thesis_singular": boolean,
  "thesis_assertive_form": boolean,
  "intro_method_label": "문제 상황 직접 제시" | "직접 경험" | "간접 경험" | "큰 개념에서 작은 개념" | "중심 낱말 풀이" | "속담·명언" | null
}`;
  } else if (input.phase === 'body') {
    curriculumSchema = `
"curriculum": {
  "phase": "body",
  "paragraph_idx": ${input.paragraphIdx ?? 0},
  "topic_sentence_present": boolean,
  "argument_method_identifiable": boolean,
  "argument_method_label": "부연" | "예증" | "비유" | "방법 제시" | "인과" | null,
  "appropriateness_to_thesis": 0.0~1.0,
  "appropriateness_to_preceding": 0.0~1.0,
  "link_word_used": boolean
}`;
  } else {
    curriculumSchema = `
"curriculum": {
  "phase": "conclusion",
  "summary_present": boolean,
  "summary_concise": boolean,
  "punch_line_present": boolean,
  "punch_line_method_label": "주장 재강조" | "미래 전망" | "속담·명언" | null,
  "no_new_argument": boolean,
  "thesis_recall_clear": boolean
}`;
  }

  return `너는 한국 초등 4-6학년 주장글쓰기 평가자다. 학생의 글을 두 갈래로 평가해서 JSON 객체로만 응답하라.

## 갈래 A: 5개 평가요소 점수 (0~1, 측정 불가하면 null)
${dims}

페이즈별 측정 가능성 가이드:
- 서론(짧음): claim_clarity, expression_appropriateness 위주. 나머지는 null 허용.
- 본론 i문단: 5개 모두 측정 가능 (단, structural_coherence는 부분적).
- 결론: 5개 모두 측정 가능.

## 갈래 B: 헌법 신호 (boolean / 0~1)
${curriculumSchema}

## 응답 형식 (JSON만)
\`\`\`json
{
  "scores": {
    "claim_clarity": 0.0~1.0 또는 null,
    "evidence_appropriateness": 0.0~1.0 또는 null,
    "evidence_relevance": 0.0~1.0 또는 null,
    "expression_appropriateness": 0.0~1.0 또는 null,
    "structural_coherence": 0.0~1.0 또는 null
  },${curriculumSchema},
  "notes": "왜 이렇게 점수를 줬는지 1-2문장 한국어"
}
\`\`\``;
}

function buildEvaluateUserMessage(input: EvaluateDraftInput): string {
  let msg = `[주제] ${input.topic}\n[평가 페이즈] ${PHASE_LABEL_KO[input.phase]}`;
  if (input.phase === 'body' && typeof input.paragraphIdx === 'number') {
    msg += ` ${input.paragraphIdx + 1}문단`;
  }
  msg += '\n\n';

  if (input.preceding?.intro) {
    msg += `[서론 (commit, 참고)]\n${input.preceding.intro}\n\n`;
  }
  if (input.preceding?.bodyParagraphs?.length) {
    input.preceding.bodyParagraphs.forEach((p, i) => {
      msg += `[본론 ${i + 1}문단 (commit, 참고)]\n${p}\n\n`;
    });
  }

  msg += `[평가 대상 — 현재 ${PHASE_LABEL_KO[input.phase]}]\n${input.draftText || '(아직 작성 안 함)'}`;
  return msg;
}

export async function evaluateDraft(
  input: EvaluateDraftInput
): Promise<EvaluateDraftOutput> {
  const systemPrompt = buildEvaluatePrompt(input);
  const userMessage = buildEvaluateUserMessage(input);

  const raw = await callClaude({
    apiKey: input.apiKey,
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    temperature: 0.2,
    maxTokens: 800,
  });

  // JSON 추출
  const blockMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
  const objMatch = !blockMatch ? raw.match(/\{[\s\S]*\}/) : null;
  const jsonStr = blockMatch ? blockMatch[1] : objMatch ? objMatch[0] : null;

  if (!jsonStr) {
    console.warn('[evaluateDraft] no JSON in response.');
    return { scores: {}, curriculum: null };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.warn('[evaluateDraft] JSON parse error:', err);
    return { scores: {}, curriculum: null };
  }

  // scores 정리
  const rawScores = (parsed.scores ?? {}) as Record<string, unknown>;
  const scores: Record<string, number | null> = {};
  for (const dim of FIVE_DIMENSIONS) {
    const v = rawScores[dim.id];
    if (typeof v === 'number') scores[dim.id] = Math.max(0, Math.min(1, v));
    else if (v === null) scores[dim.id] = null;
  }

  // curriculum 정리
  let curriculum: CurriculumSignals | null = null;
  const rawCur = parsed.curriculum as Record<string, unknown> | undefined;
  if (rawCur && typeof rawCur === 'object') {
    if (input.phase === 'intro' && rawCur.phase === 'intro') {
      curriculum = {
        phase: 'intro',
        thesis_present: !!rawCur.thesis_present,
        thesis_singular: !!rawCur.thesis_singular,
        thesis_assertive_form: !!rawCur.thesis_assertive_form,
        intro_method_label:
          typeof rawCur.intro_method_label === 'string' ? rawCur.intro_method_label : null,
      } as IntroCurriculumSignals;
    } else if (input.phase === 'body' && rawCur.phase === 'body') {
      curriculum = {
        phase: 'body',
        paragraph_idx:
          typeof rawCur.paragraph_idx === 'number'
            ? rawCur.paragraph_idx
            : (input.paragraphIdx ?? 0),
        topic_sentence_present: !!rawCur.topic_sentence_present,
        argument_method_identifiable: !!rawCur.argument_method_identifiable,
        argument_method_label:
          typeof rawCur.argument_method_label === 'string' ? rawCur.argument_method_label : null,
        appropriateness_to_thesis: clampNum(rawCur.appropriateness_to_thesis),
        appropriateness_to_preceding: clampNum(rawCur.appropriateness_to_preceding),
        link_word_used: !!rawCur.link_word_used,
      } as BodyCurriculumSignals;
    } else if (input.phase === 'conclusion' && rawCur.phase === 'conclusion') {
      curriculum = {
        phase: 'conclusion',
        summary_present: !!rawCur.summary_present,
        summary_concise: !!rawCur.summary_concise,
        punch_line_present: !!rawCur.punch_line_present,
        punch_line_method_label:
          typeof rawCur.punch_line_method_label === 'string'
            ? rawCur.punch_line_method_label
            : null,
        no_new_argument: !!rawCur.no_new_argument,
        thesis_recall_clear: !!rawCur.thesis_recall_clear,
      } as ConclusionCurriculumSignals;
    }
  }

  return {
    scores,
    curriculum,
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
  };
}

function clampNum(v: unknown): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}
