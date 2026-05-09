'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import type {
  SessionRow,
  DraftRow,
  TurnRow,
  ClosureRow,
  ClosureType,
  ClosureRationale,
  ClosureAxisAssessment,
  PhaseParagraphCommitRow,
} from '@/lib/types';
import FriendFace from '@/components/FriendFace';

interface SessionResponse {
  session: SessionRow;
  drafts: DraftRow[];
  turns: TurnRow[];
  closure: ClosureRow | null;
  phase_commits?: PhaseParagraphCommitRow[];
}

const CLOSURE_LABEL: Record<
  ClosureType,
  {
    ko: string;
    emoji: string;
    bg: string;
    border: string;
    text: string;
    mood: 'calm' | 'sharp';
  }
> = {
  full: {
    ko: '완전 설득됐어!',
    emoji: '🤝',
    bg: '#ecfdf5',
    border: '#6ee7b7',
    text: '#047857',
    mood: 'sharp', // 친구가 인정하면서도 약오름
  },
  partial: {
    ko: '반쯤 설득',
    emoji: '🤔',
    bg: '#fffbeb',
    border: '#fcd34d',
    text: '#92400e',
    mood: 'calm',
  },
  impasse: {
    ko: '입장은 그대로지만',
    emoji: '😏',
    bg: '#fff1f2',
    border: '#fda4af',
    text: '#9f1239',
    mood: 'calm', // 친구 잘난 척
  },
};

