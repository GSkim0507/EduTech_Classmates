---
name: Annoying Classmate v2 — QA/QC 반영 시스템 재설계
description: 사용자 QA/QC 16개 요청사항 중 그룹 B(데이터 모델) + C(AI 피드백 정책) + D(UI/UX) 적용. A(회원/인증)·E(분석 보고서)는 docs/future-improvements.md로 이월.
type: spec
date: 2026-05-09
target: ICCE 2026 5/12 마감 walkthrough에 사용
authors: 김종범 (교신), 고현정, 김경수
---

# Annoying Classmate v2 — 시스템 재설계 spec

## 0. 절대 기준 (Source of Truth)

- 원본 컨셉: `/Users/ks.kim/Desktop/어노잉 클래스메이트 (원본_ 절대 수정 불가) (1).md`
- 글쓰기 규칙(헌법): `/Users/ks.kim/Desktop/rules/헌법_*.html` → 본 작업에서 `data/curriculum/헌법_*.md`로 변환
- ICCE 2026 short paper: 본 spec의 변경은 walkthrough 데이터 풍부화 목적

## 1. 배경

2026-05-08~09 사용자가 로컬 환경에서 직접 v1 시스템을 사용하며 16개 QA/QC 요청사항 도출. 분해 결과:
- **A. 회원/인증** (요청 7.1, 7.2, 7.3) → 추후 개선 (Phase 2)
- **B. 데이터 모델 재설계** (요청 6.1, 2.1, 5.2)
- **C. AI 피드백 정책** (요청 1.1, 1.2, 1.3, 1.4, 4.2, 3.1)
- **D. UI/UX 정책** (요청 2.2, 4.1, 5.1)
- **E. 산출 — 분석 보고서** (요청 5.3) → 추후 개선

본 spec은 B+C+D만 다룬다. A·E는 `docs/future-improvements.md` 참조.

## 2. 결정 요약 (브레인스토밍 합의)

| ID | 결정 | 의미 |
|---|---|---|
| **Q1** 본론 문단 수 | C — 동적 3~5문단 (학생이 작성 중 추가/삭제) | UI에 + / − 버튼 + 명확한 시각화 필요 |
| **Q2** 가로축·도움/보여주기 정책 | B — 도움=학생 선택 / 보여주기=시스템 자동 | 두 버튼 의미 차별화, 학생 주체성 + 시스템 평가 양립 |
| **Q3** 게임 페르소나 | A — 2단계 reframing + 승부 게이지 | 잘 쓰면 친구 약오름(annoying) / 못 쓰면 친구 잘난 척(less-annoying) |
| **Q4** 채팅창 정책 | A — 채팅창 완전 제거 | 학생 input 단일화 (textarea + 3개 버튼) |
| **Q5** 헌법 적용 | B — 헌법.md 시스템 프롬프트 + 헌법 핵심 신호 명시 평가 | 풍부함 + 일관성. 헌법 신호는 내부 메커니즘, 학생에게는 자연어로 변환 |
| **Q6** 회귀·다시 보기 | B — 보기 + 재진입 (commit 해제 후 재작성) | 데이터 timeline 보존, calibration 재발생 |
| **Q7** Diff Checker | B — inline + jsdiff 라이브러리 | 미세 변경까지 한눈에, 한국어 안정 |
| **Q8** 중복 Draft 제거 | A — 동일 content면 INSERT skip + content_hash | 무의미 row 제거, 분석 효율 ↑ |
| **Q9** ERD 변경 | 제안안 채택 (paragraph_idx, content_hash, help_domain, calibration_id, curriculum_signals_json, weakest_violation_label, regress_uncommit source) | 본론 다문단 + 헌법 신호 + 회귀 + 도움 추적 모두 반영 |

## 3. 새 데이터 모델 (ERD)

