# Annoying Classmate v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec `2026-05-09-system-redesign-design.md`(B+C+D 그룹)를 구현. 본론 동적 다문단(3~5), 헌법 신호화 평가, 게임 페르소나, 채팅창 제거, 도움/보여주기 분기, 회귀 기능, 승부 게이지, diff checker.

**Architecture:** Turso(libSQL) + Next.js 16 App Router + React 19 + Tailwind v4. lib(curriculum/claude/persona/calibrator/queries/closure) → API routes → components → pages 순으로 의존성 빌드. 5/9 walkthrough 핵심 path(P0)와 분석 강화(P1)·nice-to-have(P2)로 우선순위 분리.

**Tech Stack:** TypeScript / @libsql/client / @anthropic-ai/sdk / nanoid / jsdiff(NEW)

---

## 우선순위 표기

- **P0** = 5/9 simulated walkthrough 핵심 path (필수)
- **P1** = 분석·연구 데이터 풍부화 (강력 권장)
- **P2** = nice-to-have, 5/9 이후 적용 가능

5/9까지 시간이 부족하면 **P2를 먼저 떨어뜨림**. P0+P1만으로도 spec의 핵심 가치는 충분히 전달됨.

---

## Phase 0 — 사전 준비 (P0)

### Task 0.1: 헌법 HTML → Markdown 변환 스크립트

**Files:**
- Create: `scripts/convert-curriculum.mjs`
- Create: `data/curriculum/헌법_공통.md`, `data/curriculum/헌법_서론.md`, `data/curriculum/헌법_본론.md`, `data/curriculum/헌법_결론.md` (스크립트 산출)

- [ ] **Step 1: 변환 스크립트 작성** (`scripts/convert-curriculum.mjs`)
  - HTML 읽기 → `<style>`, `<script>`, `<head>` 제거
  - 태그 → 빈칸, HTML entity 정리
  - 평가 체크리스트 표는 마크다운 표로 보존
  - 4편 각각 `.md`로 출력

```javascript
import fs from 'node:fs';
import path from 'node:path';

const FILES = ['헌법_공통.html', '헌법_서론.html', '헌법_본론.html', '헌법_결론.html'];
const dir = path.join(process.cwd(), 'data/curriculum');

function htmlToMd(html) {
  // 1. style/script/head 블록 제거
  let s = html.replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<head[\s\S]*?<\/head>/gi, '');
  // 2. 표(<table>)는 별도 추출 후 마크다운 변환 (본 스크립트는 단순 텍스트 추출 + 추후 수동 정돈)
  // 3. 태그 제거
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  // 4. entity
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ');
  // 5. 공백 정리
  s = s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n');
  return s.trim();
}

for (const file of FILES) {
  const html = fs.readFileSync(path.join(dir, file), 'utf-8');
  const md = htmlToMd(html);
  const outPath = path.join(dir, file.replace('.html', '.md'));
  fs.writeFileSync(outPath, md, 'utf-8');
  console.log(`✓ ${outPath} (${md.length} chars)`);
}
```

- [ ] **Step 2: 실행**

```bash
node scripts/convert-curriculum.mjs
ls data/curriculum/*.md
```

- [ ] **Step 3: 4개 .md 파일 수동 검수** (10분)
  - 평가 체크리스트 표가 깨졌으면 수동 정돈 (markdown 표로)
  - 핵심 조항 번호·내용 보존 확인

- [ ] **Step 4: Commit**

```bash
git add scripts/convert-curriculum.mjs data/curriculum/*.md
git commit -m "chore(curriculum): convert 헌법 HTML to MD for prompt efficiency"
```

### Task 0.2: jsdiff 패키지 설치 (P1, diff checker용)

- [ ] **Step 1: 설치**

```bash
npm install diff
npm install -D @types/diff
```

- [ ] **Step 2: package.json 확인 + commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add jsdiff for admin draft diff viewer"
```

---

## Phase 1 — DB v2 마이그레이션 (P0)

### Task 1.1: 새 schema.sql 작성

**Files:**
- Replace: `data/schema.sql`

- [ ] **Step 1: schema.sql 전체 교체**

```sql
-- Annoying Classmate v2 schema (2026-05-09)
-- 변경: paragraph_idx, content_hash, help_domain, calibration_id,
--       curriculum_signals_json, weakest_violation_label, regress_uncommit source 추가
-- spec: docs/superpowers/specs/2026-05-09-system-redesign-design.md §3

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  persona_name TEXT NOT NULL,
  grade INTEGER NOT NULL,
  topic TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_updated TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_phase TEXT NOT NULL DEFAULT 'intro'
);

CREATE TABLE IF NOT EXISTS draft_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL,
  preceding_turn_id INTEGER,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drafts_session_phase_para
  ON draft_revisions(session_id, phase, paragraph_idx, timestamp);

CREATE INDEX IF NOT EXISTS idx_drafts_hash
  ON draft_revisions(session_id, phase, paragraph_idx, content_hash);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  triggered_by TEXT,
  help_domain TEXT,
  related_draft_id INTEGER,
  calibration_id INTEGER,
  tone TEXT,
  domain TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (related_draft_id) REFERENCES draft_revisions(id),
  FOREIGN KEY (calibration_id) REFERENCES calibrations(id)
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, idx);

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

