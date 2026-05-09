import type {
  Phase,
  Tone,
  Domain,
  Signals,
  CurriculumSignals,
  IntroCurriculumSignals,
  BodyCurriculumSignals,
  ConclusionCurriculumSignals,
  TitleCurriculumSignals,
} from './types';
import {
  FIVE_DIMENSIONS,
  dimensionLabel,
  getCurriculumSignalLabel,
} from './curriculum';

// ──────────────────────────────────────────────────────────
// Phase-level Dynamic Recalibration (v2)
// 5 평가요소 + 헌법 신호 + 행동 신호 → 다음 페이즈의 (tone, domain) 결정
// 게임 페르소나: 잘 쓰면 annoying(친구 약오름) / 못 쓰면 less-annoying(친구 잘난 척)
// spec: docs/superpowers/specs/2026-05-09-system-redesign-design.md §4.5
// ──────────────────────────────────────────────────────────

export interface CalibrationInput {
  phase: Exclude<Phase, 'done'>;
  paragraphIdx?: number | null;
  signals: Signals;
  curriculumSignals: CurriculumSignals | null;
}

export interface CalibrationOutput {
  nextTone: Tone;
  nextDomain: Domain;
  weakestViolationLabel: string | null;
  reason: string;
  /** 0~100, 학생 점수 (승부 게이지용) */
  studentScore: number;
}

/**
 * 헌법 신호의 위반 카운트 + 가장 약한 신호 라벨 반환.
 */
function analyzeCurriculum(cur: CurriculumSignals | null): {
  violationCount: number;
  totalChecks: number;
  weakestLabel: string | null;
} {
  if (!cur) return { violationCount: 0, totalChecks: 0, weakestLabel: null };

  const violations: { key: string; severity: number }[] = [];

  if (cur.phase === 'intro') {
    const c = cur as IntroCurriculumSignals;
    if (!c.thesis_present) violations.push({ key: 'thesis_present', severity: 1.0 });
    if (!c.thesis_singular) violations.push({ key: 'thesis_singular', severity: 0.8 });
    if (!c.thesis_assertive_form)
      violations.push({ key: 'thesis_assertive_form', severity: 0.6 });
  } else if (cur.phase === 'body') {
    const c = cur as BodyCurriculumSignals;
    if (!c.topic_sentence_present)
      violations.push({ key: 'topic_sentence_present', severity: 1.0 });
    if (!c.argument_method_identifiable)
      violations.push({ key: 'argument_method_identifiable', severity: 0.9 });
    if (c.appropriateness_to_thesis < 0.5)
      violations.push({
        key: 'appropriateness_to_thesis',
        severity: 1.0 - c.appropriateness_to_thesis,
      });
    if (c.appropriateness_to_preceding < 0.5)
      violations.push({
        key: 'appropriateness_to_preceding',
        severity: 1.0 - c.appropriateness_to_preceding,
      });
    if (!c.link_word_used)
      violations.push({ key: 'link_word_used', severity: 0.4 });
  } else if (cur.phase === 'conclusion') {
    const c = cur as ConclusionCurriculumSignals;
    if (!c.summary_present) violations.push({ key: 'summary_present', severity: 0.9 });
    if (!c.summary_concise) violations.push({ key: 'summary_concise', severity: 0.5 });
    if (!c.punch_line_present)
      violations.push({ key: 'punch_line_present', severity: 0.9 });
    if (!c.no_new_argument)
      violations.push({ key: 'no_new_argument', severity: 0.85 });
    if (!c.thesis_recall_clear)
      violations.push({ key: 'thesis_recall_clear', severity: 0.7 });
  } else {
    // title
    const c = cur as TitleCurriculumSignals;
    if (!c.title_present) violations.push({ key: 'title_present', severity: 1.0 });
    if (!c.title_concise) violations.push({ key: 'title_concise', severity: 0.5 });
    if (c.title_relevant_to_thesis < 0.5)
      violations.push({
        key: 'title_relevant_to_thesis',
        severity: 1.0 - c.title_relevant_to_thesis,
      });
    if (!c.title_intriguing_or_assertive)
      violations.push({ key: 'title_intriguing_or_assertive', severity: 0.6 });
  }

  // 페이즈별 총 체크 항목 수 (대략)
  const totalChecks =
    cur.phase === 'intro'
      ? 3
      : cur.phase === 'body'
        ? 5
        : cur.phase === 'conclusion'
          ? 5
          : 4; // title

  // 가장 심각한 위반 = 가장 약한 신호
  let weakestLabel: string | null = null;
  if (violations.length > 0) {
    violations.sort((a, b) => b.severity - a.severity);
    weakestLabel = getCurriculumSignalLabel(cur.phase, violations[0].key);
  }

  return { violationCount: violations.length, totalChecks, weakestLabel };
}