### 3.1 sessions (변경 없음)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  persona_name TEXT NOT NULL,
  grade INTEGER NOT NULL,
  topic TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_updated TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_phase TEXT NOT NULL DEFAULT 'intro'
);
```

### 3.2 draft_revisions (확장)

```sql
CREATE TABLE draft_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,                    -- intro | body | conclusion
  paragraph_idx INTEGER NOT NULL DEFAULT 0,  -- 서론/결론 = 0, 본론 = 0..4
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,             -- SHA-256 truncated, 중복 INSERT 방지용
  source TEXT NOT NULL,                   -- student_write | student_revise | committed | regress_uncommit
  preceding_turn_id INTEGER,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_drafts_session_phase_para
  ON draft_revisions(session_id, phase, paragraph_idx, timestamp);
```

**source 값 의미**:
- `student_write` — 학생이 글을 처음 작성 (피드백 받기 전)
- `student_revise` — 친구 피드백 후 학생이 수정
- `committed` — 학생이 이 문단/페이즈를 확정 (다음으로 진입)
- `regress_uncommit` — 학생이 회귀해서 commit 해제 (Q6 B)

**중복 방지 로직 (Q8)**:
- INSERT 전 직전 동일 (session, phase, paragraph_idx)의 content_hash와 비교
- 동일하면 skip (sessions.last_updated만 갱신)

### 3.3 turns (확장)

```sql
CREATE TABLE turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER,                  -- 본론 i문단 평가 시 i, 그 외 NULL
  role TEXT NOT NULL,                     -- student | assistant
  content TEXT NOT NULL,
  triggered_by TEXT,                      -- submit | help (chat은 제거)
  help_domain TEXT,                       -- idea | writing | both (학생이 도움 받기에서 선택)
  related_draft_id INTEGER,
  calibration_id INTEGER,                 -- 어느 calibration이 이 turn의 mode를 결정했는지
  tone TEXT,                              -- assistant: less-annoying | annoying
  domain TEXT,                            -- assistant: idea | writing
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (related_draft_id) REFERENCES draft_revisions(id),
  FOREIGN KEY (calibration_id) REFERENCES calibrations(id)
);

CREATE INDEX idx_turns_session ON turns(session_id, idx);
```

**chat trigger 제거 — Q4 결정**: `triggered_by`는 이제 `submit | help`만. 자유 채팅 없음.

### 3.4 phase_paragraph_commits (RENAME from phase_commits)

```sql
CREATE TABLE phase_paragraph_commits (
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER NOT NULL DEFAULT 0,
  committed_draft_id INTEGER NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (session_id, phase, paragraph_idx),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (committed_draft_id) REFERENCES draft_revisions(id)
);
```

**commit 단위**:
- 서론 = (intro, 0)
- 본론 = (body, 0), (body, 1), ... (body, N-1)
- 결론 = (conclusion, 0)

**회귀 시**: row 삭제 + draft_revisions에 `regress_uncommit` source row 1개 INSERT.

### 3.5 calibrations (확장)

```sql
CREATE TABLE calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  paragraph_idx INTEGER,                  -- 본론 i문단 평가 시 i
  trigger TEXT NOT NULL,                  -- submit | help
  draft_id INTEGER NOT NULL,
  signals_json TEXT NOT NULL,             -- 5 평가요소 + 행동 신호
  curriculum_signals_json TEXT,           -- 헌법 신호 (페이즈별 5-8개)
  next_tone TEXT NOT NULL,
  next_domain TEXT NOT NULL,
  weakest_violation_label TEXT,           -- 한국어 라벨 ("주제와의 어울림" 등)
  timestamp TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (draft_id) REFERENCES draft_revisions(id)
);
```

### 3.6 closures (변경 없음)

기존 그대로.

### 3.7 마이그레이션 전략

기존 DB와 비호환. 5/9 walkthrough 직전 단계라 **데이터 보존 필요 없음**:
1. 모든 테이블 DROP
2. 새 schema 적용
3. 기존 v1 세션 데이터는 백업 JSON으로 export 후 폐기

`scripts/db-migrate-v2.mjs` — DROP + CREATE 일괄 실행.

## 4. AI 피드백 정책 (그룹 C)

### 4.1 헌법 → Markdown 변환 (사전 작업)

`data/curriculum/헌법_{공통,서론,본론,결론}.html` → `.md`:
- HTML 태그 제거 + 평가 체크리스트는 그대로 보존
- LLM 시스템 프롬프트 토큰 효율 ↑
- `lib/curriculum.ts`의 `loadCurriculum()` 변경: `.md` 파일 직접 읽음

### 4.2 페이즈별 헌법 핵심 신호 (Q5)

LLM 평가 함수가 매 호출마다 다음 신호를 채워서 반환 (boolean 또는 0~1):

```typescript
// 5 평가요소 (기존)
type ScoreSignals = {
  claim_clarity: number | null;
  evidence_appropriateness: number | null;
  evidence_relevance: number | null;
  expression_appropriateness: number | null;
  structural_coherence: number | null;
};