CREATE TABLE IF NOT EXISTS calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER,
  trigger TEXT NOT NULL,
  draft_id INTEGER NOT NULL,
  signals_json TEXT NOT NULL,
  curriculum_signals_json TEXT,
  next_tone TEXT NOT NULL,
  next_domain TEXT NOT NULL,
  weakest_violation_label TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id) REFERENCES draft_revisions(id)
);

CREATE INDEX IF NOT EXISTS idx_calibrations_session
  ON calibrations(session_id, timestamp);

CREATE TABLE IF NOT EXISTS closures (
  session_id TEXT PRIMARY KEY,
  closure_type TEXT NOT NULL,
  persuasion_pct INTEGER,
  agent_message TEXT NOT NULL,
  rationale_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Commit**

```bash
git add data/schema.sql
git commit -m "feat(db): v2 schema with paragraph_idx, content_hash, help_domain"
```

### Task 1.2: 마이그레이션 스크립트 (DROP + CREATE) — **위험: 모든 v1 데이터 삭제됨**

**Files:**
- Create: `scripts/db-migrate-v2.mjs`

- [ ] **Step 1: 스크립트 작성**

```javascript
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error('TURSO_DATABASE_URL is not set.');
  process.exit(1);
}

const db = createClient({ url, authToken });

const DROP_TABLES = ['closures', 'calibrations', 'phase_paragraph_commits', 'phase_commits', 'turns', 'draft_revisions', 'sessions'];

console.log(`\nDropping v1 tables on:\n  ${url}\n`);
for (const t of DROP_TABLES) {
  try {
    await db.execute(`DROP TABLE IF EXISTS ${t}`);
    console.log(`  ✓ DROP ${t}`);
  } catch (e) {
    console.warn(`  ⚠ DROP ${t}: ${e.message}`);
  }
}

const schema = fs.readFileSync(path.join(projectRoot, 'data/schema.sql'), 'utf-8');
const cleaned = schema.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const stmts = cleaned.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

console.log(`\nCreating v2 schema (${stmts.length} statements)\n`);
let ok = 0;
for (const s of stmts) {
  try {
    await db.execute(s);
    console.log(`  ✓ ${s.replace(/\s+/g, ' ').slice(0, 70)}...`);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${s.slice(0, 70)}\n    ${e.message}`);
    process.exit(1);
  }
}
console.log(`\n✅ Migrated ${ok} statements.\n`);
```

- [ ] **Step 2: package.json scripts 추가**

`package.json`의 `"scripts"`에 추가:
```json
"db:migrate-v2": "node --env-file=.env.local scripts/db-migrate-v2.mjs"
```

- [ ] **Step 3: 실행 (모든 v1 데이터 삭제됨, 확인 후 진행)**

```bash
npm run db:migrate-v2
```

기대 출력: `Migrated 9 statements.`

- [ ] **Step 4: Commit**

```bash
git add scripts/db-migrate-v2.mjs package.json
git commit -m "feat(db): v2 migration script (drops all v1 data)"
```

---

## Phase 2 — Lib 확장 (P0~P1)

### Task 2.1: types.ts 확장 (P0)

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: 새 타입 추가**

기존 enum 확장 + 새 인터페이스 추가:
```typescript
// Phase 추가는 없음 (intro/body/conclusion/done 그대로)
// DraftSource 확장:
export type DraftSource = 'student_write' | 'student_revise' | 'committed' | 'regress_uncommit';

// TurnTrigger에서 'chat' 제거 안 함 (historic data 호환), 단 새 코드는 chat 사용 X
// 새 추가:
export type HelpDomain = 'idea' | 'writing' | 'both';

// Phase별 헌법 신호
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

// 기존 DraftRow, TurnRow, CalibrationRow 모두 paragraph_idx 등 추가 (snake_case 그대로)
// (각 테이블 row 인터페이스에 spec §3의 컬럼 추가)
```

- [ ] **Step 2: lib/types.ts의 DraftRow/TurnRow/CalibrationRow에 새 컬럼 반영** (편집)

DraftRow:
```typescript
export interface DraftRow {
  id: number;
  session_id: string;
  phase: Phase;
  paragraph_idx: number;        // NEW
  content: string;
  content_hash: string;          // NEW
  source: DraftSource;
  preceding_turn_id: number | null;
  timestamp: string;
}
```

TurnRow:
```typescript
export interface TurnRow {
  id: number;
  session_id: string;
  idx: number;
  phase: Phase;
  paragraph_idx: number | null;   // NEW
  role: TurnRole;
  content: string;
  triggered_by: TurnTrigger | null;
  help_domain: HelpDomain | null; // NEW
  related_draft_id: number | null;
  calibration_id: number | null;  // NEW
  tone: Tone | null;
  domain: Domain | null;
  timestamp: string;
}
```

CalibrationRow:
```typescript
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
  weakest_violation_label: string | null; // NEW
  timestamp: string;
}
```

- [ ] **Step 3: tsc 타입 체크 + Commit**

```bash
npx tsc --noEmit
git add lib/types.ts
git commit -m "feat(types): add paragraph_idx, content_hash, help_domain, curriculum signals"
```

### Task 2.2: curriculum.ts — md 로드 + 헌법 신호 정의 (P0)

**Files:**
- Modify: `lib/curriculum.ts`

- [ ] **Step 1: loadCurriculum()을 .md 파일에서 읽도록 변경**

```typescript
const CURRICULUM_FILES = ['헌법_공통.md', '헌법_서론.md', '헌법_본론.md', '헌법_결론.md'];

