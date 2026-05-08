'use client';

import { useMemo } from 'react';
import { diffChars } from 'diff';

export interface DraftDiffProps {
  previous: string;
  current: string;
  className?: string;
}

/**
 * 두 draft 사이의 character-level diff를 inline으로 시각화.
 * 한국어는 char 단위가 안정적 (단어 분리 어려움 회피).
 *
 * - 추가된 부분: 초록 형광 배경 + ins 태그
 * - 삭제된 부분: 빨강 strikethrough + del 태그
 * - 변경 없음: 회색 텍스트
 */
export default function DraftDiff({
  previous,
  current,
  className,
}: DraftDiffProps) {
  const parts = useMemo(() => diffChars(previous, current), [previous, current]);

  if (previous === current) {
    return (
      <div className={`text-xs text-slate-400 italic ${className ?? ''}`}>
        (변경 없음)
      </div>
    );
  }

  const addedCount = parts
    .filter((p) => p.added)
    .reduce((sum, p) => sum + p.value.length, 0);
  const removedCount = parts
    .filter((p) => p.removed)
    .reduce((sum, p) => sum + p.value.length, 0);

  return (
    <div className={`text-sm leading-relaxed ${className ?? ''}`}>
      <div className="text-[10px] text-slate-500 mb-1 font-mono">
        +{addedCount}자 추가, −{removedCount}자 삭제
      </div>
      <div className="font-serif whitespace-pre-wrap break-words bg-white border border-slate-200 rounded p-3">
        {parts.map((part, i) => {
          if (part.added) {
            return (
              <ins
                key={i}
                className="bg-emerald-100 text-emerald-900 no-underline px-0.5 rounded-sm"
              >
                {part.value}
              </ins>
            );
          }
          if (part.removed) {
            return (
              <del
                key={i}
                className="bg-rose-100 text-rose-700 line-through px-0.5 rounded-sm"
              >
                {part.value}
              </del>
            );
          }
          return (
            <span key={i} className="text-slate-700">
              {part.value}
            </span>
          );
        })}
      </div>
    </div>
  );
}
