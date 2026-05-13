'use client';

import { useState, useEffect, useRef, use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type {
  SessionRow,
  DraftRow,
  TurnRow,
  CalibrationRow,
  Phase,
  Tone,
  HelpDomain,
  PhaseParagraphCommitRow,
} from '@/lib/types';
import FriendFace, { FriendFaceMini } from '@/components/FriendFace';
import { computeAccumulatedGauge, scoreFromSignalsJson } from '@/lib/gauge';
import { showToast } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import HelpDomainModal from '@/components/HelpDomainModal';
import BodyParagraphList, {
  type BodyParagraph,
} from '@/components/BodyParagraphList';
import WinGauge from '@/components/WinGauge';
import PrecedingContext from '@/components/PrecedingContext';
import DictionaryFloater from '@/components/DictionaryFloater';

const API_KEY_STORAGE = 'annoying-classmate:api-key';
const TUTORIAL_SHOWN_KEY = 'annoying-classmate:tutorial-shown';
const HELP_PER_CONTEXT = 2; // 문단별·페이즈별 "같이 고민" 카드 2장

// sessionStorage 임시 저장 키 — 학생이 액션 버튼을 누르기 전 keystroke만 보관.
// 탭 종료 시 브라우저가 자동 삭제. DB에는 액션 시점에만 반영된다.
const SS_DRAFT_PREFIX = 'annoying-classmate:draft';

function draftStorageKey(sessionId: string, phase: string, paragraphIdx: number): string {
  return `${SS_DRAFT_PREFIX}:${sessionId}:${phase}:${paragraphIdx}`;
}

function readLocalDraft(sessionId: string, phase: string, paragraphIdx: number): string | null {
  try {
    const raw = sessionStorage.getItem(draftStorageKey(sessionId, phase, paragraphIdx));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { content?: unknown };
    return typeof parsed.content === 'string' ? parsed.content : null;
  } catch {
    return null;
  }
}

function clearAllLocalDrafts(sessionId: string): void {
  try {
    const prefix = `${SS_DRAFT_PREFIX}:${sessionId}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}

const PHASE_LABEL: Record<Exclude<Phase, 'done'>, string> = {
  intro: '서론',
  body: '본론',
  conclusion: '결론',
  title: '제목',
};
const PHASE_ORDER: Exclude<Phase, 'done'>[] = ['intro', 'body', 'conclusion', 'title'];

const PHASE_HINT: Record<Exclude<Phase, 'done'>, string> = {
  intro:
    '서론에서는 사회적 맥락을 짧게 보여주고, 글 전체의 핵심 명제(주장)를 한 문장으로 분명히 밝혀줘.',
  body:
    '본론은 두세~다섯 문단으로 구성해. 각 문단마다 소주제문 + 다각적 논증(부연/예증/비유/방법/인과)을 써줘.',
  conclusion:
    '결론은 본론의 근거를 짧게 정리하고, 핵심 명제를 강조하는 한 문장으로 마무리해. 새 근거는 추가하지 말고.',
  title:
    '글 전체를 잘 보여줄 제목을 한 줄로 정해봐. 너무 길지 않게(10~25자), 주장이나 호기심이 보이게!',
};

interface SessionState {
  session: SessionRow;
  drafts: DraftRow[];
  turns: TurnRow[];
  calibrations: CalibrationRow[];
  phase_commits?: PhaseParagraphCommitRow[];
  closure: unknown;
}

type ConfirmKind =
  | { kind: 'submit'; paragraphIdx?: number }
  | { kind: 'commit' }
  | { kind: 'finalize' }
  | { kind: 'regress'; phase: Exclude<Phase, 'done'>; paragraphIdx: number }
  | null;

// 본론은 최소 1문단(페널티), 정석 3문단(default), 최대 5문단
const MIN_PARA = 1;
const DEFAULT_PARA = 3;
const MAX_PARA = 5;

export default function WritePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();

  const [state, setState] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');

  // 서론·결론·제목 단일 draft / 본론 다문단
  const [introText, setIntroText] = useState('');
  const [conclusionText, setConclusionText] = useState('');
  const [titleText, setTitleText] = useState('');
  const [bodyParagraphs, setBodyParagraphs] = useState<BodyParagraph[]>([]);
  const [currentBodyIdx, setCurrentBodyIdx] = useState(0);

  const [hasFeedbackForCurrent, setHasFeedbackForCurrent] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    'submit' | 'help' | 'commit' | 'regress' | null
  >(null);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  // body phase에서 도움받기/보여주기를 어느 문단에 대해 호출했는지 추적
  const [helpForBodyIdx, setHelpForBodyIdx] = useState<number | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  // 첫 진입 시 1회성 안내 (localStorage 기반)
  useEffect(() => {
    try {
      if (!localStorage.getItem(TUTORIAL_SHOWN_KEY)) {
        setTutorialOpen(true);
      }
    } catch {
      // ignore
    }
  }, []);
  function dismissTutorial() {
    try {
      localStorage.setItem(TUTORIAL_SHOWN_KEY, '1');
    } catch {
      // ignore
    }
    setTutorialOpen(false);
  }

  const lastSavedRef = useRef<{ phase: Phase; paragraphIdx: number; content: string } | null>(
    null
  );
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 자동저장 timer가 어떤 (phase, paragraphIdx)에 대한 저장인지 명시 보관 — 클로저 캡처 X
  const pendingSaveRef = useRef<{
    phase: Exclude<Phase, 'done'>;
    paragraphIdx: number;
    content: string;
    source: 'student_write' | 'student_revise';
  } | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const cachedKey = sessionStorage.getItem(API_KEY_STORAGE);
    if (cachedKey) setApiKey(cachedKey);
  }, []);

  // ─── 상태 fetch + 복원 ───
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '세션 로드 실패');
      setState(data);
      const phase = data.session.current_phase as Phase;
      if (phase === 'done') {
        router.replace(`/result/${sessionId}`);
        return;
      }

      const drafts = data.drafts as DraftRow[];
      const commits = (data.phase_commits ?? []) as PhaseParagraphCommitRow[];

      // 서론 복원 — sessionStorage(미액션 keystroke)가 있으면 우선, 없으면 DB
      const introDrafts = drafts.filter((d) => d.phase === 'intro');
      const introDb = introDrafts[introDrafts.length - 1]?.content ?? '';
      setIntroText(readLocalDraft(sessionId, 'intro', 0) ?? introDb);

      // 결론 복원
      const conclDrafts = drafts.filter((d) => d.phase === 'conclusion');
      const conclDb = conclDrafts[conclDrafts.length - 1]?.content ?? '';
      setConclusionText(readLocalDraft(sessionId, 'conclusion', 0) ?? conclDb);

      // 제목 복원
      const titleDrafts = drafts.filter((d) => d.phase === 'title');
      const titleDb = titleDrafts[titleDrafts.length - 1]?.content ?? '';
      setTitleText(readLocalDraft(sessionId, 'title', 0) ?? titleDb);

      // 본론 복원 — paragraph_idx별 최신 draft + commit 여부
      const bodyDraftsByIdx: Record<number, DraftRow[]> = {};
      drafts
        .filter((d) => d.phase === 'body')
        .forEach((d) => {
          if (!bodyDraftsByIdx[d.paragraph_idx]) bodyDraftsByIdx[d.paragraph_idx] = [];
          bodyDraftsByIdx[d.paragraph_idx].push(d);
        });
      const bodyCommitIdx = new Set(
        commits.filter((c) => c.phase === 'body').map((c) => c.paragraph_idx)
      );
      const indices = Object.keys(bodyDraftsByIdx)
        .map((s) => Number(s))
        .sort((a, b) => a - b);
      const maxIdx = indices.length > 0 ? Math.max(...indices) : -1;
      // 신규 진입은 정석 3문단 default, 이미 작성된 문단이 더 많으면 그만큼 표시
      const paragraphCount = Math.max(DEFAULT_PARA, maxIdx + 1);

      const paras: BodyParagraph[] = [];
      for (let i = 0; i < paragraphCount; i++) {
        const list = bodyDraftsByIdx[i] ?? [];
        const last = list[list.length - 1];
        const localBody = readLocalDraft(sessionId, 'body', i);
        paras.push({
          idx: i,
          content: localBody ?? last?.content ?? '',
          committed: bodyCommitIdx.has(i),
        });
      }
      setBodyParagraphs(paras);

      // 현재 작업 중인 본론 문단 = 처음 commit 안 된 것
      const firstUncommittedBody = paras.find((p) => !p.committed);
      const newBodyIdx = firstUncommittedBody?.idx ?? 0;
      setCurrentBodyIdx(newBodyIdx);

      // hasFeedback 결정 — 현재 phase/paragraphIdx의 마지막 turn이 assistant인가
      const turns = data.turns as TurnRow[];
      const currentParaIdx = phase === 'body' ? newBodyIdx : 0;
      const matching = turns.filter(
        (t) =>
          t.phase === phase &&
          (phase !== 'body' || t.paragraph_idx === currentParaIdx)
      );
      const lastAssistantTurn = [...matching]
        .reverse()
        .find((t) => t.role === 'assistant');
      setHasFeedbackForCurrent(Boolean(lastAssistantTurn));

      // lastSavedRef 초기화 — 자동저장 직전 비교용
      lastSavedRef.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, router]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state?.turns?.length, pendingAction]);

  // ─── 현재 작업 중인 텍스트 + paragraphIdx ───
  const phase = (state?.session.current_phase ?? 'intro') as Exclude<Phase, 'done'>;
  const currentParagraphIdx = phase === 'body' ? currentBodyIdx : 0;

  function getCurrentText(): string {
    if (phase === 'intro') return introText;
    if (phase === 'conclusion') return conclusionText;
    if (phase === 'title') return titleText;
    return bodyParagraphs[currentBodyIdx]?.content ?? '';
  }

  // ─── 자동 저장 (로컬 임시본만) ───
  // 학생 keystroke는 1.1s debounce 후 sessionStorage에만 기록. DB POST는 안 한다.
  // 액션 버튼('같이 고민' / '친구 설득' / '친구한테 보여주기' / '다음으로')이 눌렸을 때만
  // flushAutosave()가 1회 DB에 반영 — 그 외 keystroke는 DB에 절대 들어가지 않는다.
  // sessionStorage는 탭 종료 시 브라우저가 자동 정리한다.
  function scheduleAutosave(
    text: string,
    targetPhase?: Exclude<Phase, 'done'>,
    targetParagraphIdx?: number
  ) {
    const tphase = targetPhase ?? phase;
    const tidx = typeof targetParagraphIdx === 'number' ? targetParagraphIdx : currentParagraphIdx;
    const source = hasFeedbackForCurrent ? 'student_revise' : 'student_write';

    pendingSaveRef.current = { phase: tphase, paragraphIdx: tidx, content: text, source };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        sessionStorage.setItem(
          draftStorageKey(sessionId, tphase, tidx),
          JSON.stringify({ content: text, source, savedAt: Date.now() })
        );
      } catch (err) {
        console.warn('local autosave failed', err);
      }
    }, 1100);
  }

  // 동기 액션 직전 호출 — 가장 최신 pending save가 있으면 그 페어로 즉시 저장.
  async function flushAutosave(
    forceSource?: 'student_write' | 'student_revise',
    targetPhase?: Exclude<Phase, 'done'>,
    targetParagraphIdx?: number
  ) {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    // 명시 인자가 있으면 그 페어 우선, 아니면 pending (가장 최근 keystroke), 아니면 fallback.
    const tphase = targetPhase ?? pending?.phase ?? phase;
    const tidx =
      typeof targetParagraphIdx === 'number'
        ? targetParagraphIdx
        : (pending?.paragraphIdx ?? currentParagraphIdx);
    const text =
      pending && pending.phase === tphase && pending.paragraphIdx === tidx
        ? pending.content
        : (() => {
            // pending이 다른 컨텍스트면 현재 state에서 읽는다.
            if (tphase === 'intro') return introText;
            if (tphase === 'conclusion') return conclusionText;
            if (tphase === 'title') return titleText;
            return bodyParagraphs[tidx]?.content ?? '';
          })();

    const last = lastSavedRef.current;
    if (
      last &&
      last.phase === tphase &&
      last.paragraphIdx === tidx &&
      last.content === text
    ) {
      pendingSaveRef.current = null;
      return;
    }
    const source =
      forceSource ?? pending?.source ?? (hasFeedbackForCurrent ? 'student_revise' : 'student_write');
    await fetch(`/api/sessions/${sessionId}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase: tphase,
        paragraphIdx: tidx,
        content: text,
        source,
      }),
    });
    lastSavedRef.current = { phase: tphase, paragraphIdx: tidx, content: text };
    pendingSaveRef.current = null;
    // DB 반영됐으므로 동일 (phase, idx)의 sessionStorage 임시본은 제거 — 메모리 누적 방지
    try {
      sessionStorage.removeItem(draftStorageKey(sessionId, tphase, tidx));
    } catch {
      // ignore
    }
  }

  // ─── 텍스트 변경 핸들러 ───
  function handleIntroChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setIntroText(v);
    scheduleAutosave(v, 'intro', 0);
  }
  function handleConclusionChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setConclusionText(v);
    scheduleAutosave(v, 'conclusion', 0);
  }
  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setTitleText(v);
    scheduleAutosave(v, 'title', 0);
  }
  function handleBodyChange(idx: number, content: string) {
    setBodyParagraphs((prev) => prev.map((p) => (p.idx === idx ? { ...p, content } : p)));
    // 입력한 paragraph로 currentBodyIdx 동적 변경 (다른 액션에서 사용)
    setCurrentBodyIdx(idx);
    // race condition 방지: 다른 문단 저장 메타 무효화 후, 명시적으로 (body, idx) 저장 예약
    lastSavedRef.current = null;
    scheduleAutosave(content, 'body', idx);
  }
  // body paragraph별 도움/설득하기 핸들러
  function handleParagraphHelp(idx: number) {
    // 카드 잔여 체크 (서버에서 다시 검증되지만 UX 안내)
    const remaining = helpRemainingByBodyIdx[idx] ?? HELP_PER_CONTEXT;
    if (remaining <= 0) {
      setError('이 문단의 도움 카드를 모두 썼어. 친구 설득하기로 평가 받아봐!');
      return;
    }
    setHelpForBodyIdx(idx);
    setCurrentBodyIdx(idx);
    lastSavedRef.current = null;
    setHelpModalOpen(true);
  }
  function handleParagraphShow(idx: number) {
    setHelpForBodyIdx(idx);
    setCurrentBodyIdx(idx);
    lastSavedRef.current = null;
    setConfirmKind({ kind: 'submit', paragraphIdx: idx });
  }

  function handleBodyAdd() {
    setBodyParagraphs((prev) =>
      prev.length >= MAX_PARA
        ? prev
        : [...prev, { idx: prev.length, content: '', committed: false }]
    );
  }
  function handleBodyRemove(idx: number) {
    setBodyParagraphs((prev) => {
      if (prev.length <= MIN_PARA) return prev;
      const filtered = prev.filter((p) => p.idx !== idx);
      // idx 재정렬
      return filtered.map((p, i) => ({ ...p, idx: i }));
    });
    if (currentBodyIdx >= idx) setCurrentBodyIdx(Math.max(0, currentBodyIdx - 1));
  }

  // ─── 도움 받기 ───
  async function handleHelpDomain(domain: HelpDomain) {
    setHelpModalOpen(false);
    setError(null);
    const targetIdx =
      phase === 'body' ? (typeof helpForBodyIdx === 'number' ? helpForBodyIdx : currentBodyIdx) : 0;
    const text =
      phase === 'body' ? bodyParagraphs[targetIdx]?.content ?? '' : getCurrentText();
    if (!text.trim()) {
      setError('일단 글을 조금 써 봐.');
      return;
    }
    await flushAutosave(undefined, phase, targetIdx);
    setPendingAction('help');
    try {
      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          trigger: 'help',
          // body 페이즈는 학생이 클릭한 문단(targetIdx)에 대해 평가
          paragraphIdx: phase === 'body' ? targetIdx : 0,
          helpDomain: domain,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.detail ?? 'AI 응답 실패');
      await fetchState();
      setHasFeedbackForCurrent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  // ─── 친구한테 보여주기 (submit) ───
  async function performSubmit(targetParagraphIdx?: number) {
    setError(null);
    // body 페이즈에서 학생이 클릭한 문단의 텍스트 검사
    const text =
      phase === 'body' && typeof targetParagraphIdx === 'number'
        ? bodyParagraphs[targetParagraphIdx]?.content ?? ''
        : getCurrentText();
    if (!text.trim()) {
      setError('일단 글을 조금 써 봐.');
      return;
    }
    if (phase === 'body' && typeof targetParagraphIdx === 'number') {
      setHelpForBodyIdx(targetParagraphIdx);
      setCurrentBodyIdx(targetParagraphIdx); // autosave 정렬
      lastSavedRef.current = null;
    }
    const flushIdx = phase === 'body' && typeof targetParagraphIdx === 'number' ? targetParagraphIdx : 0;
    await flushAutosave(undefined, phase, flushIdx);
    setPendingAction('submit');
    try {
      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          trigger: 'submit',
          // body는 학생이 클릭한 문단에 대해, 그 외는 0
          paragraphIdx:
            phase === 'body'
              ? typeof targetParagraphIdx === 'number'
                ? targetParagraphIdx
                : null
              : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.detail ?? 'AI 응답 실패');
      await fetchState();
      setHasFeedbackForCurrent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  // ─── commit (다음 페이즈/문단) ───
  async function performCommit() {
    setError(null);
    const text = getCurrentText();
    if (!text.trim()) {
      setError('확정할 글이 비어있어.');
      return;
    }
    setPendingAction('commit');
    try {
      // commit 직전 flush — body면 현재 문단 idx, 그 외는 0.
      await flushAutosave('student_revise', phase, phase === 'body' ? currentBodyIdx : 0);
      const res = await fetch(`/api/sessions/${sessionId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase,
          // body 페이즈는 전체 commit 모드 (paragraphIdx 안 보냄)
          paragraphIdx: phase === 'body' ? null : 0,
          bodyParagraphCount: phase === 'body' ? bodyParagraphs.length : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '확정 실패');

      if (data.nextPhase === 'done') {
        showToast('다 썼다! 친구가 마지막 평가 하는 중...', { emoji: '🎉' });
        // 세션 종료 — 이 세션의 모든 임시본 즉시 삭제
        clearAllLocalDrafts(sessionId);
        const closureRes = await fetch(`/api/sessions/${sessionId}/closure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey }),
        });
        if (!closureRes.ok) {
          const errData = await closureRes.json();
          throw new Error(errData.error ?? errData.detail ?? 'closure 생성 실패');
        }
        router.push(`/result/${sessionId}`);
      } else {
        const label =
          phase === 'body'
            ? `본론 모두 확정 완료!`
            : `${PHASE_LABEL[phase]} 완료!`;
        showToast(label, { emoji: '⭐' });
        setHasFeedbackForCurrent(false);
        lastSavedRef.current = null;
        await fetchState();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  // ─── 회귀 (uncommit) ───
  async function performRegress(targetPhase: Exclude<Phase, 'done'>, targetIdx: number) {
    setError(null);
    setPendingAction('regress');
    try {
      const res = await fetch(`/api/sessions/${sessionId}/uncommit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: targetPhase, paragraphIdx: targetIdx }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '회귀 실패');
      const label =
        targetPhase === 'body'
          ? `본론 ${targetIdx + 1}문단으로 돌아왔어`
          : `${PHASE_LABEL[targetPhase]}로 돌아왔어`;
      showToast(label, { emoji: '↩️' });
      lastSavedRef.current = null;
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  // ─── 페이즈 인디케이터 클릭 — 회귀 또는 보기만 ───
  function handlePhaseTabClick(targetPhase: Exclude<Phase, 'done'>) {
    if (targetPhase === phase) return;
    const targetIdx = PHASE_ORDER.indexOf(targetPhase);
    const currentIdx = PHASE_ORDER.indexOf(phase);
    if (targetIdx >= currentIdx) return; // 미진입 페이즈

    // 본론은 첫 commit된 문단(0)으로 회귀
    setConfirmKind({ kind: 'regress', phase: targetPhase, paragraphIdx: 0 });
  }

  // ─── 렌더 ───
  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center bg-amber-50">
        <div className="text-center">
          <div className="wiggle inline-block">
            <FriendFace mood="calm" size={80} />
          </div>
          <p className="text-stone-500 text-sm mt-3">불러오는 중...</p>
        </div>
      </main>
    );
  }
  if (error || !state) {
    return (
      <main className="flex-1 flex items-center justify-center bg-amber-50">
        <div className="text-sm text-rose-600">{error ?? '세션을 못 찾았어.'}</div>
      </main>
    );
  }

  const session = state.session;
  const turns = state.turns;
  // 본론은 모든 paragraph 대화를 다 보여줌 (어느 문단 피드백인지 라벨로 구분)
  const matchingTurns = turns.filter((t) => t.phase === phase);

  // ─── "같이 고민" 카드 카운터 ───
  // body: 문단별 / 그 외(intro/conclusion/title): phase 단위
  const helpRemainingByBodyIdx: Record<number, number> = {};
  if (phase === 'body') {
    bodyParagraphs.forEach((p) => {
      const used = turns.filter(
        (t) =>
          t.phase === 'body' &&
          t.paragraph_idx === p.idx &&
          t.role === 'student' &&
          t.triggered_by === 'help'
      ).length;
      helpRemainingByBodyIdx[p.idx] = Math.max(0, HELP_PER_CONTEXT - used);
    });
  }
  // 전역 (intro/conclusion/title) 카운터
  const helpRemainingGlobal = (() => {
    if (phase === 'body') return null;
    const used = turns.filter(
      (t) => t.phase === phase && t.role === 'student' && t.triggered_by === 'help'
    ).length;
    return Math.max(0, HELP_PER_CONTEXT - used);
  })();

  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const overallProgress = phase === 'body'
    ? (1 + (currentBodyIdx + 0.5) / Math.max(1, bodyParagraphs.length)) / PHASE_ORDER.length * 100
    : ((phaseIdx + 0.5) / PHASE_ORDER.length) * 100;

  const lastCalib = state.calibrations[state.calibrations.length - 1];
  const currentMood: Tone = (lastCalib?.next_tone as Tone) ?? 'less-annoying';

  // 누적 가중 평균 게이지 — phase별 (paragraph_idx별) 최신 점수만 추려 가중 합산
  const accumulatedGaugeScore = (() => {
    const phases: Exclude<Phase, 'done'>[] = ['intro', 'body', 'conclusion', 'title'];
    const inputs = phases.map((ph) => {
      // 같은 phase + paragraph_idx 묶음에서 최신 calibration의 score만 사용
      const byPara = new Map<number, { ts: string; score: number }>();
      for (const c of state.calibrations) {
        if (c.phase !== ph) continue;
        const sc = scoreFromSignalsJson(c.signals_json);
        if (sc === null) continue;
        const idx = c.paragraph_idx ?? 0;
        const prev = byPara.get(idx);
        if (!prev || c.timestamp > prev.ts) {
          byPara.set(idx, { ts: c.timestamp, score: sc });
        }
      }
      const paragraphScores = Array.from(byPara.values()).map((v) => v.score);
      const result: {
        phase: Exclude<Phase, 'done'>;
        paragraphScores: number[];
        bodyCommittedCount?: number;
      } = { phase: ph, paragraphScores };
      if (ph === 'body') {
        // 학생이 채운 본론 paragraph 수 (committed + 작성 중인 비어있지 않은 문단)
        const filled = bodyParagraphs.filter((p) => p.content.trim().length > 0).length;
        result.bodyCommittedCount = filled;
      }
      return result;
    });
    return computeAccumulatedGauge(inputs);
  })();

  // readyForNext — 가장 최근 calibration이 같은 phase·paragraph에서 충분 점수 도달했는지
  // 클라이언트는 calibrations 테이블에 readyForNext가 따로 저장되지 않으므로
  // signals_json의 composite를 재계산하지 않고, lastCalib이 같은 (phase, paragraph_idx)인지 확인 + signals 평균
  const readyForNextSignal = (() => {
    if (!lastCalib) return false;
    if (lastCalib.phase !== phase) return false;
    if (phase === 'body') {
      // body 단일 모드면 같은 paragraph_idx 매칭
      if (lastCalib.paragraph_idx !== currentBodyIdx) return false;
    }
    try {
      const sig = JSON.parse(lastCalib.signals_json) as Record<string, unknown>;
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
      if (scores.length === 0) return false;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return avg >= 0.75;
    } catch {
      return false;
    }
  })();

  // PrecedingContext용 commit된 글
  const drafts = state.drafts;
  const commits = state.phase_commits ?? [];
  const introCommit = drafts.find(
    (d) =>
      d.phase === 'intro' &&
      commits.some((c) => c.phase === 'intro' && c.committed_draft_id === d.id)
  );
  const conclusionCommitDraft = drafts.find(
    (d) =>
      d.phase === 'conclusion' &&
      commits.some((c) => c.phase === 'conclusion' && c.committed_draft_id === d.id)
  );
  const conclusionCommitContent = conclusionCommitDraft?.content;
  const bodyCommitsByIdx = bodyParagraphs
    .filter((p) => p.committed)
    .map((p) => p.content);

  return (
    <main className="flex-1 flex flex-col bg-amber-50">
      {/* 헤더 */}
      <header className="bg-white border-b-2 border-amber-100 px-4 py-3 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="rounded-full w-10 h-10 flex items-center justify-center bg-amber-100 hover:bg-amber-200 text-stone-700 text-lg font-bold"
              title="로비로"
            >
              ←
            </button>
            <div className="min-w-0">
              <div className="text-base font-bold text-stone-800 truncate font-display">
                {session.persona_name} ({session.grade}학년)
              </div>
              <div className="text-xs text-stone-500 truncate">{session.topic}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {PHASE_ORDER.map((p, i) => {
              const isCurrent = p === phase;
              const isPast = i < phaseIdx;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePhaseTabClick(p)}
                  disabled={!isPast}
                  className={`px-3 py-1.5 rounded-full font-bold transition ${
                    isCurrent
                      ? 'bg-amber-500 text-white shadow-md scale-110'
                      : isPast
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer'
                        : 'bg-stone-100 text-stone-400 cursor-not-allowed'
                  }`}
                  title={isPast ? '이 페이즈로 돌아가기' : undefined}
                >
                  {isPast ? '✓' : i + 1}. {PHASE_LABEL[p]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-2 h-2 bg-stone-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </header>

      {/* 본문 */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* 좌측 — 글쓰기 영역 */}
        <section className="bg-white rounded-3xl border-2 border-amber-100 shadow-sm flex flex-col fade-in">
          <div className="px-6 py-4 border-b-2 border-amber-50">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl text-amber-700">
                ✏️ {PHASE_LABEL[phase]}{' '}
                {phase === 'body' && `(${bodyParagraphs.length}문단)`}{' '}
                쓰기
              </h2>
              <span className="text-xs text-stone-400 font-bold">
                {getCurrentText().length}자
              </span>
            </div>
            <p className="text-sm text-stone-600 mt-1 leading-relaxed">
              {PHASE_HINT[phase]}
            </p>
          </div>

          {/* PrecedingContext: 본론(서론 commit 표시), 결론, 제목 페이즈 */}
          {phase === 'body' || phase === 'conclusion' || phase === 'title' ? (
            <div className="px-5 pt-4">
              <PrecedingContext
                intro={introCommit?.content}
                bodyParagraphs={bodyCommitsByIdx}
                conclusion={conclusionCommitContent}
                currentPhase={phase as 'body' | 'conclusion' | 'title'}
              />
            </div>
          ) : null}

          {/* 텍스트 입력 영역 */}
          <div className="flex-1 px-1 sm:px-3 py-3 overflow-y-auto">
            {phase === 'intro' && (
              <textarea
                value={introText}
                onChange={handleIntroChange}
                placeholder="서론을 자유롭게 써 봐. 다 쓰면 우측의 '친구한테 보여주기'를 눌러봐!"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                disabled={pendingAction !== null}
                className="draft-input w-full min-h-[400px] resize-none px-5 py-4 text-stone-800 focus:outline-none placeholder:text-stone-300 rounded-2xl border-2 border-amber-200 bg-amber-50/30"
              />
            )}
            {phase === 'body' && (
              <BodyParagraphList
                paragraphs={bodyParagraphs}
                onChange={handleBodyChange}
                onAdd={handleBodyAdd}
                onRemove={handleBodyRemove}
                onHelp={handleParagraphHelp}
                onShow={handleParagraphShow}
                disabled={pendingAction !== null}
                busyIdx={
                  pendingAction === 'submit' || pendingAction === 'help'
                    ? helpForBodyIdx
                    : null
                }
                helpRemainingByIdx={helpRemainingByBodyIdx}
              />
            )}
            {phase === 'conclusion' && (
              <textarea
                value={conclusionText}
                onChange={handleConclusionChange}
                placeholder="결론을 자유롭게 써 봐. 본론의 근거를 짧게 정리하고 핵심 명제를 강조해!"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                disabled={pendingAction !== null}
                className="draft-input w-full min-h-[300px] resize-none px-5 py-4 text-stone-800 focus:outline-none placeholder:text-stone-300 rounded-2xl border-2 border-amber-200 bg-amber-50/30"
              />
            )}
            {phase === 'title' && (
              <div className="px-3 py-6">
                <label className="block">
                  <span className="font-display text-2xl text-amber-700 mb-2 inline-block">
                    📚 글의 제목
                  </span>
                  <input
                    type="text"
                    value={titleText}
                    onChange={handleTitleChange}
                    placeholder="예: 책은 매일 우리를 키우는 작은 친구"
                    maxLength={50}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    disabled={pendingAction !== null}
                    className="mt-2 w-full text-xl font-display rounded-2xl border-2 border-amber-300 px-5 py-4 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100 bg-amber-50/30 placeholder:text-stone-300"
                  />
                </label>
                <p className="text-xs text-stone-500 mt-3 leading-relaxed">
                  💡 좋은 제목은: ① 글 전체 주장이 보이거나 호기심이 생긴다, ② 너무
                  길지 않다(10–25자), ③ 단순 주제 나열이 아니다.
                </p>
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t-2 border-amber-50 flex flex-wrap gap-2 justify-end">
            {/* 본론 phase는 문단별 [🤝][🎯] 버튼 사용. 전역은 숨김. */}
            {phase !== 'body' && helpRemainingGlobal !== null && (
              <>
                <button
                  onClick={() => {
                    setHelpForBodyIdx(null);
                    setHelpModalOpen(true);
                  }}
                  disabled={pendingAction !== null || helpRemainingGlobal <= 0}
                  className="px-5 py-3 rounded-2xl text-base font-bold border-2 border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-2"
                  title={
                    helpRemainingGlobal <= 0
                      ? '도움 카드를 다 썼어. 친구 설득하기로 평가 받아봐!'
                      : `같이 고민 (${helpRemainingGlobal}장 남음)`
                  }
                >
                  🤝 같이 고민해줘
                  <span className="text-xs font-mono opacity-80">
                    {'🃏'.repeat(helpRemainingGlobal) +
                      '·'.repeat(Math.max(0, HELP_PER_CONTEXT - helpRemainingGlobal))}
                  </span>
                </button>
                <button
                  onClick={() => setConfirmKind({ kind: 'submit' })}
                  disabled={pendingAction !== null}
                  className="px-5 py-3 rounded-2xl text-base font-bold bg-amber-400 hover:bg-amber-500 text-white shadow-md hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100"
                >
                  🎯 친구 설득하기
                </button>
              </>
            )}
            <button
              onClick={() =>
                setConfirmKind({
                  kind: phase === 'title' ? 'finalize' : 'commit',
                })
              }
              disabled={pendingAction !== null}
              className={`px-5 py-3 rounded-2xl text-base font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-md hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100 ${
                readyForNextSignal ? 'ready-pulse' : ''
              }`}
            >
              {phase === 'title'
                ? '✅ 글 마무리'
                : phase === 'body'
                  ? '➡️ 본론 마무리 → 결론으로'
                  : '➡️ 다음으로'}
            </button>
          </div>
        </section>

        {/* 우측 — 친구 반응 사이드바 */}
        <aside className="bg-white rounded-3xl border-2 border-amber-100 shadow-sm flex flex-col max-h-[calc(100vh-180px)] fade-in">
          <div className="px-5 py-4 border-b-2 border-amber-50 bg-gradient-to-br from-amber-50 to-rose-50 rounded-t-3xl">
            <div className="flex items-center gap-3 mb-3">
              <div
                className={
                  pendingAction && pendingAction !== 'commit' && pendingAction !== 'regress'
                    ? 'wiggle'
                    : 'friend-idle'
                }
              >
                <FriendFace tone={currentMood} size={96} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display text-lg text-stone-800">
                  잘난척 까칠한 친구
                </div>
                <div className="text-sm text-stone-600 mt-0.5">
                  지금 친구 기분:{' '}
                  <span className="font-bold">
                    {currentMood === 'annoying' ? '😤 약올라!' : '😏 잘난 척'}
                  </span>
                </div>
              </div>
            </div>
            <WinGauge studentScore={accumulatedGaugeScore} />
            {readyForNextSignal && (
              <div className="mt-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 font-bold pop-in flex items-center gap-2">
                <span className="text-base">👉</span>
                <span>친구가 인정했어! 이제 다음으로 가도 좋아!</span>
              </div>
            )}
          </div>

          {/* 대화 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {matchingTurns.length === 0 && (
              <div className="text-sm text-stone-400 text-center py-10 leading-relaxed">
                아직 대화가 없어 😅<br />
                글을 좀 쓰고 친구한테 보여주거나,<br />
                도움 받기 눌러봐!
              </div>
            )}
            {matchingTurns.map((t) => (
              <ChatBubble key={t.id} turn={t} />
            ))}
            {pendingAction && pendingAction !== 'commit' && pendingAction !== 'regress' && (
              <div className="flex items-center gap-2 text-stone-500 text-sm fade-in">
                <FriendFaceMini tone={currentMood} size={28} />
                <span className="italic">친구가 생각하는 중 ...</span>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
        </aside>
      </div>

      {/* HelpDomainModal */}
      <HelpDomainModal
        open={helpModalOpen}
        onSelect={handleHelpDomain}
        onCancel={() => setHelpModalOpen(false)}
      />

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={confirmKind?.kind === 'submit'}
        title={
          confirmKind?.kind === 'submit' && typeof confirmKind.paragraphIdx === 'number'
            ? `본론 ${confirmKind.paragraphIdx + 1}문단으로 친구 설득해볼까?`
            : '이 글로 친구 설득해볼까?'
        }
        emoji="🎯"
        message={`까칠한 친구를 너의 글로 설득해 봐.\n친구가 인정할지 약 올라할지 한번 보자!`}
        confirmText="응, 설득해볼게"
        cancelText="아직"
        variant="primary"
        onConfirm={() => {
          const idx =
            confirmKind?.kind === 'submit' ? confirmKind.paragraphIdx : undefined;
          setConfirmKind(null);
          performSubmit(idx);
        }}
        onCancel={() => setConfirmKind(null)}
      />
      <ConfirmDialog
        open={confirmKind?.kind === 'commit'}
        title={
          phase === 'body'
            ? '본론 다 썼어? 결론으로 갈까?'
            : phase === 'conclusion'
              ? '결론 확정하고 제목 정하러 갈까?'
              : '다음으로 넘어갈까?'
        }
        emoji="➡️"
        message={
          phase === 'body'
            ? `본론 ${bodyParagraphs.length}문단을 모두 확정하면 결론으로 넘어가.\n나중에 다시 돌아올 수는 있어!`
            : phase === 'conclusion'
              ? '결론까지 다 썼네! 이제 글의 제목을 정할 차례야.\n나중에 다시 돌아올 수 있어.'
              : `이 ${PHASE_LABEL[phase]}은 이 정도면 됐다고 생각하는 거지?\n다음 단계로 넘어가도 나중에 돌아올 수 있어.`
        }
        confirmText="응, 다음으로!"
        cancelText="조금 더 다듬을게"
        variant="go"
        onConfirm={() => {
          setConfirmKind(null);
          performCommit();
        }}
        onCancel={() => setConfirmKind(null)}
      />
      <ConfirmDialog
        open={confirmKind?.kind === 'finalize'}
        title="글 마무리할까?"
        emoji="🎉"
        message="제목까지 정했으면, 친구가 너의 글 전체를 보고\n얼마나 설득됐는지 솔직하게 말해줄 거야."
        confirmText="✨ 마무리!"
        cancelText="조금 더 다듬을게"
        variant="go"
        onConfirm={() => {
          setConfirmKind(null);
          performCommit();
        }}
        onCancel={() => setConfirmKind(null)}
      />
      <ConfirmDialog
        open={confirmKind?.kind === 'regress'}
        title={
          confirmKind?.kind === 'regress'
            ? `${PHASE_LABEL[confirmKind.phase]}으로 돌아갈까?`
            : ''
        }
        emoji="↩️"
        message={`${
          confirmKind?.kind === 'regress' ? PHASE_LABEL[confirmKind.phase] : ''
        }을 다시 쓸 수 있어.\n지금까지 쓴 글은 그대로 보존돼.`}
        confirmText="응, 돌아갈게"
        cancelText="아니, 그대로"
        variant="primary"
        onConfirm={() => {
          if (confirmKind?.kind === 'regress') {
            const tp = confirmKind.phase;
            const ti = confirmKind.paragraphIdx;
            setConfirmKind(null);
            performRegress(tp, ti);
          }
        }}
        onCancel={() => setConfirmKind(null)}
      />

      {error && (
        <div className="fixed bottom-4 right-4 max-w-md rounded-2xl bg-rose-50 border-2 border-rose-200 px-4 py-3 text-sm text-rose-700 shadow-lg pop-in z-50">
          <div className="font-bold mb-1">⚠️ 오류</div>
          <div>{error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="absolute top-1 right-2 text-rose-400 hover:text-rose-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* 좌하단 플로팅 사전 — 모든 페이즈에서 사용 가능 */}
      <DictionaryFloater />

      {/* 1회성 안내 모달 (첫 글쓰기 진입 시) */}
      {tutorialOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 fade-in">
          <button
            type="button"
            onClick={dismissTutorial}
            aria-label="닫기"
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
          />
          <div className="relative bg-white rounded-3xl shadow-2xl border-4 border-amber-100 max-w-md w-full p-6 pop-in">
            <div className="flex justify-center mb-3">
              <FriendFace mood="calm" size={88} />
            </div>
            <h2 className="font-display text-2xl text-center text-stone-800 mb-2">
              👋 친구는 두 가지 일을 해!
            </h2>
            <p className="text-center text-stone-500 text-sm mb-5">
              필요할 때 골라서 써 봐.
            </p>

            <div className="space-y-3 mb-5">
              <div className="rounded-2xl border-2 border-sky-200 bg-sky-50/60 px-4 py-3">
                <div className="font-bold text-sky-800 text-base mb-1">
                  🤝 같이 고민해줘
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  글이 막혔을 때, 같은 팀처럼 옆에서 같이 생각해줘. <br />
                  <span className="font-bold text-sky-700">
                    한 곳에서 🃏🃏 두 번 쓸 수 있어.
                  </span>
                </p>
              </div>
              <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 px-4 py-3">
                <div className="font-bold text-amber-800 text-base mb-1">
                  🎯 친구 설득하기
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  네 글로 까칠한 친구를 설득해 봐. 평가 받고 싶을 때 써.
                  <br />
                  <span className="font-bold text-amber-700">
                    이건 횟수 제한 없어! 마음껏 도전해 봐.
                  </span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={dismissTutorial}
              className="w-full py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-base shadow-md hover:scale-[1.02] transition"
            >
              ✨ 알았어, 시작할게!
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── 부속 ───
function ChatBubble({ turn }: { turn: TurnRow }) {
  const isStudent = turn.role === 'student';
  // 본론에서 어느 문단인지 라벨 (intro/conclusion/title 등은 표시 안 함)
  const paraTag =
    turn.phase === 'body' && typeof turn.paragraph_idx === 'number'
      ? `본론 ${turn.paragraph_idx + 1}문단`
      : null;

  if (isStudent) {
    return (
      <div className="flex justify-end slide-in-right">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 bg-emerald-100 border-2 border-emerald-200 text-stone-800 text-sm whitespace-pre-wrap leading-relaxed">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {paraTag && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-200 text-emerald-900 font-bold">
                {paraTag}
              </span>
            )}
            {turn.triggered_by === 'submit' && (
              <span className="text-xs text-emerald-700 font-bold">🎯 친구 설득</span>
            )}
            {turn.triggered_by === 'help' && (
              <span className="text-xs text-sky-700 font-bold">
                🤝 같이 고민
                {turn.help_domain ? ` (${helpDomainLabel(turn.help_domain)})` : ''}
              </span>
            )}
          </div>
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 fade-in">
      <FriendFaceMini tone={turn.tone} size={32} className="flex-shrink-0 mt-1" />
      <div
        className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 bg-amber-50 border-2 border-amber-200 text-stone-800 text-sm whitespace-pre-wrap leading-relaxed"
        title={
          turn.tone || turn.domain
            ? `${turn.tone ?? ''}${turn.tone && turn.domain ? ' / ' : ''}${turn.domain ?? ''}`
            : undefined
        }
      >
        {paraTag && (
          <div className="text-[10px] px-1.5 py-0.5 inline-block rounded-full bg-amber-200 text-amber-900 font-bold mb-1">
            {paraTag}
          </div>
        )}
        {turn.content}
      </div>
    </div>
  );
}

function helpDomainLabel(d: string): string {
  if (d === 'idea') return '아이디어';
  if (d === 'writing') return '글쓰기';
  if (d === 'both') return '전부';
  return d;
}