export function loadCurriculum(): string {
  if (cachedCurriculum !== null) return cachedCurriculum;
  const dir = path.join(process.cwd(), 'data', 'curriculum');
  const sections: string[] = [];
  for (const file of CURRICULUM_FILES) {
    const fp = path.join(dir, file);
    try {
      const md = fs.readFileSync(fp, 'utf-8');
      sections.push(`### ${file.replace('.md', '')}\n\n${md}`);
    } catch (err) {
      console.warn(`[curriculum] failed to load ${file}:`, err);
    }
  }
  cachedCurriculum = sections.join('\n\n---\n\n');
  return cachedCurriculum;
}
```

- [ ] **Step 2: 헌법 핵심 신호 정의 export**

```typescript
export const INTRO_SIGNAL_LABELS: Record<keyof Omit<IntroCurriculumSignals, 'phase'>, string> = {
  thesis_present: '핵심 명제 존재',
  thesis_singular: '주장 단일성',
  thesis_assertive_form: '주장형 서술어',
  intro_method_label: '도입 방법',
};

export const BODY_SIGNAL_LABELS: Record<string, string> = {
  topic_sentence_present: '소주제문 명료성',
  argument_method_identifiable: '논증 방식 명시성',
  argument_method_label: '논증 유형',
  appropriateness_to_thesis: '주장과의 정합성',
  appropriateness_to_preceding: '앞 문단과의 일관성',
  link_word_used: '연결어 사용',
};

export const CONCLUSION_SIGNAL_LABELS: Record<string, string> = {
  summary_present: '근거 요약',
  summary_concise: '요약 간결성',
  punch_line_present: '강조(펀치라인)',
  punch_line_method_label: '강조 방식',
  no_new_argument: '새 근거 추가 X',
  thesis_recall_clear: '핵심 명제 재확인',
};

export function getSignalKoreanLabel(phase: Phase, key: string): string {
  const map = phase === 'intro' ? INTRO_SIGNAL_LABELS
            : phase === 'body' ? BODY_SIGNAL_LABELS
            : CONCLUSION_SIGNAL_LABELS;
  return map[key] ?? key;
}
```

- [ ] **Step 3: tsc 검증 + Commit**

```bash
npx tsc --noEmit
git add lib/curriculum.ts
git commit -m "feat(curriculum): load .md + curriculum signal definitions"
```

### Task 2.3: claude.ts — evaluateDraft 헌법 신호 + precedingContent (P0)

**Files:**
- Modify: `lib/claude.ts`

- [ ] **Step 1: EvaluateDraftInput에 precedingContent 추가**

```typescript
export interface PrecedingContent {
  intro?: string;
  bodyParagraphs?: string[];   // 본론 1..i-1 (현재 본론 i 평가 시)
}

export interface EvaluateDraftInput {
  apiKey: string;
  draftText: string;
  phase: 'intro' | 'body' | 'conclusion';
  topic: string;
  paragraphIdx?: number;       // 본론 i문단 평가 시 i (0-based)
  preceding?: PrecedingContent;
}

export interface EvaluateDraftOutput {
  scores: Record<string, number | null>;            // 5 평가요소
  curriculum: CurriculumSignals | null;             // 헌법 신호
  notes?: string;
}
```

- [ ] **Step 2: evaluateDraft 시스템 프롬프트 강화 — 헌법 신호 JSON으로 받기**

페이즈별 expected JSON schema를 prompt에 명시:
- intro: thesis_present 등
- body: topic_sentence_present, paragraph_idx 등 (이전 문단 컨텍스트와 비교 명시)
- conclusion: summary_present 등

`temperature: 0.2`, `max_tokens: 800` 유지.

- [ ] **Step 3: 응답 JSON 파싱**

5 평가요소 + curriculum signals 둘 다 추출. 실패 시 부분 결과라도 반환.

- [ ] **Step 4: tsc + Commit**

```bash
npx tsc --noEmit
git add lib/claude.ts
git commit -m "feat(claude): evaluateDraft returns curriculum signals + preceding context"
```

### Task 2.4: persona.ts — 게임 페르소나 + UX 라이팅 가이드 (P0)

**Files:**
- Modify: `lib/persona.ts`

- [ ] **Step 1: buildSystemPrompt() 입력 확장**

```typescript
interface PersonaContext {
  session: SessionRow;
  tone: Tone;
  domain: Domain;
  phase: Exclude<Phase, 'done'>;
  paragraphIdx?: number;
  weakestViolationLabel?: string | null;
  preceding?: PrecedingContent;
}
```

- [ ] **Step 2: 시스템 프롬프트에 다음 섹션 추가** (spec §4.5, §4.6)

1. 게임 페르소나 단락:
```
## 너의 게임 페르소나
- 친구는 학생을 라이벌로 본다.
- 학생이 글을 잘 쓰면 약이 오른다 (annoying mode). 인정하기 싫어 더 깐깐하게 도전한다.
- 학생이 글을 못 쓰면 잘난 척한다 (less-annoying mode). 살짝 비꼬며 도와준다.
- 둘 다 친구로서의 친근함 + 반말은 유지.
```

2. UX 라이팅 가이드 단락 (학생에게 절대 raw 신호 노출 금지 + 자연어 패턴):
```
## 응답 어조 (반드시 지킬 것)
학생에게 "5점 만점 X점", "thesis_singular: false", "헌법 제8조 위반" 같은
표현을 절대 사용하지 마라.
대신 다음 패턴 사용:
- 인정형: "이 부분 진짜 인정", "잘 썼네"
- 아쉬움: "○○가 살짝 아쉬워", "○○가 더 좋아지면", "○○를 한 번 더 봐줘"
- annoying mode: "헐... 근데", "쳇", "두고 봐", "인정 못 해"
- less-annoying mode: "에이~", "그것도 모르겠어?", "천천히 같이"
- 한국어 반말, 한두 문장.
```

3. preceding 컨텍스트 단락:
```
## 학생 글의 맥락
- 서론(commit): {intro}
- 직전 본론 문단들(commit): {bodyParagraphs}
이 맥락에 비추어 현재 ○○문단의 일관성·중복을 짚어라.
```

4. weakestViolationLabel 우선 짚기:
```
## 우선 짚을 영역
{label}이 가장 아쉬워. 친구로서 그 부분을 살짝 짜증내며(또는 우월감 있게) 짚어줘.
```

- [ ] **Step 3: tsc + Commit**

```bash
npx tsc --noEmit
git add lib/persona.ts
git commit -m "feat(persona): game persona + UX writing guide + preceding context"
```

### Task 2.5: calibrator.ts — 헌법 신호 통합 (P0)

**Files:**
- Modify: `lib/calibrator.ts`

- [ ] **Step 1: CalibrationInput에 curriculum signals 추가**

```typescript
export interface CalibrationInput {
  phase: Phase;
  paragraphIdx?: number;
  signals: Signals;                          // 5 평가요소 + 행동
  curriculumSignals: CurriculumSignals | null;
}