export function calibrate(input: CalibrationInput): CalibrationOutput {
  const { signals, curriculumSignals } = input;

  // 1. 5 평가요소 평균
  const evalScores = FIVE_DIMENSIONS.map((d) => signals[d.id])
    .filter((v): v is number => typeof v === 'number');
  const avgEval =
    evalScores.length > 0
      ? evalScores.reduce((a, b) => a + b, 0) / evalScores.length
      : 0.5;

  // 2. 5 평가요소 weakest
  let weakestEval: { label: string; score: number } | null = null;
  for (const d of FIVE_DIMENSIONS) {
    const s = signals[d.id];
    if (typeof s === 'number' && (!weakestEval || s < weakestEval.score)) {
      weakestEval = { label: dimensionLabel(d.id), score: s };
    }
  }

  // 3. 헌법 신호 분석
  const cur = analyzeCurriculum(curriculumSignals);
  const curriculumViolationRatio =
    cur.totalChecks > 0 ? cur.violationCount / cur.totalChecks : 0;

  // 4. 행동 신호
  const helpCount = signals.help_request_count ?? 0;
  const revisionCount = signals.self_revision_count ?? 0;

  // 5. 종합 점수 (0~1, 학생 잘함 정도) — 평가요소 평균 70% + 헌법 30%
  const composite =
    avgEval * 0.7 + (1 - curriculumViolationRatio) * 0.3;

  // 6. tone 결정 — 게임 페르소나
  // 잘 쓰면 친구 약오름 (annoying), 못 쓰면 잘난 척 (less-annoying)
  let nextTone: Tone;
  if (composite >= 0.65 && cur.violationCount <= 1) {
    nextTone = 'annoying'; // 학생 잘 씀 → 친구 약오름
  } else if (composite < 0.45 || cur.violationCount >= 3 || helpCount >= 2) {
    nextTone = 'less-annoying'; // 학생 못 씀 → 친구 잘난 척
  } else if (revisionCount >= 1 && composite >= 0.55) {
    nextTone = 'annoying'; // 자기수정 활발 + 평이 이상 → 도전
  } else {
    nextTone = 'less-annoying';
  }

  // 7. weakest 영역 결정 — 헌법 weakest와 5 평가요소 weakest 중 더 약한 것
  let weakestLabel: string | null = null;
  let weakestSource: 'eval' | 'curriculum' | null = null;
  if (cur.weakestLabel) {
    weakestLabel = cur.weakestLabel;
    weakestSource = 'curriculum';
  }
  if (weakestEval && weakestEval.score < 0.55) {
    if (!weakestLabel || weakestEval.score < 0.4) {
      weakestLabel = weakestEval.label;
      weakestSource = 'eval';
    }
  }

  // 8. domain 결정
  let nextDomain: Domain;
  if (weakestSource === 'curriculum' || (weakestEval && weakestEval.score < 0.5)) {
    nextDomain = 'writing';
  } else if (evalScores.length === 0) {
    nextDomain = 'idea';
  } else {
    nextDomain = 'idea';
  }

  const reason = `composite=${composite.toFixed(2)} (avgEval=${avgEval.toFixed(2)}, curriculumViolations=${cur.violationCount}/${cur.totalChecks}), help=${helpCount}, revisions=${revisionCount}, weakest=${weakestLabel ?? 'n/a'} → ${nextTone}/${nextDomain}`;

  return {
    nextTone,
    nextDomain,
    weakestViolationLabel: weakestLabel,
    reason,
    studentScore: Math.round(composite * 100),
  };
}

// ──────────────────────────────────────────────────────────
// 행동 신호 계산 헬퍼
// ──────────────────────────────────────────────────────────

export function computeResponseComplexity(text: string): number {
  if (!text) return 0;
  const len = text.replace(/\s+/g, '').length;
  return Math.min(1, len / 200);
}

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
