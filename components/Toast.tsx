'use client';

import { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  emoji?: string;
  tone?: 'success' | 'info' | 'warn';
}

let nextId = 1;

const listeners = new Set<(t: ToastMessage) => void>();

export function showToast(text: string, opts?: { emoji?: string; tone?: ToastMessage['tone'] }) {
  const msg: ToastMessage = {
    id: nextId++,
    text,
    emoji: opts?.emoji,
    tone: opts?.tone ?? 'success',
  };
  listeners.forEach((fn) => fn(msg));
}

export default function ToastViewport() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const onMsg = (msg: ToastMessage) => {
      setToasts((prev) => [...prev, msg]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== msg.id));
      }, 2200);
    };
    listeners.add(onMsg);
    return () => {
      listeners.delete(onMsg);
    };
  }, []);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pop-in pointer-events-auto rounded-full shadow-lg px-5 py-2.5 flex items-center gap-2 text-sm font-bold border-2 ${
            t.tone === 'warn'
              ? 'bg-rose-50 border-rose-300 text-rose-700'
              : t.tone === 'info'
                ? 'bg-sky-50 border-sky-300 text-sky-800'
                : 'bg-emerald-50 border-emerald-300 text-emerald-800'
          }`}
        >
          {t.emoji && <span className="text-base">{t.emoji}</span>}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
