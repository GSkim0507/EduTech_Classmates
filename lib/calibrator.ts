import type { Phase, Tone, Domain, Signals } from './types';
import { FIVE_DIMENSIONS, dimensionLabel } from './curriculum';

// ──────────────────────────────────────────────────────────
// Phase-level Dynamic Recalibration
// 학생 산출물(draft) + 행동 신호 → 다음 페이즈의 (tone, domain) 결정
// ──────────────────────────────────────────────────────────

export interface CalibrationInput {
  phase: Phase;
  signals: Signals;
}

export interface CalibrationOutput {
  nextTone: Tone;
  nextDomain: Domain;
  weakestDimension: string | null;     // 한국어 라벨
  reason: string;                      // 디버그용 설명
}

/**
 * 5개 평가요소 + 행동 신호로부터 다음 모드 결정.
 * 사전 라벨링이 아닌 산출물 기반 동적 재추정.
 */
export function calibrate(input: CalibrationInput): CalibrationOutput {
  const { signals } = input;

  // 1. 평가요소 점수 추출 (null/undefined 제외)
  const evalPairs = FIVE_DIMENSIONS.map((d) => {
    const score = signals[d.id];
    return { id: d.id, label: d.label, score: typeof score === 'number' ? score : null };
  });

  const validScores = evalPairs
    .map((e) => e.score)
    .filter((v): v is number => typeof v === 'number');

  const avgEval =
    validScores.length > 0
      ? validScores.reduce((a, b) => a + b, 0) / validScores.length
      : 0.5;

  // 2. 가장 약한 평가요소
  let weakest: { label: string; score: number } | null = null;
  for (const e of evalPairs) {
    if (e.score === null) continue;
    if (!weakest || e.score < weakest.score) {
      weakest = { label: e.label, score: e.score };
    }
  }

  // 3. 행동 신호
  const helpCount = signals.help_request_count ?? 0;
  const revisionCount = signals.self_revision_count ?? 0;

  // 학생이 자주 도움 요청 = 막힘 → less-annoying으로
  // 자기 수정이 많고 평균 점수도 좋음 = 잘 따라옴 → annoying으로 도전
  const studentStruggling = helpCount >= 2;
  const studentEngaged = revisionCount >= 1 && avgEval >= 0.7;

  let nextTone: Tone;
  if (studentStruggling) {
    nextTone = 'less-annoying';
  } else if (studentEngaged) {
    nextTone = 'annoying';
  } else if (avgEval >= 0.7) {
    nextTone = 'annoying';
  } else {
    nextTone = 'less-annoying';
  }

  // 4. domain 결정
  // - 5요소 중 명확하게 약한 게 있으면 → writing (그 약점을 짚기)
  // - 그렇지 않거나 페이즈 시작이면 → idea (자유 사고 자극)
  let nextDomain: Domain;
  if (weakest && weakest.score < 0.6) {
    nextDomain = 'writing';
  } else if (validScores.length === 0) {
    // 평가 점수 없음 → 글이 거의 없거나 측정 불가
    nextDomain = 'idea';
  } else {
    nextDomain = 'idea';
  }

  const reason = `avg=${avgEval.toFixed(2)}, weakest=${weakest?.label ?? 'n/a'}(${weakest?.score.toFixed(2) ?? '-'}), help=${helpCount}, revisions=${revisionCount} → ${nextTone}/${nextDomain}`;

  return {
    nextTone,
    nextDomain,
    weakestDimension: weakest?.label ?? null,
    reason,
  };
}

// ──────────────────────────────────────────────────────────
// 행동 신호 계산 헬퍼 (서버에서 DB 로그 기반)
// ──────────────────────────────────────────────────────────

/**
 * 텍스트 길이 기반 응답 복잡도 (0~1)
 * 200자 = 1.0 기준
 */
export function computeResponseComplexity(text: string): number {
  if (!text) return 0;
  const len = text.replace(/\s+/g, '').length;
  return Math.min(1, len / 200);
}

/**
 * 어휘 다양성 (TTR — type-token ratio, 0~1)
 */
export function computeLexicalDiversity(text: string): number {
  if (!text) return 0;
  const tokens = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return 0;
  const types = new Set(tokens);
  return types.size / tokens.length;
}

export { dimensionLabel };