export interface CalibrationOutput {
  nextTone: Tone;
  nextDomain: Domain;
  weakestViolationLabel: string | null;       // 한국어 라벨
  reason: string;
}
```

- [ ] **Step 2: calibrate() 로직** — 5 평가요소 평균 + 헌법 신호 위반 카운트로 mode 결정

```
- 5 평가요소 평균 + 헌법 boolean 위반 0~1로 정규화 후 가중평균
- 평균 ≥ 0.65 + 위반 ≤ 1 → annoying (학생 잘 씀, 친구 약오름)
- 평균 < 0.45 또는 위반 ≥ 3 → less-annoying (학생 못 씀, 친구 잘난 척)
- 그 외 → less-annoying default
- weakest violation은 헌법 boolean false 중 우선순위 높은 것을 한국어 라벨로 (getSignalKoreanLabel 사용)
- 5 평가요소 weakest와 헌법 weakest 중 더 약한 것 선택
- domain은 weakest가 헌법 신호면 'writing', 5 평가요소도 약하면 'writing', 둘 다 평이하면 'idea'
```

- [ ] **Step 3: tsc + Commit**

```bash
npx tsc --noEmit
git add lib/calibrator.ts
git commit -m "feat(calibrator): integrate curriculum signals into mode decision"
```

### Task 2.6: queries.ts — paragraph 단위 쿼리 추가 (P0)

**Files:**
- Modify: `lib/queries.ts`

- [ ] **Step 1: 새 쿼리 함수 추가**

```typescript
// paragraph 단위 최신 draft
export async function getLatestDraftParagraph(
  sessionId: string, phase: Phase, paragraphIdx: number
): Promise<DraftRow | null>;

// paragraph 단위 commit된 draft
export async function getCommittedDraftParagraph(
  sessionId: string, phase: Phase, paragraphIdx: number
): Promise<DraftRow | null>;

// 본론 commit된 모든 문단을 idx 순으로
export async function getCommittedBodyParagraphs(
  sessionId: string
): Promise<DraftRow[]>;

// content_hash로 중복 체크
export async function findDuplicateDraft(
  sessionId: string, phase: Phase, paragraphIdx: number, contentHash: string
): Promise<DraftRow | null>;

