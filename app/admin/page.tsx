'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface SessionListRow {
  id: string;
  persona_name: string;
  grade: number;
  topic: string;
  started_at: string;
  last_updated: string;
  status: string;
  current_phase: string;
  turn_count: number;
  draft_count: number;
  closure_type: string | null;
  persuasion_pct: number | null;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/sessions');
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? '세션 목록 로드 실패');
        if (!cancelled) setSessions(body.sessions ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await fetch('/api/admin/login', { method: 'DELETE' });
    router.push('/admin/login');
  }

  return (
    <main className="flex-1 bg-slate-100 px-6 py-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">
              세션 데이터 뷰어
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              The Annoying Friend — 연구자 전용
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link
              href="/"
              className="text-xs px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            >
              학생 화면 →
            </Link>
            <button
              onClick={handleLogout}
              className="text-xs px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            >
              로그아웃
            </button>
          </div>
        </header>

        {/* CSV 일괄 export */}
        <section className="bg-white rounded-lg shadow-sm border border-slate-200 mb-4 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">📥 CSV 일괄 다운로드</h2>
          <p className="text-xs text-slate-500 mb-3">
            DB 전체를 분석용 CSV로 받습니다. 한글 깨짐 방지를 위해 UTF-8 BOM이 포함됩니다 (Excel 호환).
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/admin/export-csv?table=all"
              download
              className="text-xs px-3 py-2 rounded bg-slate-800 text-white hover:bg-slate-700 font-medium"
            >
              📊 세션 요약 (all)
            </a>
            <a
              href="/api/admin/export-csv?table=sessions"
              download
              className="text-xs px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            >
              sessions
            </a>
            <a
              href="/api/admin/export-csv?table=drafts"
              download
              className="text-xs px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            >
              drafts
            </a>
            <a
              href="/api/admin/export-csv?table=turns"
              download
              className="text-xs px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            >
              turns
            </a>
            <a
              href="/api/admin/export-csv?table=calibrations"
              download
              className="text-xs px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            >
              calibrations
            </a>
            <a
              href="/api/admin/export-csv?table=closures"
              download
              className="text-xs px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            >
              closures
            </a>
            <a
              href="/api/admin/export-csv?table=phase_commits"
              download
              className="text-xs px-3 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
            >
              phase_commits
            </a>
          </div>
        </section>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              전체 세션 ({sessions.length})
            </h2>
          </div>

          {loading && (
            <div className="px-4 py-12 text-center text-sm text-slate-500">
              로딩 중...
            </div>
          )}

          {error && (
            <div className="m-4 px-3 py-2 rounded bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && sessions.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-slate-400">
              아직 세션이 없습니다.
            </div>
          )}

          {!loading && !error && sessions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">ID</th>
                    <th className="px-3 py-2 text-left font-semibold">학생</th>
                    <th className="px-3 py-2 text-left font-semibold">학년</th>
                    <th className="px-3 py-2 text-left font-semibold">주제</th>
                    <th className="px-3 py-2 text-left font-semibold">상태</th>
                    <th className="px-3 py-2 text-left font-semibold">페이즈</th>
                    <th className="px-3 py-2 text-right font-semibold">턴</th>
                    <th className="px-3 py-2 text-right font-semibold">draft</th>
                    <th className="px-3 py-2 text-left font-semibold">closure</th>
                    <th className="px-3 py-2 text-right font-semibold">설득%</th>
                    <th className="px-3 py-2 text-left font-semibold">최종갱신</th>
                    <th className="px-3 py-2 text-center font-semibold">결과 화면</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        <Link
                          href={`/admin/sessions/${s.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {s.id}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-medium">{s.persona_name}</td>
                      <td className="px-3 py-2 text-center">{s.grade}</td>
                      <td className="px-3 py-2 max-w-xs truncate" title={s.topic}>
                        {s.topic}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                          {s.current_phase}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.turn_count}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.draft_count}
                      </td>
                      <td className="px-3 py-2">
                        {s.closure_type ? (
                          <ClosureBadge type={s.closure_type} />
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.persuasion_pct !== null ? `${s.persuasion_pct}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {formatDate(s.last_updated)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <a
                          href={`/result/${s.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={
                            s.closure_type
                              ? '학생이 본 최종 결과 화면 (closure 완료)'
                              : '학생 결과 화면 — closure 미생성 (부분 표시)'
                          }
                          className={`text-xs px-2 py-1 rounded border ${
                            s.closure_type
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-slate-50 border-slate-300 text-slate-500 hover:bg-slate-100'
                          }`}
                        >
                          🎉 보기
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'completed'
      ? 'bg-green-100 text-green-800'
      : status === 'abandoned'
        ? 'bg-slate-200 text-slate-600'
        : 'bg-blue-100 text-blue-800';
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${cls}`}>{status}</span>
  );
}

function ClosureBadge({ type }: { type: string }) {
  const cls =
    type === 'full'
      ? 'bg-emerald-100 text-emerald-800'
      : type === 'partial'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-rose-100 text-rose-800';
  return <span className={`text-xs px-1.5 py-0.5 rounded ${cls}`}>{type}</span>;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
