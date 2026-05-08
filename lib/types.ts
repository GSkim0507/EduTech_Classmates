// ──────────────────────────────────────────────────────────
// 도메인 타입 정의 — v2 schema와 1:1 대응
// spec: docs/superpowers/specs/2026-05-09-system-redesign-design.md §3
// ──────────────────────────────────────────────────────────

export type Phase = 'intro' | 'body' | 'conclusion' | 'done';
export type Tone = 'less-annoying' | 'annoying';
export type Domain = 'idea' | 'writing';
export type ClosureType = 'full' | 'partial' | 'impasse';

// v2: regress_uncommit 추가
export type DraftSource =
  | 'student_write'
  | 'student_revise'
  | 'committed'
  | 'regress_uncommit';

export type TurnRole = 'student' | 'assistant';
// chat은 historic 호환을 위해 enum 그대로, 새 코드는 사용 X
export type TurnTrigger = 'submit' | 'help' | 'chat';
export type SessionStatus = 'active' | 'completed' | 'abandoned';

// 도움받기에서 학생이 선택한 영역
export type HelpDomain = 'idea' | 'writing' | 'both';

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
  paragraph_idx: number;                // NEW
  content: string;
  content_hash: string;                  // NEW
  source: DraftSource;
  preceding_turn_id: number | null;
  timestamp: string;
}

export interface TurnRow {
  id: number;
  session_id: string;
  idx: number;
  phase: Phase;
  paragraph_idx: number | null;          // NEW
  role: TurnRole;
  content: string;
  triggered_by: TurnTrigger | null;
  help_domain: HelpDomain | null;        // NEW
  related_draft_id: number | null;
  calibration_id: number | null;         // NEW
  tone: Tone | null;
  domain: Domain | null;
  timestamp: string;
}

export interface PhaseParagraphCommitRow {
  session_id: string;
  phase: Phase;
  paragraph_idx: number;
  committed_draft_id: number;
  committed_at: string;
}

export interface CalibrationRow {
  id: number;
  session_id: string;
  phase: Phase;
  paragraph_idx: number | null;          // NEW
  trigger: 'submit' | 'help';
  draft_id: number;
  signals_json: string;
  curriculum_signals_json: string | null; // NEW
  next_tone: Tone;
  next_domain: Domain;
  weakest_violation_label: string | null; // NEW (v1의 weakest_dimension에서 reframe)
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

// ─── 도메인 객체 ───

// 5 평가요소 + 행동 신호
export interface Signals {
  claim_clarity?: number | null;
  evidence_appropriateness?: number | null;
  evidence_relevance?: number | null;
  expression_appropriateness?: number | null;
  structural_coherence?: number | null;
  response_complexity?: number;
  self_revision_count?: number;
  help_request_count?: number;
  lexical_diversity?: number;
  notes?: string;
}

// 페이즈별 헌법 신호 (LLM이 평가에 채움)
export interface IntroCurriculumSignals {
  phase: 'intro';
  thesis_present: boolean;
  thesis_singular: boolean;
  thesis_assertive_form: boolean;
  intro_method_label: string | null;
}

export interface BodyCurriculumSignals {
  phase: 'body';
  paragraph_idx: number;
  topic_sentence_present: boolean;
  argument_method_identifiable: boolean;
  argument_method_label: string | null;
  appropriateness_to_thesis: number;       // 0~1
  appropriateness_to_preceding: number;    // 0~1
  link_word_used: boolean;
}

export interface ConclusionCurriculumSignals {
  phase: 'conclusion';
  summary_present: boolean;
  summary_concise: boolean;
  punch_line_present: boolean;
  punch_line_method_label: string | null;
  no_new_argument: boolean;
  thesis_recall_clear: boolean;
}

export type CurriculumSignals =
  | IntroCurriculumSignals
  | BodyCurriculumSignals
  | ConclusionCurriculumSignals;

// 직전 글 컨텍스트 (LLM 평가/응답 시 함께 전달)
export interface PrecedingContent {
  intro?: string;                       // 서론 commit
  bodyParagraphs?: string[];            // 본론 1..i-1 commit (현재 본론 i 평가 시)
}

// Closure 근거
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

export interface DraftRequestInput {
  phase: Phase;
  paragraphIdx: number;
  content: string;
  source: DraftSource;
  precedingTurnId?: number | null;
}

export interface TurnRequestInput {
  apiKey: string;
  trigger: TurnTrigger;
  paragraphIdx?: number | null;
  studentMessage?: string;
  helpDomain?: HelpDomain;        // help trigger인 경우만
}

export interface CommitRequestInput {
  phase: Phase;
  paragraphIdx: number;
  bodyParagraphCount?: number;    // 본론에서 마지막 문단 commit인지 판단용
}

export interface UncommitRequestInput {
  phase: Phase;
  paragraphIdx: number;
}

export interface TurnResponseOutput {
  studentTurnId: number;
  assistantTurnId: number;
  assistantMessage: string;
  tone: Tone;
  domain: Domain;
  calibration?: {
    nextTone: Tone;
    nextDomain: Domain;
    weakestViolationLabel: string | null;
    signals: Signals;
    curriculumSignals: CurriculumSignals | null;
  };
}

export interface ClosureResponseOutput {
  closureType: ClosureType;
  persuasionPct: number;
  agentMessage: string;
  rationale: ClosureRationale;
}
