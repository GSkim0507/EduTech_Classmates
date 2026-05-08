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
} from '@/lib/types';
import FriendFace, { FriendFaceMini } from '@/components/FriendFace';
import { showToast } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

const API_KEY_STORAGE = 'annoying-classmate:api-key';

const PHASE_LABEL: Record<Exclude<Phase, 'done'>, string> = {
  intro: '서론',
  body: '본론',
  conclusion: '결론',
};
const PHASE_ORDER: Exclude<Phase, 'done'>[] = ['intro', 'body', 'conclusion'];

const PHASE_HINT: Record<Exclude<Phase, 'done'>, string> = {
  intro:
    '서론에서는 사회적 맥락을 짧게 보여주고, 글 전체의 핵심 명제(주장)를 한 문장으로 분명하게 밝혀줘.',
  body:
    '본론은 두세 문단으로 만들고, 각 문단마다 소주제문과 그걸 뒷받침할 근거를 같이 적어줘.',
  conclusion:
    '결론은 본론의 근거를 짧게 정리하고, 핵심 명제를 강조하는 한 문장으로 마무리해. 새로운 근거는 추가하지 말고.',
};

interface SessionState {
  session: SessionRow;
  drafts: DraftRow[];
  turns: TurnRow[];
  calibrations: CalibrationRow[];
  closure: unknown;
}

