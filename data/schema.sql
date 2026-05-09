-- ──────────────────────────────────────────────────────────────
-- Annoying Classmate v2 schema (2026-05-09)
-- spec: docs/superpowers/specs/2026-05-09-system-redesign-design.md §3
-- 변경: paragraph_idx, content_hash, help_domain, calibration_id,
--       curriculum_signals_json, weakest_violation_label,
--       regress_uncommit source 추가
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  persona_name TEXT NOT NULL,
  grade INTEGER NOT NULL,
  topic TEXT NOT NULL,
  title TEXT,                                     -- v2.1: 학생이 commit한 글의 제목
  started_at TEXT NOT NULL,
  last_updated TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',          -- active | completed | abandoned
  current_phase TEXT NOT NULL DEFAULT 'intro'     -- intro | body | conclusion | title | done
);

-- 모든 글쓰기 스냅샷
-- source: student_write | student_revise | committed | regress_uncommit
CREATE TABLE IF NOT EXISTS draft_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER NOT NULL DEFAULT 0,       -- 서론/결론=0, 본론=0..4
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,                     -- SHA-256 truncated, 중복 INSERT 방지
  source TEXT NOT NULL,
  preceding_turn_id INTEGER,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drafts_session_phase_para
  ON draft_revisions(session_id, phase, paragraph_idx, timestamp);

CREATE INDEX IF NOT EXISTS idx_drafts_hash
  ON draft_revisions(session_id, phase, paragraph_idx, content_hash);

-- 학생-AI 대화 턴
-- triggered_by: submit | help (chat은 historic 데이터 호환을 위해 enum 그대로, 새 코드는 미사용)
-- help_domain: idea | writing | both
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER,                          -- 본론 i문단 평가 시 i, 그 외 NULL
  role TEXT NOT NULL,                             -- student | assistant
  content TEXT NOT NULL,
  triggered_by TEXT,
  help_domain TEXT,
  related_draft_id INTEGER,
  calibration_id INTEGER,                         -- 어느 calibration이 이 turn의 mode를 결정했는지
  tone TEXT,                                      -- assistant: less-annoying | annoying
  domain TEXT,                                    -- assistant: idea | writing
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (related_draft_id) REFERENCES draft_revisions(id),
  FOREIGN KEY (calibration_id) REFERENCES calibrations(id)
);

CREATE INDEX IF NOT EXISTS idx_turns_session
  ON turns(session_id, idx);

-- 페이즈/문단별 commit (회귀 시 row 삭제 + draft에 regress_uncommit row 추가)
CREATE TABLE IF NOT EXISTS phase_paragraph_commits (
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER NOT NULL DEFAULT 0,
  committed_draft_id INTEGER NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (session_id, phase, paragraph_idx),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (committed_draft_id) REFERENCES draft_revisions(id)
);

-- phase-level recalibration (제출/help 시점 평가)
CREATE TABLE IF NOT EXISTS calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER,                          -- 본론 i문단 평가 시 i
  trigger TEXT NOT NULL,                          -- submit | help
  draft_id INTEGER NOT NULL,
  signals_json TEXT NOT NULL,                     -- 5 평가요소 + 행동신호
  curriculum_signals_json TEXT,                   -- 헌법 신호 (페이즈별 boolean/소수)
  next_tone TEXT NOT NULL,
  next_domain TEXT NOT NULL,
  weakest_violation_label TEXT,                   -- 한국어 라벨 ("주제와의 어울림" 등)
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id) REFERENCES draft_revisions(id)
);

CREATE INDEX IF NOT EXISTS idx_calibrations_session
  ON calibrations(session_id, timestamp);

-- persuasion closure (세션당 1회)
CREATE TABLE IF NOT EXISTS closures (
  session_id TEXT PRIMARY KEY,
  closure_type TEXT NOT NULL,                     -- full | partial | impasse
  persuasion_pct INTEGER,                         -- 0~100
  agent_message TEXT NOT NULL,
  rationale_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
