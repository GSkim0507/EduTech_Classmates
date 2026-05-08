-- ──────────────────────────────────────────────────────────────
-- Annoying Classmate — DB Schema
-- 학생의 모든 글쓰기 액션(작성/AI피드백/수정/확정)을 보관
-- ──────────────────────────────────────────────────────────────

-- 1. sessions: 세션 메타데이터
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  persona_name TEXT NOT NULL,
  grade INTEGER NOT NULL,
  topic TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_updated TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',         -- active | completed | abandoned
  current_phase TEXT NOT NULL DEFAULT 'intro'    -- intro | body | conclusion | done
);

-- 2. draft_revisions: 모든 글쓰기 스냅샷
--    학생이 글을 쓰는 매 순간 + AI 피드백 후 수정한 결과까지 모두 보관
CREATE TABLE IF NOT EXISTS draft_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,                            -- intro | body | conclusion
  content TEXT NOT NULL,
  source TEXT NOT NULL,                           -- student_write | student_revise | committed
  preceding_turn_id INTEGER,                      -- 직전 AI 피드백 turn (있는 경우)
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drafts_session_phase
  ON draft_revisions(session_id, phase, timestamp);

-- 3. turns: 학생-AI 대화 턴 (help / submit / chat)
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,                           -- 세션 전체에서 0,1,2... 증가
  phase TEXT NOT NULL,
  role TEXT NOT NULL,                             -- student | assistant
  content TEXT NOT NULL,
  triggered_by TEXT,                              -- submit | help | chat
  related_draft_id INTEGER,                       -- AI가 평가한 draft (nullable)
  tone TEXT,                                      -- assistant: less-annoying | annoying
  domain TEXT,                                    -- assistant: idea | writing
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (related_draft_id) REFERENCES draft_revisions(id)
);

CREATE INDEX IF NOT EXISTS idx_turns_session
  ON turns(session_id, idx);

-- 4. phase_commits: 페이즈별 최종 확정된 draft를 별도 마킹
CREATE TABLE IF NOT EXISTS phase_commits (
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  committed_draft_id INTEGER NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (session_id, phase),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (committed_draft_id) REFERENCES draft_revisions(id)
);

-- 5. calibrations: phase-level recalibration (제출/help 시점 평가)
CREATE TABLE IF NOT EXISTS calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  trigger TEXT NOT NULL,                          -- submit | help
  draft_id INTEGER NOT NULL,                      -- 어떤 draft에서 calibration 발생
  signals_json TEXT NOT NULL,                     -- 5 평가요소 + 행동신호 JSON
  next_tone TEXT NOT NULL,                        -- less-annoying | annoying
  next_domain TEXT NOT NULL,                      -- idea | writing
  weakest_dimension TEXT,                         -- 5요소 중 가장 약한 것 (한국어 라벨)
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id) REFERENCES draft_revisions(id)
);

CREATE INDEX IF NOT EXISTS idx_calibrations_session
  ON calibrations(session_id, timestamp);

-- 6. closures: persuasion closure (세션당 1회)
CREATE TABLE IF NOT EXISTS closures (
  session_id TEXT PRIMARY KEY,
  closure_type TEXT NOT NULL,                     -- full | partial | impasse
  persuasion_pct INTEGER,                         -- 0-100
  agent_message TEXT NOT NULL,
  rationale_json TEXT NOT NULL,                   -- passed/failed/rebuttal_responses JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