// help_domain 카운트 (calibrator 행동 신호용)
export async function getHelpDomainCount(
  sessionId: string, phase: Phase, paragraphIdx: number | null
): Promise<{ idea: number; writing: number; both: number }>;
```

각 함수의 SQL은 paragraph_idx 필터 + ORDER BY id DESC 등으로 단순.

- [ ] **Step 2: 기존 queries (getLatestDraft, getCommittedDraft 등)을 paragraph_idx 인지하도록 시그니처 추가** (선택적 매개변수, 미지정 시 paragraph_idx=0 기본)

- [ ] **Step 3: tsc + Commit**

```bash
npx tsc --noEmit
git add lib/queries.ts
git commit -m "feat(queries): paragraph-level draft queries + duplicate hash check"
```

### Task 2.7: closure.ts — preceding 강화 (P1, 변경 없음에 가까움)

**Files:**
- Modify: `lib/persona.ts` (`buildClosurePrompt` 수정 — 본론 다문단 합쳐서 전달)
- Modify: `lib/queries.ts` (`getCommittedDraftsAll`을 본론 다문단 합쳐서 반환)

- [ ] **Step 1: getCommittedDraftsAll 변경**

```typescript
export async function getCommittedDraftsAll(sessionId: string): Promise<{
  intro: string;
  body: string;       // "1) ...\n\n2) ...\n\n3) ..." 형태 (본론 다문단 합침)
  conclusion: string;
}>;
```

- [ ] **Step 2: tsc + Commit**

```bash
npx tsc --noEmit
git add lib/persona.ts lib/queries.ts
git commit -m "feat(closure): aggregate body paragraphs for closure prompt"
```

---

## Phase 3 — API Routes (P0)

### Task 3.1: /sessions/[id]/draft — content_hash + paragraph_idx (P0)

**Files:**
- Modify: `app/api/sessions/[id]/draft/route.ts`

- [ ] **Step 1: 요청 body에 paragraphIdx 추가, content_hash 계산, 중복 INSERT skip**

```typescript
import { createHash } from 'node:crypto';
function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// POST body: { phase, paragraphIdx, content, source, precedingTurnId? }
// 1. content_hash 계산
// 2. 직전 동일 (session, phase, paragraphIdx)의 content_hash와 비교
//    동일 → INSERT skip, sessions.last_updated 갱신만
//    다름 → INSERT
```

- [ ] **Step 2: tsc + manual test (curl) + Commit**

```bash
npx tsc --noEmit
git add app/api/sessions/\[id\]/draft/route.ts
git commit -m "feat(api): draft route with content_hash dedup + paragraph_idx"
```

### Task 3.2: /sessions/[id]/turn — help_domain + paragraph_idx + calibration_id (P0)

**Files:**
- Modify: `app/api/sessions/[id]/turn/route.ts`

- [ ] **Step 1: help/submit 분기 로직 재작성** (spec §4.4)

`help` 트리거:
- body에 `helpDomain: 'idea' | 'writing' | 'both'` 받음
- evaluateDraft 호출 X (학생 의도대로)
- calibrate 호출 X (last calibration의 next_tone 유지 또는 default)
- LLM 시스템 프롬프트에 학생 선택 도메인 강제 (idea면 헌법 평가 안 함)
- turn 저장 시 help_domain 기록

`submit` 트리거:
- evaluateDraft 호출 (5 평가요소 + 헌법 신호)
- calibrate 호출 (next_tone, next_domain, weakestViolationLabel)
- calibration row 저장
- LLM 시스템 프롬프트에 게임 페르소나 + weakestViolationLabel 우선 짚기
- assistant turn에 calibration_id FK 저장

`chat` 트리거:
- 새 코드는 사용 안 함. enum은 그대로 두되 호출 안 됨.

- [ ] **Step 2: paragraphIdx 처리** — body 페이즈에서 학생이 어느 문단에 대해 help/submit한 건지 받음

- [ ] **Step 3: tsc + Commit**

```bash
npx tsc --noEmit
git add app/api/sessions/\[id\]/turn/route.ts
git commit -m "feat(api): turn route with help_domain branching + paragraph_idx + calibration_id"
```

### Task 3.3: /sessions/[id]/commit — paragraph_idx 단위 (P0)

**Files:**
- Modify: `app/api/sessions/[id]/commit/route.ts`

- [ ] **Step 1: body에 paragraphIdx 추가**

```typescript
// POST body: { phase, paragraphIdx }
// 1. (phase, paragraphIdx)의 최신 draft 조회
// 2. 'committed' source로 새 draft row INSERT (timeline 명시)
// 3. phase_paragraph_commits에 INSERT OR REPLACE
// 4. 다음 paragraph 결정:
//    - intro → next_phase = 'body', next_paragraph = 0
//    - body, paragraph_idx < total_body_paragraphs - 1 → 같은 phase, paragraph_idx + 1
//    - body, paragraph_idx == total_body_paragraphs - 1 → 'conclusion', 0
//    - conclusion → 'done'
// 5. sessions.current_phase 갱신
// total_body_paragraphs는 클라이언트가 함께 보내거나, 서버가 max(paragraph_idx)로 추론
```

- [ ] **Step 2: 응답 형식**

```typescript
{ committedDraftId: number, nextPhase: Phase, nextParagraphIdx: number | null }
```

- [ ] **Step 3: tsc + Commit**

```bash
npx tsc --noEmit
git add app/api/sessions/\[id\]/commit/route.ts
git commit -m "feat(api): commit at paragraph granularity"
```

### Task 3.4: /sessions/[id]/uncommit — 회귀 (P1)

**Files:**
- Create: `app/api/sessions/[id]/uncommit/route.ts`

- [ ] **Step 1: POST endpoint 구현**

```typescript
// POST body: { phase, paragraphIdx }
// 1. phase_paragraph_commits에서 row 삭제
// 2. draft_revisions에 'regress_uncommit' source row INSERT (content는 직전 committed draft 그대로 복사)
// 3. sessions.current_phase = 해당 phase로 되돌림 (학생이 회귀하기로 한 위치)
//    (단, 기존 작성 중이던 페이즈의 draft는 그대로 보존)
// 응답: { ok: true, currentPhase: phase, currentParagraphIdx: paragraphIdx }
```

- [ ] **Step 2: tsc + Commit**

```bash
npx tsc --noEmit
git add app/api/sessions/\[id\]/uncommit/route.ts
git commit -m "feat(api): uncommit endpoint for phase/paragraph regression"
```

### Task 3.5: /sessions/[id]/closure — preceding 강화 (P0)

**Files:**
- Modify: `app/api/sessions/[id]/closure/route.ts`

- [ ] **Step 1: getCommittedDraftsAll 변경된 형식 사용** — body가 다문단 합쳐진 string

prompt 변경 없음 (이미 fullDraft.body 받음). queries 변경에 의해 자동 반영.

- [ ] **Step 2: tsc + Commit (변경 없음에 가깝지만 schema 호환 확인)**

```bash
npx tsc --noEmit
git add app/api/sessions/\[id\]/closure/route.ts
git commit -m "fix(api): closure uses aggregated body paragraphs"
```

### Task 3.6: /sessions/[id]/export — 새 column 포함 (P0)

**Files:**
- Modify: `app/api/sessions/[id]/export/route.ts`

- [ ] **Step 1: drafts/turns/calibrations 모두 새 column 포함된 row 그대로 export** (변경 X, schema 호환만 확인)

- [ ] **Step 2: tsc + Commit**

```bash
npx tsc --noEmit
git add app/api/sessions/\[id\]/export/route.ts
git commit -m "fix(api): export route compatible with v2 schema"
```

### Task 3.7: /admin/sessions — paragraph stats (P1)

**Files:**
- Modify: `app/api/admin/sessions/route.ts`

- [ ] **Step 1: SQL에 본론 commit된 paragraph 수 추가**

```sql
SELECT s.*, ...,
  (SELECT COUNT(*) FROM phase_paragraph_commits c
   WHERE c.session_id = s.id AND c.phase = 'body') AS body_paragraph_count,
  ...
