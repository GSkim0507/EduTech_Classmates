'use client';

import { useState } from 'react';

export interface PrecedingContextProps {
  intro?: string;
  bodyParagraphs?: string[];
  conclusion?: string;
  /** 'body' | 'conclusion' | 'title' */
  currentPhase: 'body' | 'conclusion' | 'title';
  /** body 페이즈에서 현재 작업 중인 문단 idx (0-based). 그 이전 문단들만 표시. */
  currentParagraphIdx?: number;
  className?: string;
}

export default function PrecedingContext({
  intro,
  bodyParagraphs,
  conclusion,
  currentPhase,
  currentParagraphIdx,
  className,
}: PrecedingContextProps) {
  const [expanded, setExpanded] = useState(false);

  // 표시할 문단들 결정
  const showIntro = !!intro?.trim();
  const showBody =
    currentPhase === 'conclusion' || currentPhase === 'title'
      ? bodyParagraphs ?? []
      : (bodyParagraphs ?? []).filter((_, i) =>
          typeof currentParagraphIdx === 'number' ? i < currentParagraphIdx : true
        );
  const showConclusion = currentPhase === 'title' && !!conclusion?.trim();

  if (!showIntro && showBody.length === 0 && !showConclusion) return null;

  const totalCount = (showIntro ? 1 : 0) + showBody.length + (showConclusion ? 1 : 0);

  return (
    <div
      className={`rounded-2xl border-2 border-sky-100 bg-sky-50/40 ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-sky-50/80"
      >
        <span className="font-bold text-sm text-sky-800">
          📜 지금까지 쓴 글 ({totalCount}개 부분)
        </span>
        <span className="text-xs text-sky-600">{expanded ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-sky-100 space-y-3 max-h-[40vh] overflow-y-auto fade-in">
          {showIntro && (
            <div>
              <h4 className="text-xs font-bold text-sky-700 uppercase tracking-wide mb-1">
                서론
              </h4>
              <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                {intro}
              </p>
            </div>
          )}
          {showBody.map((content, i) => (
            <div key={i}>
              <h4 className="text-xs font-bold text-sky-700 uppercase tracking-wide mb-1">
                본론 {i + 1}문단
              </h4>
              <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                {content}
              </p>
            </div>
          ))}
          {showConclusion && (
            <div>
              <h4 className="text-xs font-bold text-sky-700 uppercase tracking-wide mb-1">
                결론
              </h4>
              <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                {conclusion}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
