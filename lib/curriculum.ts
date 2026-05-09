import fs from 'node:fs';
import path from 'node:path';
import type { Phase } from './types';

// ──────────────────────────────────────────────────────────
// 헌법(2022 개정 국어과 교육과정 + 5·6학년 국정교과서) 자료
// v2: HTML → Markdown 변환된 파일 로드
// ──────────────────────────────────────────────────────────

const CURRICULUM_FILES = [
  '헌법_공통.md',
  '헌법_서론.md',
  '헌법_본론.md',
  '헌법_결론.md',
];

let cachedCurriculum: string | null = null;

/**
 * 헌법 4편(공통/서론/본론/결론)을 Markdown으로 합쳐서 반환.
 * LLM 시스템 프롬프트에 주입할 용도.
 */
export function loadCurriculum(): string {
  if (cachedCurriculum !== null) return cachedCurriculum;

  const dir = path.join(process.cwd(), 'data', 'curriculum');
  const sections: string[] = [];

  for (const file of CURRICULUM_FILES) {
    const fp = path.join(dir, file);
    try {
      const md = fs.readFileSync(fp, 'utf-8');
      sections.push(md.trim());
    } catch (err) {
      console.warn(`[curriculum] failed to load ${file}:`, err);
    }
  }

  cachedCurriculum = sections.join('\n\n---\n\n');
  return cachedCurriculum;
}

// ─── 2022 개정 국어과 교육과정 성취기준 ───
export const ACHIEVEMENT_STANDARDS: Record<string, string> = {
  '4국03-03': '적절한 이유와 표현을 들어 자신의 의견이 드러나게 글을 쓴다.',
  '6국03-04': '적절한 근거와 알맞은 표현을 사용하여 주장하는 글을 쓴다.',
  '6국03-06': '독자를 존중하고 배려하는 태도로 글을 쓴다.',
};

// ─── 5·6학년 국정교과서 5개 평가요소 ───
export interface DimensionScores {
  claim_clarity: number | null;
  evidence_appropriateness: number | null;
  evidence_relevance: number | null;
  expression_appropriateness: number | null;
  structural_coherence: number | null;
}

export interface Dimension {
  id: keyof DimensionScores;
  label: string;
  prompt: string;
}

export const FIVE_DIMENSIONS: Dimension[] = [
  { id: 'claim_clarity', label: '주장 명확성', prompt: '주장이 분명한가?' },
  { id: 'evidence_appropriateness', label: '근거 적절성', prompt: '주장을 뒷받침하는 근거가 적절한가?' },
  { id: 'evidence_relevance', label: '근거 관련성', prompt: '근거가 주장과 관련 있는가?' },
  { id: 'expression_appropriateness', label: '표현 적절성', prompt: '표현이 적절한가?' },
  { id: 'structural_coherence', label: '짜임 완성도', prompt: '글의 짜임이 잘 갖추어져 있는가?' },
];

export function dimensionLabel(id: keyof DimensionScores): string {
  return FIVE_DIMENSIONS.find((d) => d.id === id)?.label ?? id;
}

// ─── 페이즈별 헌법 신호 한국어 라벨 (학생에게 노출되는 자연어 라벨) ───

export const INTRO_SIGNAL_LABELS = {
  thesis_present: '핵심 명제 존재',
  thesis_singular: '주장 단일성',
  thesis_assertive_form: '주장형 서술어',
  intro_method_label: '도입 방법',
} as const;

export const BODY_SIGNAL_LABELS = {
  topic_sentence_present: '소주제문 명료성',
  argument_method_identifiable: '논증 방식 명시성',
  argument_method_label: '논증 유형',
  appropriateness_to_thesis: '주장과의 정합성',
  appropriateness_to_preceding: '앞 문단과의 일관성',
  link_word_used: '연결어 사용',
} as const;

export const CONCLUSION_SIGNAL_LABELS = {
  summary_present: '근거 요약',
  summary_concise: '요약 간결성',
  punch_line_present: '강조(펀치라인)',
  punch_line_method_label: '강조 방식',
  no_new_argument: '새 근거 추가 X',
  thesis_recall_clear: '핵심 명제 재확인',
} as const;

export const TITLE_SIGNAL_LABELS = {
  title_present: '제목 존재',
  title_concise: '제목 길이 적절',
  title_relevant_to_thesis: '주장과의 관련성',
  title_intriguing_or_assertive: '제목의 매력',
} as const;

export function getCurriculumSignalLabel(phase: Phase, key: string): string {
  if (phase === 'intro') {
    return (INTRO_SIGNAL_LABELS as Record<string, string>)[key] ?? key;
  }
  if (phase === 'body') {
    return (BODY_SIGNAL_LABELS as Record<string, string>)[key] ?? key;
  }
  if (phase === 'conclusion') {
    return (CONCLUSION_SIGNAL_LABELS as Record<string, string>)[key] ?? key;
  }
  if (phase === 'title') {
    return (TITLE_SIGNAL_LABELS as Record<string, string>)[key] ?? key;
  }
  return key;
}