// 헌법 신호 (NEW, 페이즈별 분기)
type CurriculumSignals =
  | IntroSignals
  | BodySignals
  | ConclusionSignals;

interface IntroSignals {
  phase: 'intro';
  thesis_present: boolean;          // 핵심 명제 존재 (제8조 ①)
  thesis_singular: boolean;         // 단일 주장 (제8조 ②)
  thesis_assertive_form: boolean;   // "~해야 한다" 형태 (제8조 ③)
  intro_method_label: string | null;  // 도입 방법 6가지 중 (또는 null)
}

interface BodySignals {
  phase: 'body';
  paragraph_idx: number;
  topic_sentence_present: boolean;       // 소주제문 존재 (제10조 ①)
  argument_method_identifiable: boolean; // 논증 방법 명시성 (제11조)
  argument_method_label: string | null;  // 부연/예증/비유/방법/인과 중
  appropriateness_to_thesis: number;     // 0~1, 핵심 명제와의 정합성
  appropriateness_to_preceding: number;  // 0~1, 이전 본론 문단과의 비중복·일관성
  link_word_used: boolean;               // 첫째/또한 등 연결어 (제9조 ③)
}

interface ConclusionSignals {
  phase: 'conclusion';
  summary_present: boolean;        // 근거 요약 (제13조)
  summary_concise: boolean;        // 간결성
  punch_line_present: boolean;     // 강조 (제14조)
  punch_line_method_label: string | null;  // 재강조/미래전망/명언 중
  no_new_argument: boolean;        // 본론에 없던 새 근거 추가 X (제12조 ②)
  thesis_recall_clear: boolean;    // 핵심 명제 재확인 명료성
}
```

**저장 위치**: `calibrations.curriculum_signals_json`.

### 4.3 앞 문단 맥락 (Q5, 요청 1.3)

`evaluateDraft()`와 `buildSystemPrompt()` 모두에 `precedingContent` 매개변수 추가:

```typescript
interface PrecedingContent {
  intro?: string;              // 서론 commit 본
  bodyParagraphs?: string[];   // 본론 1..i-1 commit 본 (현재 본론 i문단 평가 시)
}
```

LLM은 이 컨텍스트로 *주제·논리 일관성*을 명시적으로 평가/되묻기 가능.

### 4.4 도움 vs 보여주기 분기 (Q2)

#### 도움 받기 (`triggered_by='help'`)
1. 학생이 `💭 도움 받기` 버튼 클릭
2. 모달 등장: "어디서 막혔어?" — 3개 큰 버튼:
   - 💡 아이디어가 안 떠올라 (`help_domain='idea'`)
   - ✏️ 글의 짜임이 헷갈려 (`help_domain='writing'`)
   - 🤷 그냥 전부 다 봐줘 (`help_domain='both'`)
3. 학생 선택 → API 호출 → LLM 시스템 프롬프트에 `domain` 강제 (학생이 idea 선택 → 친구는 idea 영역만, 헌법 평가는 안 함)
4. evaluateDraft는 호출 안 함 (calibrate skip, 학생 의도 그대로)
5. tone은 직전 calibration의 next_tone 유지 또는 default `less-annoying`

#### 친구에게 보여주기 (`triggered_by='submit'`)
1. 학생이 `👀 친구한테 보여주기` 클릭 + confirm
2. evaluateDraft 호출 (5 평가요소 + 헌법 신호)
3. calibrate 호출 (next_tone, next_domain, weakest_violation_label 결정)
4. LLM 시스템 프롬프트: 게임 페르소나 + 헌법 신호 + weakest 영역 우선 짚기
5. tone은 자동 결정 (잘 쓰면 annoying, 못 쓰면 less-annoying)

### 4.5 게임 페르소나 (Q3, 요청 3.1)

#### Tone reframing
- `less-annoying` = 친구가 학생 못 쓰는 거 보고 잘난 척하는 모드. "에이~ 그것도 모르겠어? 천천히 같이 해보자"
- `annoying` = 친구가 학생 잘 쓰는 거 보고 약 올라하는 모드. "헐... 좋네. 근데 이건 어때? 인정 못 해 아직"

시스템 프롬프트에 게임 페르소나 명시 단락 추가:

```
## 너의 게임 페르소나
- 친구는 학생을 라이벌로 본다.
- 학생이 글을 잘 쓰면 약이 오른다 (annoying mode). 인정하기 싫어 더 깐깐하게 도전한다.
- 학생이 글을 못 쓰면 잘난 척한다 (less-annoying mode). 살짝 비꼬며 도와준다.
- 둘 다 친구로서의 친근함 + 반말은 유지.
```

#### 표정 디자인 변경 (FriendFace.tsx)

```
calm (less-annoying) — 잘난 척
  - 한쪽 눈 윙크 + 입꼬리 한쪽 ↑
  - 핑크볼