export default function ResultPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? '세션 로드 실패');
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center bg-amber-50">
        <div className="text-center">
          <div className="wiggle inline-block">
            <FriendFace mood="calm" size={80} />
          </div>
          <p className="text-stone-500 text-sm mt-3">결과 불러오는 중...</p>
        </div>
      </main>
    );
  }
  if (error || !data) {
    return (
      <main className="flex-1 flex items-center justify-center bg-amber-50">
        <div className="text-sm text-rose-600">{error ?? '세션을 못 찾았어.'}</div>
      </main>
    );
  }

  const { session, drafts, closure, phase_commits = [] } = data;

  // commit된 draft만 phase/paragraph_idx 순으로 추출
  const commitMap = new Map(
    phase_commits.map((c) => [`${c.phase}-${c.paragraph_idx}`, c.committed_draft_id])
  );
  const draftMap = new Map(drafts.map((d) => [d.id, d]));

  function getCommittedContent(
    phase: 'intro' | 'body' | 'conclusion' | 'title',
    paragraphIdx: number
  ): string {
    const draftId = commitMap.get(`${phase}-${paragraphIdx}`);
    if (!draftId) return '';
    return draftMap.get(draftId)?.content ?? '';
  }

  const intro = getCommittedContent('intro', 0);
  const conclusion = getCommittedContent('conclusion', 0);
  const title = session.title ?? getCommittedContent('title', 0);

  // 본론은 paragraph_idx 0..4 중 commit된 것만
  const bodyParagraphs: { idx: number; content: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const c = getCommittedContent('body', i);
    if (c) bodyParagraphs.push({ idx: i, content: c });
  }

  const closureMeta = closure ? CLOSURE_LABEL[closure.closure_type] : null;
  const rationale: ClosureRationale | null = closure
    ? (JSON.parse(closure.rationale_json) as ClosureRationale)
    : null;
  const persuasionHook =
    rationale?.persuasion_hook ??
    (closure
      ? `결론적으로 나는 네 주장에 ${closure.persuasion_pct ?? '?'}% 확신이 들었어.`
      : '');

  return (
    <main className="flex-1 px-4 py-8 bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8 text-center fade-in">
          <div className="text-6xl mb-2 star-burst">🎉</div>
          <h1 className="font-display text-4xl text-stone-800">글쓰기 마침!</h1>
          <p className="text-sm text-stone-500 mt-2">
            {session.persona_name} ({session.grade}학년) · {session.topic}
          </p>
        </header>

        {closure && closureMeta && (
          <>
            {/* 🎯 최상단 Persuasion 훅 — 학생이 바로 보는 핵심 한 줄 */}
            <section className="rounded-3xl border-4 border-amber-300 bg-gradient-to-br from-amber-100 via-orange-100 to-rose-100 p-6 mb-4 pop-in shadow-lg">
              <div className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2 text-center">
                🎯 친구의 최종 한 마디
              </div>
              <p className="font-display text-2xl sm:text-3xl text-stone-800 leading-relaxed text-center">
                {persuasionHook}
              </p>
              {typeof closure.persuasion_pct === 'number' && (
                <div className="mt-4 max-w-md mx-auto">
                  <div className="h-4 w-full rounded-full bg-white/70 overflow-hidden border border-amber-200">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${closure.persuasion_pct}%`,
                        backgroundColor: closureMeta.text,
                      }}
                    />
                  </div>
                  <div
                    className="text-center text-sm font-bold mt-1"
                    style={{ color: closureMeta.text }}
                  >
                    설득력 {closure.persuasion_pct}%
                  </div>
                </div>
              )}
            </section>

            {/* Closure 본문 카드 */}
            <section
              className="rounded-3xl border-4 p-6 mb-6 fade-in"
              style={{
                backgroundColor: closureMeta.bg,
                borderColor: closureMeta.border,
              }}
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <FriendFace mood={closureMeta.mood} size={88} />
                </div>
                <div className="flex-1">
                  <div
                    className="font-display text-2xl mb-1"
                    style={{ color: closureMeta.text }}
                  >
                    {closureMeta.emoji} {closureMeta.ko}
                  </div>
                  <p className="text-base leading-relaxed text-stone-800 whitespace-pre-wrap">
                    {closure.agent_message}
                  </p>
                  {rationale?.reasoning && (
                    <div className="italic mt-3 text-xs text-stone-500">
                      {rationale.reasoning}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* 3축 평가 카드 */}
            {(rationale?.structure_assessment ||
              rationale?.content_assessment ||
              rationale?.feedback_acceptance) && (
              <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 fade-in">
                <AxisCard
                  emoji="🏛️"
                  label="글 구조"
                  axis={rationale?.structure_assessment}
                  accent="border-sky-200 bg-sky-50"
                />
                <AxisCard
                  emoji="💡"
                  label="아이디어·내용"
                  axis={rationale?.content_assessment}
                  accent="border-emerald-200 bg-emerald-50"
                />
                <AxisCard
                  emoji="👂"
                  label="친구 피드백 수용"
                  axis={rationale?.feedback_acceptance}
                  accent="border-amber-200 bg-amber-50"
                />
              </section>
            )}

            {/* 호환: 예전 포맷 (3축 없는 경우) */}
            {!rationale?.structure_assessment &&
              !rationale?.content_assessment &&
              !rationale?.feedback_acceptance &&
              rationale &&
              ((rationale.passed && rationale.passed.length > 0) ||
                (rationale.failed && rationale.failed.length > 0)) && (
                <section className="rounded-2xl border-2 border-stone-200 bg-white px-5 py-4 mb-6 fade-in text-sm text-stone-700 space-y-1.5">
                  {rationale.passed && rationale.passed.length > 0 && (
                    <div>
                      <span className="font-bold">✓ 잘한 부분: </span>
                      {rationale.passed.join(', ')}
                    </div>
                  )}
                  {rationale.failed && rationale.failed.length > 0 && (
                    <div>
                      <span className="font-bold">✗ 보강하면 좋을 부분: </span>
                      {rationale.failed.join(', ')}
                    </div>
                  )}
                </section>
              )}
          </>
        )}

        <section className="bg-white rounded-3xl border-2 border-amber-100 shadow-sm p-6 mb-6 fade-in">
          <h2 className="font-display text-2xl text-stone-800 mb-4">📜 네가 쓴 글</h2>

          {title && (
            <div className="mb-6 pb-5 border-b-2 border-amber-100 text-center">
              <div className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-1">
                제목
              </div>
              <h3 className="font-display text-3xl text-stone-800 leading-snug">
                {title}
              </h3>
            </div>
          )}

          <article className="space-y-5 text-stone-800 leading-relaxed">
            <DraftBlock label="서론" content={intro} />
            {bodyParagraphs.length > 0 ? (
              <div>
                <h3 className="font-display text-lg text-amber-700 mb-1">본론</h3>
                <div className="space-y-3">
                  {bodyParagraphs.map((p) => (
                    <div key={p.idx}>
                      <div className="text-xs font-bold text-amber-600 uppercase tracking-wide mb-1">
                        {p.idx + 1}문단
                      </div>
                      <p className="text-base whitespace-pre-wrap leading-loose">
                        {p.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <DraftBlock label="본론" content="" />
            )}
            <DraftBlock label="결론" content={conclusion} />
          </article>
        </section>

        {/* 하단 Persuasion 훅 — 학생이 글을 다 읽고 마지막에 다시 본다 */}
        {closure && closureMeta && (
          <section className="rounded-3xl border-4 border-amber-300 bg-gradient-to-br from-rose-100 via-orange-100 to-amber-100 p-6 mb-6 pop-in shadow-lg">
            <div className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2 text-center">
              🤝 다시 한 번 — 친구의 잔여 동의도
            </div>
            <p className="font-display text-xl sm:text-2xl text-stone-800 leading-relaxed text-center">
              {persuasionHook}
            </p>
          </section>
        )}

        <section className="bg-white rounded-3xl border-2 border-sky-100 shadow-sm p-6 mb-6 fade-in">
          <h2 className="font-display text-2xl text-stone-800 mb-2">📥 데이터 내보내기</h2>
          <p className="text-sm text-stone-600 mb-4 leading-relaxed">
            이 글쓰기 세션의 모든 액션·대화·평가 기록을 JSON 파일로 받을 수 있어.
          </p>
          <a
            href={`/api/sessions/${sessionId}/export`}
            download
            className="inline-flex items-center gap-2 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white px-5 py-3 text-base font-bold shadow-md hover:scale-[1.02] transition"
          >
            📥 JSON 다운로드
          </a>
        </section>

        <div className="text-center">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="text-sm text-stone-500 hover:text-stone-800 underline"
          >
            로비로 돌아가기
          </button>
        </div>
      </div>
    </main>
  );
}

function DraftBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <h3 className="font-display text-lg text-amber-700 mb-1">{label}</h3>
      <p className="text-base whitespace-pre-wrap leading-loose">
        {content || <span className="text-stone-400 italic">(작성 안 됨)</span>}
      </p>
    </div>
  );
}

function AxisCard({
  emoji,
  label,
  axis,
  accent,
}: {
  emoji: string;
  label: string;
  axis?: ClosureAxisAssessment;
  accent: string;
}) {
  if (!axis) {
    return (
      <div className={`rounded-2xl border-2 ${accent} px-4 py-4 text-center text-sm text-stone-400`}>
        <div className="text-xl mb-1">{emoji}</div>
        <div className="font-bold text-stone-600 mb-1">{label}</div>
        <div className="italic">평가 정보 없음</div>
      </div>
    );
  }
  return (
    <div className={`rounded-2xl border-2 ${accent} px-4 py-4 flex flex-col gap-2`}>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl">{emoji}</span>
        <span className="font-display text-lg text-stone-800">{label}</span>
        <span className="ml-auto text-sm font-bold text-stone-600 tabular-nums">
          {axis.score}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-white/70 overflow-hidden border border-stone-200">
        <div
          className="h-full bg-stone-700 transition-all"
          style={{ width: `${Math.max(0, Math.min(100, axis.score))}%` }}
        />
      </div>
      <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
        {axis.comment}
      </p>
      {axis.passed && axis.passed.length > 0 && (
        <div className="text-xs text-emerald-700">
          ✓ {axis.passed.join(', ')}
        </div>
      )}
      {axis.failed && axis.failed.length > 0 && (
        <div className="text-xs text-rose-700">
          ✗ {axis.failed.join(', ')}
        </div>
      )}
    </div>
  );
}