FROM sessions s
ORDER BY s.last_updated DESC
```

- [ ] **Step 2: tsc + Commit**

```bash
npx tsc --noEmit
git add app/api/admin/sessions/route.ts
git commit -m "feat(admin-api): include body_paragraph_count in session list"
```

---

## Phase 4 — Components (P0~P2)

### Task 4.1: FriendFace.tsx — 표정 reframing (P0)

**Files:**
- Modify: `components/FriendFace.tsx`

- [ ] **Step 1: 표정 디자인 변경 (spec §4.5)**

`mood='calm'` (less-annoying, 잘난 척):
- 기존: 둥근 눈 + 살짝 웃는 입
- 신규: 한쪽 눈 윙크 (선) + 입꼬리 한쪽 ↑ + 핑크볼 유지

`mood='sharp'` (annoying, 약오름):
- 기존: 한쪽 눈썹 올라간 + 한쪽 입꼬리
- 신규: 눈썹 V자 ↓ (양쪽 다 내려감) + 입 ⌒ ↓ + 빨간 볼 추가

SVG path 정확히 새로 그림. 핑크/빨간 볼은 `<circle>`로.

- [ ] **Step 2: aria-label 한국어 변경**: 'calm' → "잘난 척하는 친구", 'sharp' → "약오른 친구"

- [ ] **Step 3: Commit**

```bash
git add components/FriendFace.tsx
git commit -m "feat(component): FriendFace expressions reframed for game persona"
```

### Task 4.2: HelpDomainModal.tsx (P0, NEW)

**Files:**
- Create: `components/HelpDomainModal.tsx`

- [ ] **Step 1: 모달 컴포넌트 작성**

```tsx
'use client';
import type { HelpDomain } from '@/lib/types';

export interface HelpDomainModalProps {
  open: boolean;
  onSelect: (domain: HelpDomain) => void;
  onCancel: () => void;
}

// 3개 큰 버튼 (Fitts's Law):
// 💡 아이디어가 안 떠올라 → 'idea'
// ✏️ 글의 짜임이 헷갈려 → 'writing'
// 🤷 그냥 전부 다 봐줘 → 'both'
// ESC로 cancel, 배경 클릭으로 cancel
```

- [ ] **Step 2: ConfirmDialog 패턴 따라 fade-in/pop-in 애니메이션 적용**

- [ ] **Step 3: Commit**

```bash
git add components/HelpDomainModal.tsx
git commit -m "feat(component): HelpDomainModal for student-driven help routing"
```

### Task 4.3: BodyParagraphList.tsx (P0, NEW) — 동적 3~5문단 UI

**Files:**
- Create: `components/BodyParagraphList.tsx`

- [ ] **Step 1: 컴포넌트 시그니처**

```tsx
'use client';
import type { DraftRow } from '@/lib/types';

interface Props {
  paragraphs: { idx: number; content: string; committed: boolean }[];
  currentParagraphIdx: number;        // 현재 작업 중인 문단
  onChange: (idx: number, content: string) => void;
  onAdd: () => void;                  // + 문단 추가 (최대 5)
  onRemove: (idx: number) => void;    // − 문단 삭제 (최소 3)
  onSelect: (idx: number) => void;    // 다른 문단 선택
  disabledRemove?: boolean;
}
```

- [ ] **Step 2: UI 구성**

- 세로로 본론 1, 본론 2, ... 5까지 textarea 표시
- 각 textarea 위 라벨 + 우측 상단 `[− 삭제]` 작은 버튼 (3개 미만으로는 줄지 않음)
- 마지막 textarea 아래 `[+ 본론 문단 추가]` 큰 버튼 (5문단 이상이면 비활성)
- 현재 작업 중인 문단은 emerald 테두리 + 약간 확대
- commit 완료 문단은 회색 + 작은 ✓ 표시 (read-only)

- [ ] **Step 3: 자동 저장은 onChange를 부모(write 페이지)가 debounce해서 처리**

- [ ] **Step 4: Commit**

```bash
git add components/BodyParagraphList.tsx
git commit -m "feat(component): BodyParagraphList with dynamic add/remove (3-5)"
```

### Task 4.4: WinGauge.tsx (P1, NEW) — 승부 게이지

**Files:**
- Create: `components/WinGauge.tsx`

- [ ] **Step 1: 게이지 컴포넌트**

```tsx
interface Props {
  studentScore: number;  // 0~100, 학생 글의 5 평가요소 평균 × 100
}