sharp (annoying) — 약오름
  - 눈썹 V자 ↓
  - 입 ⌒ ↓
  - 살짝 빨간 볼 (분노 톤)
```

#### 승부 게이지 (NEW)

사이드바 마스코트 아래 작은 게이지 바:

```
[ 학생 ████░░░░░░ 친구 ]
```

- 게이지 = `100 - calibration의 weighted score (예: 5 평가요소 평균 × 100)` 근사
- 학생이 잘 쓸수록 좌측 길어짐 + 우측 영역이 빨갛게 변함 (친구 약오른 시각화)
- 시간순 변화는 따로 표시 안 함 (현재 값만)
- 미평가 상태(서론 시작 시점)는 50:50

### 4.6 LLM 응답 prompt 가이드 (UX 라이팅, 사용자 명시 요구)

`lib/persona.ts`의 시스템 프롬프트에 다음 어조 가이드 강제:

```
## 응답 어조 (반드시 지킬 것)

학생에게 절대 다음 형태로 말하지 마라:
- "5점 만점에 X점"
- "thesis_singular: false"
- "헌법 제8조 위반"

대신 다음 패턴만 사용:
- 인정형(잘한 부분): "이 부분 진짜 인정", "잘 썼네", "○○이 좋다"
- 아쉬움(약한 부분): "○○가 살짝 아쉬워", "○○가 더 좋아지면", "○○를 한 번 더 봐줘"
- 게임 어투(annoying mode): "헐... 근데", "쳇", "두고 봐", "인정 못 해"
- 게임 어투(less-annoying mode): "에이~", "그것도 모르겠어?", "천천히 같이"
- 한 번에 한두 문장으로 짧게.
- 한국어 반말, 또래 어투.
```

## 5. UI/UX 정책 (그룹 D)

### 5.1 본론 동적 다문단 UX (Q1 C)

본론 페이즈 진입 시:
- 기본 3개 문단 textarea가 세로로 표시됨
- 각 textarea 위에 라벨: `본론 1`, `본론 2`, `본론 3`
- 마지막 textarea 아래에 `[+ 문단 추가]` 버튼 (4·5번째까지 가능, 최대 5)
- 각 textarea 우측 상단에 `[− 이 문단 삭제]` 작은 버튼 (3개 미만으로는 줄지 않음)
- 각 문단마다 독립적으로 도움/보여주기 버튼 (Q2 정책)
- 각 문단 commit 후 다음 문단 입력 강조 (스크롤 + 시각 강조)
- 모든 본론 문단 commit 완료 시 "다음 (결론으로)" 버튼 활성화

### 5.2 회귀·다시 보기 (Q6 B)

상단 페이즈 인디케이터(이미 존재) 클릭 가능하게 변경:
- commit 완료 페이즈 클릭 → 모달:
  - "그냥 보기만" → read-only popover로 펼침
  - "다시 쓰기" → confirm: "현재 진행 중인 작업은 그대로 두고, ○○을 수정할게요" → commit 해제 + 해당 페이즈/문단 textarea로 진입

상시 가시 컨텍스트 패널:
- 본론 i문단 작성 중에 좌측 상단 또는 아래에 "지금까지 쓴 글" 작은 박스: 서론(commit) + 본론 1~i-1(commit). 텍스트 작게, 회색 톤. 클릭 시 확대 가능.
- 결론 작성 중에 서론 + 본론 전체 미니뷰 표시.

### 5.3 채팅창 제거 (Q4 A)

- `app/write/[sessionId]/page.tsx`에서 채팅 input 폼 + chat trigger 로직 모두 제거
- 사이드바는 "친구의 반응을 보는 창"으로 단순화 (turn 표시만)
- DB schema에서 chat trigger 자체는 historic data 위해 enum 그대로 두되, 새 코드에서는 호출 안 함

### 5.4 도움 받기 모달 (Q2)

```tsx
<HelpDomainModal>
  <h2>어디서 막혔어?</h2>
  <Button icon="💡" label="아이디어가 안 떠올라" />
  <Button icon="✏️" label="글의 짜임이 헷갈려" />
  <Button icon="🤷" label="그냥 전부 다 봐줘" />
