'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import type {
  SessionRow,
  DraftRow,
  TurnRow,
  CalibrationRow,
  ClosureRow,
} from '@/lib/types';
import DraftDiff from '@/components/admin/DraftDiff';

interface DetailResponse {
  session: SessionRow;
  drafts: DraftRow[];
  turns: TurnRow[];
  calibrations: CalibrationRow[];
  closure: ClosureRow | null;
}

type Tab = 'timeline' | 'drafts' | 'diff' | 'turns' | 'calibrations' | 'closure' | 'raw';

export default function AdminSessionDetail({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('timeline');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? '로드 실패');
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
      <main className="flex-1 bg-slate-100 flex items-center justify-center text-sm text-slate-500">
        로딩 중...
      </main>
    );
  }
  if (error || !data) {
    return (
      <main className="flex-1 bg-slate-100 flex items-center justify-center text-sm text-red-600">
        {error ?? '데이터를 찾을 수 없습니다.'}
      </main>
    );
  }

  const { session, drafts, turns, calibrations, closure } = data;

  return (
    <main className="flex-1 bg-slate-100 px-6 py-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-4">
          <div>
            <Link
              href="/admin"
              className="text-xs text-slate-500 hover:text-slate-800 underline"
            >
              ← 세션 목록
            </Link>
            <h1 className="text-xl font-semibold text-slate-800 mt-1">
              {session.persona_name} ({session.grade}학년)
            </h1>
            <div className="text-sm text-slate-600 mt-0.5">{session.topic}</div>
            <div className="text-xs font-mono text-slate-400 mt-0.5">
              {session.id}
            </div>
          </div>
          <a
            href={`/api/sessions/${session.id}/export`}
            download
            className="text-xs px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
          >
            📥 JSON 내보내기
          </a>
        </header>

        {/* 메타 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Stat label="상태" value={session.status} />
          <Stat label="페이즈" value={session.current_phase} />
          <Stat label="턴 수" value={turns.length.toString()} />
          <Stat label="draft 수" value={drafts.length.toString()} />
        </div>

        {/* 탭 */}
        <nav className="flex gap-1 border-b border-slate-300 mb-4 flex-wrap">
          {(
            ['timeline', 'drafts', 'diff', 'turns', 'calibrations', 'closure', 'raw'] as Tab[]
          ).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-medium ${
                tab === t
                  ? 'border-b-2 border-slate-800 text-slate-900'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tabLabel(t)}
            </button>
          ))}
        </nav>

        {/* 탭 내용 */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          {tab === 'timeline' && <TimelineView drafts={drafts} turns={turns} />}
          {tab === 'drafts' && <DraftsView drafts={drafts} />}
          {tab === 'diff' && <DiffView drafts={drafts} />}
          {tab === 'turns' && <TurnsView turns={turns} />}
          {tab === 'calibrations' && <CalibrationsView calibrations={calibrations} />}
          {tab === 'closure' && <ClosureView closure={closure} />}
          {tab === 'raw' && (
            <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-slate-50 p-3 rounded max-h-[600px] overflow-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </main>
  );
}

function tabLabel(t: Tab): string {
  return {
    timeline: '타임라인',
    drafts: '글 수정 기록',
    diff: '🔀 변화 비교',
    turns: '대화',
    calibrations: '재조정',
    closure: 'Closure',
    raw: '원시 JSON',
  }[t];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded border border-slate-200 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function TimelineView({ drafts, turns }: { drafts: DraftRow[]; turns: TurnRow[] }) {
  // 모든 이벤트(draft + turn)를 timestamp 순으로 통합
  type Event =
    | { kind: 'draft'; ts: string; data: DraftRow }
    | { kind: 'turn'; ts: string; data: TurnRow };
  const events: Event[] = [
    ...drafts.map((d): Event => ({ kind: 'draft', ts: d.timestamp, data: d })),
    ...turns.map((t): Event => ({ kind: 'turn', ts: t.timestamp, data: t })),
  ].sort((a, b) => a.ts.localeCompare(b.ts));

  return (
    <ol className="space-y-2">
      {events.map((e, i) => (
        <li
          key={i}
          className="border-l-2 border-slate-300 pl-3 py-1 text-sm"
        >
          <div className="text-xs text-slate-400 mb-0.5">
            {formatTs(e.ts)} · {e.kind === 'draft' ? '글 저장' : '대화'}
          </div>
          {e.kind === 'draft' ? (
            <div>
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 mr-2">
                {e.data.phase} · {e.data.source}
              </span>
              <span className="text-slate-600 text-xs">
                {e.data.content.length}자
              </span>
              <pre className="mt-1 text-xs font-mono whitespace-pre-wrap break-words text-slate-700 bg-slate-50 p-2 rounded">
                {e.data.content.slice(0, 200)}
                {e.data.content.length > 200 && '...'}
              </pre>
            </div>
          ) : (
            <div>
              <span
                className={`text-xs px-1.5 py-0.5 rounded mr-2 ${
                  e.data.role === 'student'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {e.data.role}
              </span>
              {e.data.triggered_by && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 mr-2">
                  {e.data.triggered_by}
                </span>
              )}
              {e.data.tone && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 mr-2">
                  {e.data.tone}
                </span>
              )}
              {e.data.domain && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-800">
                  {e.data.domain}
                </span>
              )}
              <pre className="mt-1 text-xs font-mono whitespace-pre-wrap break-words text-slate-700 bg-slate-50 p-2 rounded">
                {e.data.content}
              </pre>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function DraftsView({ drafts }: { drafts: DraftRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-600 uppercase">
          <tr>
            <th className="px-2 py-1.5 text-left">id</th>
            <th className="px-2 py-1.5 text-left">phase</th>
            <th className="px-2 py-1.5 text-left">source</th>
            <th className="px-2 py-1.5 text-right">길이</th>
            <th className="px-2 py-1.5 text-left">timestamp</th>
            <th className="px-2 py-1.5 text-left">content</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {drafts.map((d) => (
            <tr key={d.id}>
              <td className="px-2 py-1.5 font-mono">{d.id}</td>
              <td className="px-2 py-1.5">{d.phase}</td>
              <td className="px-2 py-1.5">
                <span
                  className={`px-1.5 py-0.5 rounded ${
                    d.source === 'committed'
                      ? 'bg-emerald-100 text-emerald-700'
                      : d.source === 'student_revise'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {d.source}
                </span>
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {d.content.length}
              </td>
              <td className="px-2 py-1.5 text-slate-500">{formatTs(d.timestamp)}</td>
              <td className="px-2 py-1.5 max-w-md truncate" title={d.content}>
                {d.content.slice(0, 80)}
                {d.content.length > 80 && '...'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TurnsView({ turns }: { turns: TurnRow[] }) {
  return (
    <div className="space-y-2">
      {turns.map((t) => (
        <div
          key={t.id}
          className={`text-xs p-2 rounded border ${
            t.role === 'student'
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-amber-50 border-amber-200'
          }`}
        >
          <div className="flex flex-wrap gap-1 items-center mb-1">
            <span className="font-mono text-slate-500">#{t.idx}</span>
            <span className="font-bold">{t.role}</span>
            <span className="text-slate-500">{t.phase}</span>
            {t.triggered_by && (
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                {t.triggered_by}
              </span>
            )}
            {t.tone && (
              <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                {t.tone}
              </span>
            )}
            {t.domain && (
              <span className="px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-800">
                {t.domain}
              </span>
            )}
            <span className="ml-auto text-slate-400">{formatTs(t.timestamp)}</span>
          </div>
          <pre className="font-mono whitespace-pre-wrap break-words">{t.content}</pre>
        </div>
      ))}
    </div>
  );
}

function CalibrationsView({ calibrations }: { calibrations: CalibrationRow[] }) {
  if (calibrations.length === 0) {
    return <div className="text-sm text-slate-400">아직 calibration이 없습니다.</div>;
  }
  return (
    <div className="space-y-3">
      {calibrations.map((c) => {
        const signals = JSON.parse(c.signals_json) as Record<string, unknown>;
        return (
          <div
            key={c.id}
            className="border border-slate-200 rounded p-3 text-xs"
          >
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="font-mono text-slate-500">#{c.id}</span>
              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                {c.phase} · {c.trigger}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                → {c.next_tone}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-800">
                → {c.next_domain}
              </span>
              {c.weakest_violation_label && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                  weakest: {c.weakest_violation_label}
                </span>
              )}
              <span className="ml-auto text-slate-400">{formatTs(c.timestamp)}</span>
            </div>
            <pre className="font-mono whitespace-pre-wrap break-all bg-slate-50 p-2 rounded text-slate-700">
              {JSON.stringify(signals, null, 2)}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function DiffView({ drafts }: { drafts: DraftRow[] }) {
  // 같은 (phase, paragraph_idx)별 그룹화 + 시간순 정렬
  const groups = new Map<string, DraftRow[]>();
  for (const d of drafts) {
    const key = `${d.phase}-${d.paragraph_idx}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }
  // 각 그룹은 id 순으로 정렬됨 (이미 SQL ORDER BY id)

  // 표시 순서: phase 순 → paragraph_idx 순
  const phaseOrder = ['intro', 'body', 'conclusion', 'title'];
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    const [pa, ia] = a.split('-');
    const [pb, ib] = b.split('-');
    const pd = phaseOrder.indexOf(pa) - phaseOrder.indexOf(pb);
    if (pd !== 0) return pd;
    return Number(ia) - Number(ib);
  });

  if (sortedKeys.length === 0) {
    return <div className="text-sm text-slate-400">아직 draft가 없습니다.</div>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">
        같은 페이즈·문단 안에서 학생이 글을 어떻게 바꿔갔는지 char-level diff로 보여줍니다. 추가
        = <span className="bg-emerald-100 text-emerald-900 px-1 rounded">초록</span> · 삭제 ={' '}
        <span className="bg-rose-100 text-rose-700 line-through px-1 rounded">빨강</span>
      </p>
      {sortedKeys.map((key) => {
        const group = groups.get(key)!;
        const [phase, idx] = key.split('-');
        const phaseLabel =
          phase === 'intro'
            ? '서론'
            : phase === 'body'
              ? `본론 ${Number(idx) + 1}문단`
              : phase === 'conclusion'
                ? '결론'
                : '제목';

        return (
          <section key={key} className="border border-slate-200 rounded-lg p-3">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">
              {phaseLabel}{' '}
              <span className="text-xs text-slate-400 font-normal">
                ({group.length}개 revision)
              </span>
            </h3>
            <div className="space-y-3">
              {group.map((d, i) => {
                const prev = i > 0 ? group[i - 1] : null;
                return (
                  <div key={d.id} className="text-xs">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-mono text-slate-400">#{d.id}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold ${
                          d.source === 'committed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : d.source === 'student_revise'
                              ? 'bg-amber-100 text-amber-700'
                              : d.source === 'regress_uncommit'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {d.source}
                      </span>
                      <span className="text-slate-400">{formatTs(d.timestamp)}</span>
                    </div>
                    {prev ? (
                      <DraftDiff previous={prev.content} current={d.content} />
                    ) : (
                      <div className="text-xs font-serif whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded p-3 text-slate-700">
                        <span className="text-[10px] text-slate-400 mb-1 block font-mono">
                          (첫 revision)
                        </span>
                        {d.content || (
                          <span className="italic text-slate-400">(빈 글)</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ClosureView({ closure }: { closure: ClosureRow | null }) {
  if (!closure) {
    return <div className="text-sm text-slate-400">아직 closure가 없습니다.</div>;
  }
  const rationale = JSON.parse(closure.rationale_json);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="closure_type" value={closure.closure_type} />
        <Stat label="persuasion_pct" value={closure.persuasion_pct?.toString() ?? '—'} />
        <Stat label="created_at" value={formatTs(closure.created_at)} />
      </div>
      <div>
        <h3 className="text-xs font-semibold text-slate-600 uppercase mb-1">
          agent_message
        </h3>
        <div className="border border-slate-200 rounded p-3 bg-slate-50 whitespace-pre-wrap">
          {closure.agent_message}
        </div>
      </div>
      <div>
        <h3 className="text-xs font-semibold text-slate-600 uppercase mb-1">
          rationale
        </h3>
        <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-slate-50 p-3 rounded">
          {JSON.stringify(rationale, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}
