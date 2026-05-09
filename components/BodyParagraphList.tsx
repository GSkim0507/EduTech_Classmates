'use client';

import { useRef, useEffect } from 'react';

export interface BodyParagraph {
  idx: number;
  content: string;
  committed: boolean;
}

export interface BodyParagraphListProps {
  paragraphs: BodyParagraph[];
  /** 강조 안 함 모드(본론 전체 자유 편집)에서는 -1 또는 미지정 */
  currentParagraphIdx?: number;
  onChange: (idx: number, content: string) => void;
  onAdd: () => void;            // 최대 5
  onRemove: (idx: number) => void; // 최소 3
  onSelect?: (idx: number) => void;
  disabled?: boolean;            // 전체 비활성 (api 호출 중)
}

const MIN_PARAGRAPHS = 3;
const MAX_PARAGRAPHS = 5;

export default function BodyParagraphList({
  paragraphs,
  onChange,
  onAdd,
  onRemove,
  disabled,
}: BodyParagraphListProps) {
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);

  // 새 문단 추가되면 그 문단으로 자동 포커스
  useEffect(() => {
    const last = paragraphs[paragraphs.length - 1];
    if (last && !last.committed && !last.content) {
      refs.current[last.idx]?.focus();
    }
  }, [paragraphs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const canAdd = paragraphs.length < MAX_PARAGRAPHS;
  const canRemove = paragraphs.length > MIN_PARAGRAPHS;

  return (
    <div className="space-y-4">
      {paragraphs.map((p) => {
        const isCommitted = p.committed;

        return (
          <div
            key={p.idx}
            className={`rounded-2xl border-2 transition ${
              isCommitted
                ? 'border-emerald-200 bg-emerald-50/40'
                : 'border-amber-200 bg-white hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <span
                  className={`font-display text-base ${
                    isCommitted ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  📝 {p.idx + 1}문단
                </span>
                {isCommitted && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-bold">
                    ✓ 확정됨
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-400">{p.content.length}자</span>
                {!isCommitted && canRemove && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`${p.idx + 1}번째 문단을 삭제할까?`)) {
                        onRemove(p.idx);
                      }
                    }}
                    className="text-xs px-2 py-1 rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                    title="이 문단 삭제"
                  >
                    − 삭제
                  </button>
                )}
              </div>
            </div>
            <textarea
              ref={(el) => {
                refs.current[p.idx] = el;
              }}
              value={p.content}
              disabled={isCommitted || disabled}
              onChange={(e) => onChange(p.idx, e.target.value)}
              placeholder={
                isCommitted
                  ? '확정됨 (수정하려면 회귀하기)'
                  : `${p.idx + 1}번째 문단을 써 봐. 소주제문 + 다각적 논증.`
              }
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className={`draft-input w-full min-h-[140px] resize-none px-5 py-3 text-stone-800 focus:outline-none placeholder:text-stone-300 rounded-b-2xl ${
                isCommitted ? 'bg-stone-50/60 cursor-not-allowed' : 'bg-white'
              }`}
            />
          </div>
        );
      })}

      {canAdd && (
        <button
          type="button"
          disabled={disabled}
          onClick={onAdd}
          className="w-full py-3.5 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/50 hover:bg-amber-100 text-amber-700 font-bold text-base transition hover:scale-[1.01] disabled:opacity-50"
        >
          + 본론 문단 추가 (최대 {MAX_PARAGRAPHS}문단)
        </button>
      )}
      {!canAdd && (
        <div className="text-center text-xs text-stone-400 py-2">
          본론은 최대 {MAX_PARAGRAPHS}문단까지 가능해.
        </div>
      )}
    </div>
  );
}
