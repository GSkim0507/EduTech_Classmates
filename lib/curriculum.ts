import fs from 'node:fs';
import path from 'node:path';

// ──────────────────────────────────────────────────────────
// 헌법(2022 개정 국어과 교육과정 + 5·6학년 국정교과서) 자료
// ──────────────────────────────────────────────────────────

function extractText(html: string): string {
  let text = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<head[\s\S]*?<\/head>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#\d+;/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

const CURRICULUM_FILES = [
  '헌법_공통.html',
  '헌법_서론.html',
  '헌법_본론.html',
  '헌법_결론.html',
];

let cachedCurriculum: string | null = null;

/**
 * 헌법 4편(공통/서론/본론/결론)을 텍스트로 합쳐서 반환.
 * LLM 시스템 프롬프트에 주입할 용도.
 */
export function loadCurriculum(): string {
  if (cachedCurriculum !== null) return cachedCurriculum;

  const dir = path.join(process.cwd(), 'data', 'curriculum');
  const sections: string[] = [];

  for (const file of CURRICULUM_FILES) {
    const fp = path.join(dir, file);
    try {
      const html = fs.readFileSync(fp, 'utf-8');
      const text = extractText(html);
      const sectionName = file.replace('.html', '');
      sections.push(`### ${sectionName}\n${text}`);
    } catch (err) {
      console.warn(`[curriculum] failed to load ${file}:`, err);
    }
  }

  cachedCurriculum = sections.join('\n\n');
  return cachedCurriculum;
}

// ─── 2022 개정 국어과 교육과정 성취기준 ───
export const ACHIEVEMENT_STANDARDS: Record<string, string> = {
  '4국03-03': '적절한 이유와 표현을 들어 자신의 의견이 드러나게 글을 쓴다.',
  '6국03-04': '적절한 근거와 알맞은 표현을 사용하여 주장하는 글을 쓴다.',
  '6국03-06': '독자를 존중하고 배려하는 태도로 글을 쓴다.',
};

// ─── 5·6학년 국정교과서 5개 평가요소 ───
export interface Dimension {
  id: keyof DimensionScores;
  label: string;        // 한국어 라벨
  prompt: string;       // 교과서 평가 문항
}

export interface DimensionScores {
  claim_clarity: number | null;
  evidence_appropriateness: number | null;
  evidence_relevance: number | null;
  expression_appropriateness: number | null;
  structural_coherence: number | null;
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