// 가로 바: 학생 영역 (좌, emerald) | 친구 영역 (우, 빨강)
// studentScore가 높을수록 학생 영역이 길어지고, 친구 영역의 빨간 색이 진해짐
// 라벨: "학생 [████░░░░░░] 친구"
// 캡션: studentScore 기준
//   ≥ 70 → "친구가 약오르는 중 😤"
//   40~70 → "비등비등"
//   < 40 → "친구가 잘난 척 중 😏"
```

- [ ] **Step 2: 부드러운 transition (300ms)** — score 변화 시 애니메이션

- [ ] **Step 3: Commit**

```bash
git add components/WinGauge.tsx
git commit -m "feat(component): WinGauge for game persona visualization"
```

### Task 4.5: PrecedingContext.tsx (P1, NEW) — 이전 글 미니뷰

**Files:**
- Create: `components/PrecedingContext.tsx`

- [ ] **Step 1: 컴포넌트**

```tsx
interface Props {
  intro?: string;
  bodyParagraphs?: string[];
  currentPhase: 'body' | 'conclusion';
  currentParagraphIdx?: number;
}

// 회색 배경 작은 박스, 본문 글자 작게(text-xs).
// 펼침/접힘 토글 (기본 접힘, 클릭 시 확대 모달)
// 라벨: "지금까지 쓴 글"
// 본론 작성 중에는 서론 + 본론 1~i-1 모두
// 결론 작성 중에는 서론 + 본론 전체
```

- [ ] **Step 2: Commit**

```bash
git add components/PrecedingContext.tsx
git commit -m "feat(component): PrecedingContext mini-viewer for prior writing"
```

### Task 4.6: DraftDiff.tsx (P2, NEW, admin) — diff checker

**Files:**
- Create: `components/admin/DraftDiff.tsx`

- [ ] **Step 1: jsdiff로 inline diff 시각화**

```tsx
import { diffChars } from 'diff';

interface Props {
  previous: string;
  current: string;
}

