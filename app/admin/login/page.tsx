'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/admin';
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '로그인 실패');
      router.push(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-lg shadow-sm border border-slate-200 p-6"
      >
        <h1 className="text-lg font-semibold text-slate-800 mb-1">
          관리자 로그인
        </h1>
        <p className="text-xs text-slate-500 mb-4">
          연구자 전용 — Annoying Classmate 데이터 뷰어
        </p>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-500"
            autoFocus
            autoComplete="current-password"
          />
        </label>

        {error && (
          <div className="mt-3 rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !password}
          className="mt-4 w-full rounded-md bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white font-medium py-2 text-sm"
        >
          {submitting ? '확인 중...' : '로그인'}
        </button>
      </form>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center bg-slate-100 text-sm text-slate-500">로딩 중...</div>}>
      <LoginForm />
    </Suspense>
  );
}
