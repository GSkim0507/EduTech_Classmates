'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import type {
  SessionRow,
  DraftRow,
  TurnRow,
  ClosureRow,
  ClosureType,
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
    phase: 'intro' | 'body' | 'conclusion',
    paragraphIdx: number
  ): string {
    const draftId = commitMap.get(`${phase}-${paragraphIdx}`);
    if (!draftId) return '';
    return draftMap.get(draftId)?.content ?? '';
  }

  const intro = getCommittedContent('intro', 0);
  const conclusion = getCommittedContent('conclusion', 0);

  // 본론은 paragraph_idx 0..4 중 commit된 것만
  const bodyParagraphs: { idx: number; content: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const c = getCommittedContent('body', i);
    if (c) bodyParagraphs.push({ idx: i, content: c });
  }

  const closureMeta = closure ? CLOSURE_LABEL[closure.closure_type] : null;
  const rationale = closure
    ? (JSON.parse(closure.rationale_json) as {
        passed?: string[];
        failed?: string[];
        reasoning?: string;
      })
    : null;

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
          <section
            className="rounded-3xl border-4 p-6 mb-6 pop-in"
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
                <div
                  className="text-xs font-bold mb-3"
                  style={{ color: closureMeta.text }}
                >
                  설득력: {closure.persuasion_pct ?? '?'}%
                </div>
                <p className="text-base leading-relaxed text-stone-800 whitespace-pre-wrap">
                  {closure.agent_message}
                </p>

                {typeof closure.persuasion_pct === 'number' && (
                  <div className="mt-4">
                    <div className="h-3 w-full rounded-full bg-white/60 overflow-hidden border border-stone-200">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${closure.persuasion_pct}%`,
                          backgroundColor: closureMeta.text,
                        }}
                      />
                    </div>
                  </div>
                )}

                {rationale && (
                  <div className="mt-4 text-xs text-stone-600 space-y-1.5">
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
                    {rationale.reasoning && (
                      <div className="italic mt-2 text-stone-500">
                        {rationale.reasoning}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="bg-white rounded-3xl border-2 border-amber-100 shadow-sm p-6 mb-6 fade-in">
          <h2 className="font-display text-2xl text-stone-800 mb-4">📜 네가 쓴 글</h2>
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