// diffChars(previous, current)로 changes 배열 받음
// changes.map → added: <ins> 초록 배경, removed: <del> 빨강 strikethrough, normal: 회색 텍스트
// 한국어 char-level이 자연스러움
```

- [ ] **Step 2: 관리자 timeline 탭에서 연속 두 draft 사이 diff 자동 표시 옵션 추가**

- [ ] **Step 3: Commit**

```bash
git add components/admin/DraftDiff.tsx
git commit -m "feat(admin): DraftDiff inline char-level diff viewer"
```

---

## Phase 5 — Pages (P0~P1)

### Task 5.1: write 페이지 대대적 변경 (P0)

**Files:**
- Modify: `app/write/[sessionId]/page.tsx`

이 task는 다른 모든 변경을 통합하므로 가장 큼. 4개 sub-step으로 나눔.

- [ ] **Step 1: 채팅 input 폼 + chat trigger 로직 제거** (Q4)
  - `chatMessage` state 제거
  - `<form onSubmit={handleChat}>` 블록 제거
  - 사이드바를 "친구 반응 viewer"로 단순화

- [ ] **Step 2: 본론 페이즈에서 BodyParagraphList 적용** (Q1 C)
  - 본론 페이즈 진입 시 paragraphs state 초기화 (3개 기본)
  - 각 문단별 자동저장 (paragraph_idx 포함)
  - 도움/보여주기 버튼은 현재 작업 중인 문단에 대해 동작
  - commit도 paragraph_idx 단위
  - `+ 본론 문단 추가` / `− 삭제` 핸들러

- [ ] **Step 3: HelpDomainModal 통합** (Q2)
  - `💭 도움 받기` 클릭 → HelpDomainModal 열림
  - 학생 선택 → /turn API에 `trigger='help'`, `helpDomain` 전달
  - 보여주기는 ConfirmDialog 그대로

- [ ] **Step 4: WinGauge + PrecedingContext + 페이즈 인디케이터 클릭 회귀** (Q3, 1.3, Q6)
  - 사이드바에 WinGauge 추가 (마스코트 아래)
  - PrecedingContext 좌측 또는 textarea 위에 항상 가시
  - 페이즈 인디케이터 클릭 시 모달:
    - "그냥 보기만" / "다시 쓰기"
    - "다시 쓰기" → /uncommit API 호출 → 해당 phase/paragraph로 진입

- [ ] **Step 5: tsc + Commit**

```bash
npx tsc --noEmit
git add app/write/\[sessionId\]/page.tsx
git commit -m "feat(write): integrate body paragraphs, help modal, win gauge, regression, preceding context"
```

### Task 5.2: result 페이지 — 본론 다문단 표시 (P0)

**Files:**
- Modify: `app/result/[sessionId]/page.tsx`

- [ ] **Step 1: getPhaseDraft를 본론 다문단 합쳐서 반환하도록 변경**

기존: phase별 단일 content
변경: body는 paragraph_idx 순으로 모든 commit된 paragraph를 합쳐 표시

```typescript
function getBodyDrafts(drafts: DraftRow[]): { idx: number; content: string }[] {
  // body phase의 committed source draft를 paragraph_idx별로 추출
  // idx 순으로 정렬
}
```

- [ ] **Step 2: 표시 UI** — 본론 1, 본론 2, ... 각각 작은 헤딩과 함께

- [ ] **Step 3: Commit**

```bash
git add app/result/\[sessionId\]/page.tsx
git commit -m "feat(result): display body as multi-paragraph"
```

### Task 5.3: admin/sessions/[sessionId] — diff 시각화 (P2)

**Files:**
- Modify: `app/admin/sessions/[sessionId]/page.tsx`

- [ ] **Step 1: TimelineView에서 연속 draft 사이 DraftDiff 표시 옵션 추가**

- [ ] **Step 2: DraftsView에서 동일 (phase, paragraph_idx)의 연속 draft 사이 diff 토글**

- [ ] **Step 3: Commit**

```bash
git add app/admin/sessions/\[sessionId\]/page.tsx
git commit -m "feat(admin): integrate DraftDiff in timeline and drafts view"
```

---

## Phase 6 — 검증 (P0)

### Task 6.1: build 검증 (P0)

- [ ] **Step 1: 전체 production build 시도**

```bash
npm run build
```

기대: 모든 라우트 + Proxy(Middleware) 인식, 에러 0.

- [ ] **Step 2: 에러 발생 시 수정 후 재시도** (per error)

### Task 6.2: dev 서버 manual 검증 (P0)

- [ ] **Step 1: dev 서버 시작**

```bash
npm run dev
```

- [ ] **Step 2: 시나리오 검증 (브라우저)**

| 시나리오 | 기대 동작 |
|---|---|
| 1. 로비 → 새 세션 시작 | 정상 진입 |
| 2. 서론 작성 + 도움 받기 → 모달 → 'idea' 선택 | 친구 발화에 헌법 평가 X, 자유 사고 자극 |
| 3. 서론 작성 + 보여주기 | 헌법 신호 평가 → 친구 게임 페르소나 어조 |
| 4. 서론 commit → 본론 진입 | 본론 1, 2, 3 textarea 표시 |
| 5. 본론 1문단 작성 + 보여주기 | 헌법 신호 평가, 승부 게이지 변화 |
| 6. + 본론 문단 추가 | 4번째 textarea 등장 |
| 7. 본론 i문단 commit → 다음 문단 강조 | 자연스럽게 이동 |
| 8. 페이즈 인디케이터에서 서론 클릭 → 다시 쓰기 | uncommit + 서론 textarea 진입, 본론 작업 보존 |
| 9. 결론 commit → closure 생성 | result 페이지로 이동 |
| 10. 관리자 페이지 → 세션 상세 → diff 탭 | inline diff 표시 |

- [ ] **Step 3: 발견된 버그 수정 후 commit + 재검증**

### Task 6.3: 최종 검증 + Vercel 배포 (P0)

- [ ] **Step 1: lint + build**

```bash
npm run lint
npm run build
```

모두 통과 확인.

- [ ] **Step 2: Vercel 환경변수 확인**

`vercel env ls` 또는 대시보드에서:
- `TURSO_DATABASE_URL` ✓
- `TURSO_AUTH_TOKEN` ✓
- `ADMIN_PASSWORD` ✓

- [ ] **Step 3: production 배포**

```bash
git push origin main
# 또는
vercel --prod
```

배포 후 production URL에서 동일 시나리오 1~10 manual 검증.

- [ ] **Step 4: 5/9 simulated walkthrough 시작 준비 완료**

---

## 우선순위 요약 — 5/12 마감 압박 시 떨어뜨릴 순서

5/12 마감이 빠듯하면 다음 순서로 P2부터 떨어뜨림:

### 떨어뜨리기 1차 (작업량 ↓ 가장 큼, walkthrough 영향 적음)
- Task 4.6 DraftDiff (P2)
- Task 5.3 admin diff 시각화 (P2)
- Task 0.2 jsdiff 설치 (위 둘 미사용 시)

### 떨어뜨리기 2차 (UX 강화, 분석에는 무방)
- Task 4.4 WinGauge (P1) — 마스코트만 표정 변화로 충분
- Task 4.5 PrecedingContext (P1) — LLM이 prompt에서 알아서 처리

### 떨어뜨리기 3차 (회귀 기능 — 5/9 walkthrough에서는 사용 시나리오 적음)
- Task 3.4 /uncommit endpoint (P1)
- Task 5.1 Step 4의 회귀 모달 부분 (P1)

### 절대 떨어뜨리지 않음 (P0 핵심)
- Phase 0 (헌법 .md), Phase 1 (DB v2), Phase 2.1~2.6 (lib), Phase 3.1~3.3 (API 핵심), Phase 4.1~4.3 (FriendFace, HelpDomainModal, BodyParagraphList), Phase 5.1 Step 1~3 (채팅 제거, 본론 다문단, help modal), Phase 5.2 (result 다문단), Phase 6 (검증)

---

## Self-Review

- ✅ 모든 spec 결정(Q1~Q9)에 대응 task 존재 (Q1→4.3, Q2→3.2/4.2, Q3→4.1/4.4, Q4→5.1, Q5→2.2/2.3/2.4/2.5, Q6→3.4/5.1, Q7→4.6/5.3, Q8→3.1, Q9→1.1/1.2)
- ✅ 모든 task가 정확한 파일 경로 명시
- ✅ 핵심 task는 코드 시그니처/로직 구체화, 단순 task는 짧게 (스크립트 압축)
- ✅ "TBD/TODO/implement later" 등 placeholder 없음
- ✅ 우선순위 P0/P1/P2 명시 + 떨어뜨릴 순서 명확
- ✅ Phase 의존성 순으로 정렬 (헌법 .md → DB → lib → API → components → pages → 검증)
- ✅ 각 task 끝에 commit step 포함
- ⚠️ TDD 적용 부족 — 5/12 마감 압박 + 테스트 인프라 없음으로 lib/calibrator·closure 함수 단위 테스트는 별도 task로 추가 가능 (현재 manual 검증으로 갈음). spec §10에 명시.
