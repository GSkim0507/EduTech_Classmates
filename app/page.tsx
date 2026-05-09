'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import FriendFace from '@/components/FriendFace';
import { showToast } from '@/components/Toast';

const RECENT_SESSIONS_STORAGE = 'annoying-classmate:recent-sessions';

interface RecentSession {
  id: string;
  personaName: string;
  topic: string;
  startedAt: string;
}

export default function LobbyPage() {
  const router = useRouter();
  const [personaName, setPersonaName] = useState('');
  const [grade, setGrade] = useState<4 | 5 | 6>(5);
  const [topic, setTopic] = useState('');
  const [resumeId, setResumeId] = useState('');
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const recents = JSON.parse(localStorage.getItem(RECENT_SESSIONS_STORAGE) ?? '[]');
      if (Array.isArray(recents)) setRecentSessions(recents.slice(0, 5));
    } catch {
      // ignore
    }
  }, []);

  function rememberSession(s: RecentSession) {
    const filtered = recentSessions.filter((r) => r.id !== s.id);
    const next = [s, ...filtered].slice(0, 5);
    setRecentSessions(next);
    localStorage.setItem(RECENT_SESSIONS_STORAGE, JSON.stringify(next));
  }

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!personaName.trim() || !topic.trim()) {
      setError('별명이랑 주제를 같이 적어줘.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaName: personaName.trim(),
          grade,
          topic: topic.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '세션 생성 실패');
      rememberSession({
        id: data.id,
        personaName: personaName.trim(),
        topic: topic.trim(),
        startedAt: new Date().toISOString(),
      });
      showToast('새 글쓰기를 시작할게!', { emoji: '✨' });
      router.push(`/write/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function handleResumeSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!resumeId.trim()) {
      setError('세션 번호를 입력해 줘.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sessions/${resumeId.trim()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '세션을 못 찾았어. 번호를 확인해 줘.');
      rememberSession({
        id: data.session.id,
        personaName: data.session.persona_name,
        topic: data.session.topic,
        startedAt: data.session.started_at,
      });
      router.push(`/write/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  function handleQuickResume(id: string) {
    setError(null);
    router.push(`/write/${id}`);
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-8 bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50">
      <div className="w-full max-w-xl">
        {/* 헤더 — 마스코트 + 제목 */}
        <header className="text-center mb-8 fade-in">
          <div className="flex justify-center mb-3 wiggle">
            <FriendFace mood="sharp" size={120} />
          </div>
          <h1 className="font-display text-4xl text-stone-800 mb-2">
            잘난척 까칠한 친구
          </h1>
          <p className="text-sm text-stone-500">
            나랑 같이 주장 글쓰기 해볼래? 답은 안 알려줄 거야 😏
          </p>
        </header>

        {/* 새 글쓰기 시작 */}
        <section className="bg-white rounded-3xl shadow-md border-2 border-amber-100 p-6 mb-5 fade-in">
          <h2 className="font-display text-2xl text-stone-800 mb-4 flex items-center gap-2">
            ✏️ 새 글쓰기 시작
          </h2>
          <form onSubmit={handleStart} className="space-y-4">
            <label className="block">
              <span className="text-sm font-bold text-stone-700">별명</span>
              <input
                type="text"
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
                placeholder="예: 지수"
                maxLength={20}
                spellCheck={false}
                autoCorrect="off"
                className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base focus:outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              />
            </label>
            <div>
              <span className="text-sm font-bold text-stone-700">학년</span>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {[4, 5, 6].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrade(g as 4 | 5 | 6)}
                    className={`py-3 rounded-2xl text-base font-bold border-2 transition ${
                      grade === g
                        ? 'bg-amber-400 border-amber-500 text-white shadow-md scale-[1.02]'
                        : 'bg-white border-stone-200 text-stone-600 hover:border-amber-300'
                    }`}
                  >
                    {g}학년
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="text-sm font-bold text-stone-700">
                글쓰기 주제
              </span>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="예: 어린이는 매일 책을 읽어야 한다"
                maxLength={80}
                spellCheck={false}
                autoCorrect="off"
                className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base focus:outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-amber-500 hover:bg-amber-600 disabled:bg-stone-300 text-white font-bold py-4 text-lg shadow-lg hover:shadow-xl transition hover:scale-[1.02]"
            >
              {submitting ? '시작 중...' : '🚀 시작하기'}
            </button>
          </form>
        </section>

        {/* 이어서 쓰기 */}
        <section className="bg-white rounded-3xl shadow-md border-2 border-sky-100 p-6 mb-5 fade-in">
          <h2 className="font-display text-2xl text-stone-800 mb-2 flex items-center gap-2">
            📂 이어서 쓰기
          </h2>
          <p className="text-sm text-stone-600 mb-4 leading-relaxed">
            이전에 쓰던 글을 이어서 작업합니다.
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setResumeId('');
              setResumeModalOpen(true);
            }}
            disabled={submitting}
            className="w-full rounded-2xl bg-sky-500 hover:bg-sky-600 disabled:bg-stone-300 text-white font-bold py-3.5 text-base shadow-md transition hover:scale-[1.02]"
          >
            📖 이어서 쓰기
          </button>

          {recentSessions.length > 0 && (
            <div className="mt-5 pt-4 border-t-2 border-stone-100">
              <h3 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-3">
                이 기기에서 최근에 쓴 글
              </h3>
              <ul className="space-y-2">
                {recentSessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => handleQuickResume(s.id)}
                      className="w-full text-left rounded-2xl px-4 py-3 bg-sky-50 hover:bg-sky-100 border-2 border-sky-100 hover:border-sky-300 transition hover:scale-[1.01]"
                    >
                      <div className="text-base font-bold text-stone-800">
                        {s.personaName} · {s.topic}
                      </div>
                      <div className="text-xs text-stone-500 font-mono mt-0.5">
                        {s.id}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {error && (
          <div className="rounded-2xl bg-rose-50 border-2 border-rose-200 px-4 py-3 text-sm text-rose-700 font-bold pop-in">
            ⚠️ {error}
          </div>
        )}

        <footer className="text-center text-xs text-stone-400 mt-6">
          ICCE 2026 prototype · LC paradigm grounded in 2022 Korean National Curriculum
        </footer>
      </div>

      {/* 이어쓰기 모달 */}
      {resumeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 fade-in">
          <button
            type="button"
            onClick={() => setResumeModalOpen(false)}
            aria-label="닫기"
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
          />
          <form
            onSubmit={handleResumeSubmit}
            className="relative bg-white rounded-3xl shadow-2xl border-4 border-sky-100 max-w-md w-full p-6 pop-in"
          >
            <div className="text-5xl text-center mb-3">📂</div>
            <h2 className="font-display text-2xl text-center text-stone-800 mb-3">
              이어서 쓰기
            </h2>
            <p className="text-center text-stone-600 text-sm mb-5 leading-relaxed">
              <span className="font-bold text-sky-700">선생님께 본인의 별명을</span>
              <br />
              <span className="font-bold text-sky-700">말씀드리고 세션 번호를 요청하세요.</span>
            </p>
            <label className="block mb-4">
              <span className="text-sm font-bold text-stone-700">세션 번호</span>
              <input
                type="text"
                value={resumeId}
                onChange={(e) => setResumeId(e.target.value)}
                placeholder="예: aBc123XyZ4De"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoFocus
                className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base font-mono focus:outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              />
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setResumeModalOpen(false)}
                className="flex-1 py-3 rounded-2xl border-2 border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 font-bold text-sm"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={submitting || !resumeId.trim()}
                className="flex-1 py-3 rounded-2xl bg-sky-500 hover:bg-sky-600 disabled:bg-stone-300 text-white font-bold text-sm shadow-md hover:scale-[1.02] transition"
              >
                {submitting ? '확인 중...' : '✅ 확인'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
