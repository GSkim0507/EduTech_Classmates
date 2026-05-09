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
import { showToast } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import HelpDomainModal from '@/components/HelpDomainModal';
import BodyParagraphList, {
  type BodyParagraph,
} from '@/components/BodyParagraphList';
import WinGauge from '@/components/WinGauge';
import PrecedingContext from '@/components/PrecedingContext';

const API_KEY_STORAGE = 'annoying-classmate:api-key';

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
  | { kind: 'submit' }
  | { kind: 'commit' }
  | { kind: 'finalize' }
  | { kind: 'regress'; phase: Exclude<Phase, 'done'>; paragraphIdx: number }
  | null;

const MIN_PARA = 3;
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
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);

  const lastSavedRef = useRef<{ phase: Phase; paragraphIdx: number; content: string } | null>(
    null
  );
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
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

      // 서론 복원
      const introDrafts = drafts.filter((d) => d.phase === 'intro');
      setIntroText(introDrafts[introDrafts.length - 1]?.content ?? '');

      // 결론 복원
      const conclDrafts = drafts.filter((d) => d.phase === 'conclusion');
      setConclusionText(conclDrafts[conclDrafts.length - 1]?.content ?? '');

      // 제목 복원
      const titleDrafts = drafts.filter((d) => d.phase === 'title');
      setTitleText(titleDrafts[titleDrafts.length - 1]?.content ?? '');

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
      const paragraphCount = Math.max(MIN_PARA, maxIdx + 1);

      const paras: BodyParagraph[] = [];
      for (let i = 0; i < paragraphCount; i++) {
        const list = bodyDraftsByIdx[i] ?? [];
        const last = list[list.length - 1];
        paras.push({
          idx: i,
          content: last?.content ?? '',
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

  // ─── 자동 저장 ───
  function scheduleAutosave(text: string) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const last = lastSavedRef.current;
      if (
        last &&
        last.phase === phase &&
        last.paragraphIdx === currentParagraphIdx &&
        last.content === text
      ) {
        return;
      }
      const source = hasFeedbackForCurrent ? 'student_revise' : 'student_write';
      try {
        const res = await fetch(`/api/sessions/${sessionId}/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phase,
            paragraphIdx: currentParagraphIdx,
            content: text,
            source,
          }),
        });
        const data = await res.json();
        if (res.ok && !data.deduped) {
          showToast('저장됐어!', { emoji: '💾' });
        }
        lastSavedRef.current = {
          phase,
          paragraphIdx: currentParagraphIdx,
          content: text,
        };
      } catch (err) {
        console.warn('autosave failed', err);
      }
    }, 1100);
  }

  async function flushAutosave(forceSource?: 'student_write' | 'student_revise') {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const text = getCurrentText();
    if (lastSavedRef.current?.content === text) return;
    const source =
      forceSource ?? (hasFeedbackForCurrent ? 'student_revise' : 'student_write');
    await fetch(`/api/sessions/${sessionId}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase,
        paragraphIdx: currentParagraphIdx,
        content: text,
        source,
      }),
    });
    lastSavedRef.current = { phase, paragraphIdx: currentParagraphIdx, content: text };
  }

  // ─── 텍스트 변경 핸들러 ───
  function handleIntroChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setIntroText(v);
    scheduleAutosave(v);
  }
  function handleConclusionChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setConclusionText(v);
    scheduleAutosave(v);
  }
  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setTitleText(v);
    scheduleAutosave(v);
  }
  function handleBodyChange(idx: number, content: string) {
    setBodyParagraphs((prev) => prev.map((p) => (p.idx === idx ? { ...p, content } : p)));
    if (idx === currentBodyIdx) scheduleAutosave(content);
  }
  function handleBodySelect(idx: number) {
    if (idx === currentBodyIdx) return;
    setCurrentBodyIdx(idx);
    setHasFeedbackForCurrent(false);
    lastSavedRef.current = null;
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
    if (!apiKey.trim()) {
      setError('Claude API 키가 필요해. 로비에서 다시 들어와줘.');
      return;
    }
    const text = getCurrentText();
    if (!text.trim()) {
      setError('일단 글을 조금 써 봐.');
      return;
    }
    await flushAutosave();
    setPendingAction('help');
    try {
      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          trigger: 'help',
          paragraphIdx: phase === 'body' ? currentParagraphIdx : null,
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
  async function performSubmit() {
    setError(null);
    if (!apiKey.trim()) {
      setError('Claude API 키가 필요해.');
      return;
    }
    const text = getCurrentText();
    if (!text.trim()) {
      setError('일단 글을 조금 써 봐.');
      return;
    }
    await flushAutosave();
    setPendingAction('submit');
    try {
      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          trigger: 'submit',
          paragraphIdx: phase === 'body' ? currentParagraphIdx : null,
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
      await flushAutosave('student_revise');
      const res = await fetch(`/api/sessions/${sessionId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase,
          paragraphIdx: currentParagraphIdx,
          bodyParagraphCount: phase === 'body' ? bodyParagraphs.length : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '확정 실패');

      if (data.nextPhase === 'done') {
        showToast('다 썼다! 친구가 마지막 평가 하는 중...', { emoji: '🎉' });
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
            ? `본론 ${currentParagraphIdx + 1}문단 완료!`
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
  const matchingTurns = turns.filter((t) => {
    if (t.phase !== phase) return false;
    if (phase !== 'body') return true;
    return t.paragraph_idx === currentParagraphIdx;
  });

  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const overallProgress = phase === 'body'
    ? (1 + (currentBodyIdx + 0.5) / Math.max(1, bodyParagraphs.length)) / PHASE_ORDER.length * 100
    : ((phaseIdx + 0.5) / PHASE_ORDER.length) * 100;

  const lastCalib = state.calibrations[state.calibrations.length - 1];
  const currentMood: Tone = (lastCalib?.next_tone as Tone) ?? 'less-annoying';

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
                {phase === 'body' && `(${currentBodyIdx + 1}/${bodyParagraphs.length}문단)`}{' '}
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

          {/* PrecedingContext (본론 i>0 또는 결론 또는 제목) */}
          {(phase === 'body' && currentBodyIdx > 0) ||
          phase === 'conclusion' ||
          phase === 'title' ? (
            <div className="px-5 pt-4">
              <PrecedingContext
                intro={introCommit?.content}
                bodyParagraphs={bodyCommitsByIdx}
                conclusion={conclusionCommitContent}
                currentPhase={phase as 'body' | 'conclusion' | 'title'}
                currentParagraphIdx={phase === 'body' ? currentBodyIdx : undefined}
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
                currentParagraphIdx={currentBodyIdx}
                onChange={handleBodyChange}
                onAdd={handleBodyAdd}
                onRemove={handleBodyRemove}
                onSelect={handleBodySelect}
                disabled={pendingAction !== null}
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
            <button
              onClick={() => setHelpModalOpen(true)}
              disabled={pendingAction !== null}
              className="px-5 py-3 rounded-2xl text-base font-bold border-2 border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100"
            >
              💭 도움 받기
            </button>
            <button
              onClick={() => setConfirmKind({ kind: 'submit' })}
              disabled={pendingAction !== null}
              className="px-5 py-3 rounded-2xl text-base font-bold bg-amber-400 hover:bg-amber-500 text-white shadow-md hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100"
            >
              👀 친구한테 보여주기
            </button>
            <button
              onClick={() =>
                setConfirmKind({
                  kind: phase === 'title' ? 'finalize' : 'commit',
                })
              }
              disabled={pendingAction !== null}
              className="px-5 py-3 rounded-2xl text-base font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-md hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100"
            >
              {phase === 'title' ? '✅ 글 마무리' : '➡️ 다음으로'}
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
            <WinGauge
              studentScore={
                lastCalib
                  ? Math.round(
                      ((Object.values(JSON.parse(lastCalib.signals_json) as Record<string, unknown>)
                        .filter((v): v is number => typeof v === 'number')
                        .reduce((s, v) => s + v, 0) || 0) /
                        Math.max(
                          1,
                          Object.values(JSON.parse(lastCalib.signals_json) as Record<string, unknown>)
                            .filter((v): v is number => typeof v === 'number').length
                        )) *
                        100
                    )
                  : null
              }
            />
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
        title="친구한테 보여줄까?"
        emoji="👀"
        message={`네 글을 까칠한 친구가 한 번 봐줄게.\n친구가 약올라할지 잘난 척할지 모르지만 괜찮지?`}
        confirmText="응, 보여줄게"
        cancelText="아직"
        variant="primary"
        onConfirm={() => {
          setConfirmKind(null);
          performSubmit();
        }}
        onCancel={() => setConfirmKind(null)}
      />
      <ConfirmDialog
        open={confirmKind?.kind === 'commit'}
        title={
          phase === 'body'
            ? `본론 ${currentParagraphIdx + 1}문단 확정?`
            : phase === 'conclusion'
              ? '결론 확정하고 제목 정하러 갈까?'
              : '다음으로 넘어갈까?'
        }
        emoji="➡️"
        message={
          phase === 'body'
            ? `본론 ${currentParagraphIdx + 1}문단을 확정하면\n${
                currentParagraphIdx === bodyParagraphs.length - 1
                  ? '결론으로 넘어가.'
                  : `본론 ${currentParagraphIdx + 2}문단으로 넘어가.`
              }\n나중에 다시 돌아올 수는 있어!`
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
        <div className="fixed bottom-4 right-4 max-w-md rounded-2xl bg-rose-50 border-2 border-rose-200 px-4 py-3 text-sm text-rose-700 shadow-lg pop-in">
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
    </main>
  );
}

// ─── 부속 ───
function ChatBubble({ turn }: { turn: TurnRow }) {
  const isStudent = turn.role === 'student';
  if (isStudent) {
    return (
      <div className="flex justify-end slide-in-right">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 bg-emerald-100 border-2 border-emerald-200 text-stone-800 text-sm whitespace-pre-wrap leading-relaxed">
          {turn.triggered_by === 'submit' && (
            <div className="text-xs text-emerald-700 font-bold mb-1">👀 보여주기</div>
          )}
          {turn.triggered_by === 'help' && (
            <div className="text-xs text-emerald-700 font-bold mb-1">
              💭 도움 요청{turn.help_domain ? ` (${helpDomainLabel(turn.help_domain)})` : ''}
            </div>
          )}
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