</HelpDomainModal>
```

각 버튼은 큼직(Fitts's Law). 선택 시 `help_domain` 결정 후 `/turn` API 호출.

## 6. 관리자 영역 (Q7)

### 6.1 Diff Checker

- 패키지 추가: `npm install diff` (jsdiff)
- 새 컴포넌트: `components/admin/DraftDiff.tsx`
  - props: `previous: string, current: string`
  - `diffChars` 또는 `diffWordsWithSpace` 사용 (한국어는 char-level이 더 안정)
  - 추가 부분 = `<ins>` 초록 배경 / 삭제 부분 = `<del>` 빨강 strikethrough / 동일 부분 = 회색 텍스트
- 관리자 페이지 `/admin/sessions/[sessionId]`의 timeline 탭에서 연속된 두 draft 사이 diff 자동 표시
- 별도 "Diff" 탭에서 한 phase의 모든 draft revision 변화를 누적 시각화 (선택)

### 6.2 중복 draft 시각 정리 (Q8 후속)

- 현재 timeline에서 연속된 동일 content draft는 schema-level에서 INSERT skip
- 따라서 관리자 UI는 자연스럽게 의미있는 변화만 표시
- 추가: 같은 content_hash가 다른 시점에 등장(회귀 후 재작성하다 동일하게 끝남) 시 구분 마크

## 7. 작업 순서 (구현 단계)

1. **헌법 .md 변환** (사전, 작은 스크립트)
2. **DB v2 마이그레이션** — 기존 DROP + 새 schema CREATE
3. **lib 확장**:
   - `curriculum.ts` — 헌법 신호 정의 + 페이즈별 평가 prompt
   - `claude.ts` — `evaluateDraft()` 헌법 신호 반환 추가, precedingContent 추가
   - `persona.ts` — 게임 페르소나 + UX 라이팅 가이드 + 헌법 weakest_violation 짚기
   - `calibrator.ts` — 5 평가요소 + 헌법 신호 통합 → next_tone/domain/weakest_violation_label
   - `closure.ts` — (변경 없음, prompt만 일부)
   - `queries.ts` — paragraph_idx 인덱싱, getCommittedParagraphs 등 추가
4. **API routes 변경**:
   - `/sessions/[id]/draft` — content_hash 비교 + paragraph_idx
   - `/sessions/[id]/turn` — help_domain, paragraph_idx, calibration_id 처리
   - `/sessions/[id]/commit` — paragraph_idx 단위 commit
   - `/sessions/[id]/uncommit` (NEW) — 회귀 처리
   - `/admin/sessions` — paragraph 단위 stats
5. **components**:
   - `FriendFace.tsx` — 표정 디자인 reframing
   - `HelpDomainModal.tsx` (NEW)
   - `BodyParagraphList.tsx` (NEW) — 동적 3~5문단 UI
   - `WinGauge.tsx` (NEW) — 승부 게이지
   - `PrecedingContext.tsx` (NEW) — 이전 글 미니뷰
   - `DraftDiff.tsx` (NEW, admin)
6. **pages**:
   - `app/page.tsx` — (변경 없음, 기존 구조)
   - `app/write/[sessionId]/page.tsx` — 대대적 변경 (본론 다문단, 채팅 제거, 회귀, 게이지)
   - `app/result/[sessionId]/page.tsx` — 본론 다문단 표시
   - `app/admin/sessions/[sessionId]/page.tsx` — diff 시각화
7. **build 검증 + dev 테스트**

## 8. UX 라이팅 정책 (학생 친화 어조)

(반복 강조 — 사용자 Q5 추가 질문에서 명시 요청)

- 모든 학생 대면 발화는 LLM이 친구 어투(반말, 한두 문장)로 자연어 생성
- 헌법 신호·5 평가요소 점수는 절대 학생 화면에 노출 X
- 분석 결과는 "○○가 좋아", "○○가 살짝 아쉬워" 같은 자연어로만 표현
- 게임 페르소나에 맞춘 약오름/잘난 척 어투 일관 유지
- 관리자 페이지(연구자용)에서만 raw 신호 노출 가능

## 9. 한계 및 추후 개선

- **A. 회원/인증** — 본 spec 범위 외. `docs/future-improvements.md` 참조.
- **E. 분석 보고서** — 본 spec 범위 외. `docs/future-improvements.md` 참조.
- **본 spec의 한계**: paragraph_idx 인덱싱이 늘어나서 SQL JOIN 복잡도 약간 ↑. 5/9 walkthrough에서 충분히 검증되면 그대로 유지.
- **chat trigger DB enum**: 기존 데이터 호환을 위해 `triggered_by` enum에 'chat' 그대로 둠. 새 코드는 호출 안 함.
- **5/12 마감 압박**: 본 spec의 모든 항목을 한 번에 구현하기에 작업량이 큼. 다음 단계(writing-plans)에서 우선순위 다시 한 번 점검.

## 10. 작성 후 자가 점검 (self-review)

- ✅ 모든 결정이 Q1~Q9에 대응됨
- ✅ 그룹 A·E는 명시적으로 추후 이월
- ✅ Schema 변경이 모든 후속 변경(API, UI, 관리자)에 일관되게 반영
- ✅ UX 라이팅 정책이 학생 화면 전체에 적용됨을 명시
- ✅ Placeholder 없음 (TBD/TODO 마커 없음)
- ✅ 작업 순서가 의존성 순으로 나열됨
