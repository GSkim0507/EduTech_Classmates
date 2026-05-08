'use client';

import { useEffect } from 'react';
import type { HelpDomain } from '@/lib/types';

export interface HelpDomainModalProps {
  open: boolean;
  onSelect: (domain: HelpDomain) => void;
  onCancel: () => void;
}

const OPTIONS: {
  id: HelpDomain;
  emoji: string;
  title: string;
  desc: string;
  bg: string;
  border: string;
  hoverBg: string;
}[] = [
  {
    id: 'idea',
    emoji: '💡',
    title: '아이디어가 안 떠올라',
    desc: '뭘 써야 할지 막혔을 때',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    hoverBg: 'hover:bg-amber-100',
  },
  {
    id: 'writing',
    emoji: '✏️',
    title: '글의 짜임이 헷갈려',
    desc: '주장·근거·구조가 어려울 때',
    bg: 'bg-sky-50',
    border: 'border-sky-300',
    hoverBg: 'hover:bg-sky-100',
  },
  {
    id: 'both',
    emoji: '🤷',
    title: '그냥 전부 다 봐줘',
    desc: '모르겠어, 다 봐줘',
    bg: 'bg-fuchsia-50',
    border: 'border-fuchsia-300',
    hoverBg: 'hover:bg-fuchsia-100',
  },
];

export default function HelpDomainModal({
  open,
  onSelect,
  onCancel,
}: HelpDomainModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 fade-in">
      <button
        type="button"
        onClick={onCancel}
        aria-label="닫기"
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
      />
      <div className="relative bg-white rounded-3xl shadow-2xl border-4 border-amber-100 max-w-md w-full p-6 pop-in">
        <h2 className="font-display text-2xl text-center text-stone-800 mb-2">
          어디서 막혔어? 🤔
        </h2>
        <p className="text-center text-stone-500 text-sm mb-5">
          친구가 도와줄 영역을 골라줘
        </p>
        <div className="space-y-3">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={`w-full text-left rounded-2xl border-2 ${opt.border} ${opt.bg} ${opt.hoverBg} px-5 py-4 transition hover:scale-[1.02] flex items-center gap-4`}
            >
              <span className="text-3xl flex-shrink-0">{opt.emoji}</span>
              <span>
                <span className="block font-bold text-stone-800 text-base">
                  {opt.title}
                </span>
                <span className="block text-xs text-stone-500 mt-0.5">
                  {opt.desc}
                </span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full py-2.5 rounded-2xl border-2 border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600 font-bold text-sm"
        >
          취소
        </button>
      </div>
    </div>
  );
}
