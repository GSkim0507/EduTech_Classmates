// ──────────────────────────────────────────────────────────
// 도메인 타입 정의 — DB 스키마와 1:1 대응
// ──────────────────────────────────────────────────────────

export type Phase = 'intro' | 'body' | 'conclusion' | 'done';
export type Tone = 'less-annoying' | 'annoying';
export type Domain = 'idea' | 'writing';
export type ClosureType = 'full' | 'partial' | 'impasse';

export type DraftSource = 'student_write' | 'student_revise' | 'committed';
export type TurnRole = 'student' | 'assistant';
export type TurnTrigger = 'submit' | 'help' | 'chat';
export type SessionStatus = 'active' | 'completed' | 'abandoned';

// ─── DB row 형태 (snake_case 그대로) ───
export interface SessionRow {
  id: string;
  persona_name: string;
  grade: number;
  topic: string;
  started_at: string;
  last_updated: string;
  status: SessionStatus;
  current_phase: Phase;
}

export interface DraftRow {
  id: number;
  session_id: string;
  phase: Phase;
  content: string;
  source: DraftSource;
  preceding_turn_id: number | null;
  timestamp: string;
}

export interface TurnRow {
  id: number;
  session_id: string;
  idx: number;
  phase: Phase;
  role: TurnRole;
  content: string;
  triggered_by: TurnTrigger | null;
  related_draft_id: number | null;
  tone: Tone | null;
  domain: Domain | null;
  timestamp: string;
}

export interface CalibrationRow {
  id: number;
  session_id: string;
  phase: Phase;
  trigger: 'submit' | 'help';
  draft_id: number;
  signals_json: string;
  next_tone: Tone;
  next_domain: Domain;
  weakest_dimension: string | null;
  timestamp: string;
}

export interface ClosureRow {
  session_id: string;
  closure_type: ClosureType;
  persuasion_pct: number | null;
  agent_message: string;
  rationale_json: string;
  created_at: string;
}

// ─── 도메인 객체 (5 평가요소 + 행동 신호) ───
export interface Signals {
  // 5 evaluation criteria (0-1 score, null = 측정 불가)
  claim_clarity?: number | null;
  evidence_appropriateness?: number | null;
  evidence_relevance?: number | null;
  expression_appropriateness?: number | null;
  structural_coherence?: number | null;
  // Behavioral signals
  response_complexity?: number;
  self_revision_count?: number;
  help_request_count?: number;
  lexical_diversity?: number;
  notes?: string;
}

export interface ClosureRationale {
  passed: string[];
  failed: string[];
  rebuttal_responses?: {
    rebuttal_turn_id?: number;
    successfully_addressed: boolean;
    note?: string;
  }[];
  reasoning?: string;
}

// ─── API request/response 형태 ───
export interface CreateSessionInput {
  personaName: string;
  grade: number;
  topic: string;
}

export interface ChatRequestInput {
  apiKey: string;
  sessionId: string;
  trigger: TurnTrigger;
  studentMessage?: string; // help/chat인 경우 학생 채팅 메시지
}

export interface ChatResponseOutput {
  assistantTurnId: number;
  assistantMessage: string;
  tone: Tone;
  domain: Domain;
  calibration?: {
    nextTone: Tone;
    nextDomain: Domain;
    weakestDimension: string | null;
    signals: Signals;
  };
}

export interface ClosureResponseOutput {
  closureType: ClosureType;
  persuasionPct: number;
  agentMessage: string;
  rationale: ClosureRationale;
}
