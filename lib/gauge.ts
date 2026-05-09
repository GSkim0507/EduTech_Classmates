// 클라이언트에서 사용하는 누적 게이지 helper.
// (lib/calibrator.ts는 fs를 통해 헌법 텍스트를 로드하므로 client에서 import 금지)

import type { Phase } from './types';

export const PHASE_WEIGHT: Record<Exclude<Phase, 'done'>, number> = {
  intro: 0.15,
  body: 0.55,
  conclusion: 0.20,
  title: 0.10,
};

export interface PhaseGaugeInput {
  phase: Exclude<Phase, 'done'>;
  paragraphScores: number[];
  bodyCommittedCount?: number;
}

export function computeAccumulatedGauge(inputs: PhaseGaugeInput[]): number | null {
  let weightedSum = 0;
  let weightCovered = 0;
  for (const inp of inputs) {
    if (inp.paragraphScores.length === 0) continue;
    let phaseAvg =
      inp.paragraphScores.reduce((a, b) => a + b, 0) / inp.paragraphScores.length;
    if (inp.phase === 'body' && typeof inp.bodyCommittedCount === 'number') {
      if (inp.bodyCommittedCount === 1) phaseAvg *= 0.85;
      else if (inp.bodyCommittedCount === 2) phaseAvg *= 0.92;
    }
    weightedSum += phaseAvg * PHASE_WEIGHT[inp.phase];
    weightCovered += PHASE_WEIGHT[inp.phase];
  }
  if (weightCovered === 0) return null;
  return Math.round((weightedSum / weightCovered) * 100);
}

export function scoreFromSignalsJson(signalsJson: string): number | null {
  try {
    const sig = JSON.parse(signalsJson) as Record<string, unknown>;
    const evalKeys = [
      'claim_clarity',
      'evidence_appropriateness',
      'evidence_relevance',
      'expression_appropriateness',
      'structural_coherence',
    ];
    const scores = evalKeys
      .map((k) => sig[k])
      .filter((v): v is number => typeof v === 'number');
    if (scores.length === 0) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  } catch {
    return null;
  }
}