type ConfirmKind = 'submit' | 'commit' | 'finalize' | null;

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
  const [draftText, setDraftText] = useState('');
  const [hasFeedbackForCurrentDraft, setHasFeedbackForCurrentDraft] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    'submit' | 'help' | 'chat' | 'commit' | null
  >(null);
  const [chatMessage, setChatMessage] = useState('');
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const lastSavedRef = useRef<{ phase: Phase; content: string } | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const cachedKey = sessionStorage.getItem(API_KEY_STORAGE);
    if (cachedKey) setApiKey(cachedKey);
  }, []);

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
      const phaseDrafts = (data.drafts as DraftRow[]).filter(
        (d) => d.phase === phase
      );
      const last = phaseDrafts[phaseDrafts.length - 1];
      setDraftText(last?.content ?? '');
      lastSavedRef.current = { phase, content: last?.content ?? '' };
      const turns = data.turns as TurnRow[];
      const lastAssistantTurn = [...turns]
        .reverse()
        .find((t) => t.phase === phase && t.role === 'assistant');
      setHasFeedbackForCurrentDraft(Boolean(lastAssistantTurn));
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
  const phase = session.current_phase as Exclude<Phase, 'done'>;
  const turns = state.turns;
  const phaseTurns = turns.filter((t) => t.phase === phase);

  // ─── 자동 저장 ───
  function scheduleAutosave(text: string) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const last = lastSavedRef.current;
      if (last && last.phase === phase && last.content === text) return;
      const source = hasFeedbackForCurrentDraft ? 'student_revise' : 'student_write';
      try {
        await fetch(`/api/sessions/${sessionId}/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase, content: text, source }),
        });
        lastSavedRef.current = { phase, content: text };
        showToast('저장됐어!', { emoji: '💾' });
      } catch (err) {
        console.warn('autosave failed', err);
      }
    }, 1100);
  }

  function handleDraftChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setDraftText(val);
    scheduleAutosave(val);
  }

  async function flushAutosave(forceSource?: 'student_write' | 'student_revise') {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (lastSavedRef.current?.content === draftText) return;
    const source =
      forceSource ?? (hasFeedbackForCurrentDraft ? 'student_revise' : 'student_write');
    await fetch(`/api/sessions/${sessionId}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, content: draftText, source }),
    });
    lastSavedRef.current = { phase, content: draftText };
  }

  async function performTurn(trigger: 'help' | 'submit') {
    setError(null);
    if (!apiKey.trim()) {
      setError('Claude API 키가 필요해. 로비에서 다시 들어와줘.');
      return;
    }
    if (!draftText.trim()) {
      setError('일단 글을 조금이라도 써 봐.');
      return;
    }
    await flushAutosave();
    setPendingAction(trigger);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, trigger }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? data.detail ?? 'AI 응답 실패');
      await fetchState();
      setHasFeedbackForCurrentDraft(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!chatMessage.trim()) return;
    if (!apiKey.trim()) {
      setError('Claude API 키가 필요해.');
      return;
    }
    setPendingAction('chat');
    try {
      const res = await fetch(`/api/sessions/${sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          trigger: 'chat',
          studentMessage: chatMessage.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.detail ?? 'AI 응답 실패');
      setChatMessage('');
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function performCommit() {
    setError(null);
    if (!draftText.trim()) {
      setError('확정할 글이 비어있어.');
      return;
    }
    setPendingAction('commit');
    try {
      await flushAutosave('student_revise');
      const res = await fetch(`/api/sessions/${sessionId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '확정 실패');

      if (data.nextPhase === 'done') {
        showToast('다 썼다! 친구 마지막 평가 받는 중...', { emoji: '🎉' });
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
        showToast(`${PHASE_LABEL[phase]} 완료! 다음으로 가자`, { emoji: '⭐' });
        setHasFeedbackForCurrentDraft(false);
        await fetchState();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  }

  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const progress = ((phaseIdx + 0.5) / PHASE_ORDER.length) * 100;
  const lastCalib = state.calibrations[state.calibrations.length - 1];
  const currentMood: Tone = (lastCalib?.next_tone as Tone) ?? 'less-annoying';

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
            {PHASE_ORDER.map((p, i) => (
              <span
                key={p}
                className={`px-3 py-1.5 rounded-full font-bold ${
                  p === phase
                    ? 'bg-amber-500 text-white shadow-md scale-110'
                    : i < phaseIdx
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-stone-100 text-stone-400'
                }`}
              >
                {i < phaseIdx ? '✓' : i + 1}. {PHASE_LABEL[p]}
              </span>
            ))}
          </div>
        </div>
        <div className="max-w-7xl mx-auto mt-2 h-2 bg-stone-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      {/* 본문 */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* 글쓰기 영역 */}
        <section className="bg-white rounded-3xl border-2 border-amber-100 shadow-sm flex flex-col fade-in">
          <div className="px-6 py-4 border-b-2 border-amber-50">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl text-amber-700">
                ✏️ {PHASE_LABEL[phase]} 쓰기
              </h2>
              <span className="text-xs text-stone-400 font-bold">
                {draftText.length}자
              </span>
            </div>
            <p className="text-sm text-stone-600 mt-1 leading-relaxed">
              {PHASE_HINT[phase]}
            </p>
          </div>
          <textarea
            value={draftText}
            onChange={handleDraftChange}
            placeholder={`${PHASE_LABEL[phase]}을 자유롭게 써 봐. 다 쓰면 우측의 '친구한테 보여주기'를 눌러봐!`}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="draft-input flex-1 min-h-[400px] resize-none px-6 py-5 text-stone-800 focus:outline-none placeholder:text-stone-300"
          />
          <div className="px-6 py-4 border-t-2 border-amber-50 flex flex-wrap gap-2 justify-end">
            <button
              onClick={() => performTurn('help')}
              disabled={pendingAction !== null}
              className="px-5 py-3 rounded-2xl text-base font-bold border-2 border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100"
            >
              💭 도움 받기
            </button>
            <button
              onClick={() => setConfirmKind('submit')}
              disabled={pendingAction !== null}
              className="px-5 py-3 rounded-2xl text-base font-bold bg-amber-400 hover:bg-amber-500 text-white shadow-md hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100"
            >
              👀 친구한테 보여주기
            </button>
            <button
              onClick={() =>
                setConfirmKind(phase === 'conclusion' ? 'finalize' : 'commit')
              }
              disabled={pendingAction !== null}
              className="px-5 py-3 rounded-2xl text-base font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-md hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100"
            >
              {phase === 'conclusion' ? '✅ 글 마무리' : '➡️ 다음으로'}
            </button>
          </div>
        </section>

        {/* 채팅 사이드바 */}
        <aside className="bg-white rounded-3xl border-2 border-amber-100 shadow-sm flex flex-col max-h-[calc(100vh-180px)] fade-in">
          {/* 마스코트 + 기분 */}
          <div className="px-5 py-4 border-b-2 border-amber-50 bg-gradient-to-br from-amber-50 to-rose-50 rounded-t-3xl">
            <div className="flex items-center gap-3">
              <div
                className={
                  pendingAction && pendingAction !== 'commit'
                    ? 'wiggle'
                    : ''
                }
              >
                <FriendFace tone={currentMood} size={64} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display text-lg text-stone-800">
                  잘난척 까칠한 친구
                </div>
                <div className="text-sm text-stone-600 mt-0.5">
                  지금 친구 기분:{' '}
                  <span className="font-bold">
                    {currentMood === 'annoying' ? '😤 까칠해' : '😊 평온해'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 대화 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {phaseTurns.length === 0 && (
              <div className="text-sm text-stone-400 text-center py-10 leading-relaxed">
                아직 대화가 없어 😅<br />
                글을 좀 쓰고 친구한테 보여주거나,<br />
                채팅으로 직접 물어봐!
              </div>
            )}
            {phaseTurns.map((t) => (
              <ChatBubble key={t.id} turn={t} />
            ))}
            {pendingAction && pendingAction !== 'commit' && (
              <div className="flex items-center gap-2 text-stone-500 text-sm fade-in">
                <FriendFaceMini tone={currentMood} size={28} />
                <span className="italic">친구가 생각하는 중 ...</span>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* 채팅 입력 */}
          <form
            onSubmit={handleChat}
            className="border-t-2 border-amber-50 px-3 py-3 flex gap-2"
          >
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              placeholder="친구한테 직접 물어봐!"
              spellCheck={false}
              autoCorrect="off"
              disabled={pendingAction !== null}
              className="flex-1 rounded-full border-2 border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-amber-400 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={pendingAction !== null || !chatMessage.trim()}
              className="px-4 py-2.5 rounded-full text-sm font-bold bg-stone-700 text-white hover:bg-stone-800 disabled:opacity-30 hover:scale-105"
            >
              ➤
            </button>
          </form>
        </aside>
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmKind === 'submit'}
        title="친구한테 보여줄까?"
        emoji="👀"
        message="네 글을 까칠한 친구가 한 번 봐줄게.\n친구가 까칠하게 굴 수도 있는데 괜찮지?"
        confirmText="응, 보여줄게"
        cancelText="아직"
        variant="primary"
        onConfirm={() => {
          setConfirmKind(null);
          performTurn('submit');
        }}
        onCancel={() => setConfirmKind(null)}
      />
      <ConfirmDialog
        open={confirmKind === 'commit'}
        title="다음으로 넘어갈까?"
        emoji="➡️"
        message={`이 ${PHASE_LABEL[phase]}은 이 정도면 됐다고 생각하는 거지?\n다음 단계로 넘어가면 돌아오기 어려워!`}
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
        open={confirmKind === 'finalize'}
        title="글 마무리할까?"
        emoji="🎉"
        message="결론까지 다 썼으면, 친구가 너의 글 전체를 보고\n얼마나 설득됐는지 솔직하게 말해줄 거야."
        confirmText="✨ 마무리!"
        cancelText="조금 더 다듬을게"
        variant="go"
        onConfirm={() => {
          setConfirmKind(null);
          performCommit();
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

// ─── 부속 컴포넌트 ───
function ChatBubble({ turn }: { turn: TurnRow }) {
  const isStudent = turn.role === 'student';

  if (isStudent) {
    return (
      <div className="flex justify-end slide-in-right">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 bg-emerald-100 border-2 border-emerald-200 text-stone-800 text-sm whitespace-pre-wrap leading-relaxed">
          {turn.triggered_by === 'submit' && (
            <div className="text-xs text-emerald-700 font-bold mb-1">
              👀 보여주기
            </div>
          )}
          {turn.triggered_by === 'help' && (
            <div className="text-xs text-emerald-700 font-bold mb-1">
              💭 도움 요청
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
            ? `mode: ${turn.tone ?? ''} / ${turn.domain ?? ''}`
            : undefined
        }
      >
        {turn.content}
      </div>
    </div>
  );
}
