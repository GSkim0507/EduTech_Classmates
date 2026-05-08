'use client';

import { useEffect } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  emoji?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'primary' | 'go' | 'danger';
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '응, 그렇게 할래',
  cancelText = '아니, 한 번 더',
  emoji = '🤔',
  onConfirm,
  onCancel,
  variant = 'primary',
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const confirmClass =
    variant === 'go'
      ? 'bg-emerald-500 hover:bg-emerald-600'
      : variant === 'danger'
        ? 'bg-rose-500 hover:bg-rose-600'
        : 'bg-amber-500 hover:bg-amber-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 fade-in">
      <button
        type="button"
        onClick={onCancel}
        aria-label="닫기"
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
      />
      <div className="relative bg-white rounded-3xl shadow-2xl border-4 border-amber-100 max-w-sm w-full p-6 pop-in">
        <div className="text-5xl text-center mb-2">{emoji}</div>
        <h2 className="font-display text-2xl text-center text-stone-800 mb-2">
          {title}
        </h2>
        <p className="text-center text-stone-600 text-sm mb-6 whitespace-pre-line">
          {message}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-2xl border-2 border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 font-bold text-sm"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 py-3 rounded-2xl text-white font-bold text-sm shadow-md hover:scale-[1.02] ${confirmClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
