'use client';

import { useRef, useEffect } from 'react';

export interface BodyParagraph {
  idx: number;
  content: string;
  committed: boolean;
}

export interface BodyParagraphListProps {
  paragraphs: BodyParagraph[];
  onChange: (idx: number, content: string) => void;
  onAdd: () => void;            // 최대 5
  onRemove: (idx: number) => void; // 최소 3
  /** 학생이 이 문단에 대해 "🤝 같이 고민해줘" 호출 */
  onHelp: (idx: number) => void;
  /** 학생이 이 문단으로 "🎯 친구 설득하기" 호출 */
  onShow: (idx: number) => void;
  disabled?: boolean;
  /** 액션 진행 중인 paragraph idx (해당 박스 약간 강조) */
  busyIdx?: number | null;
  /** 문단별 남은 "같이 고민" 카드 (0~2). 미지정이면 2. */
  helpRemainingByIdx?: Record<number, number>;
}

// 본론 최소 1문단 (페널티 적용), 정석 3문단, 최대 5문단
const MIN_PARAGRAPHS = 1;
const MAX_PARAGRAPHS = 5;
const HELP_PER_PARAGRAPH = 2;

export default function BodyParagraphList({
  paragraphs,
  onChange,
  onAdd,
  onRemove,
  onHelp,
  onShow,
  disabled,
  busyIdx,
  helpRemainingByIdx,
}: BodyParagraphListProps) {
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);

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
        const isBusy = busyIdx === p.idx;
        const isEmpty = !p.content.trim();

        return (
          <div
            key={p.idx}
            className={`rounded-2xl border-2 transition ${
              isCommitted
                ? 'border-emerald-200 bg-emerald-50/40'
                : isBusy
                  ? 'border-amber-400 bg-white shadow-md scale-[1.005]'
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
              className={`draft-input w-full min-h-[140px] resize-none px-5 py-3 text-stone-800 focus:outline-none placeholder:text-stone-300 ${
                isCommitted ? 'bg-stone-50/60 cursor-not-allowed' : 'bg-white'
              }`}
            />

            {/* 문단별 액션 버튼 */}
            {!isCommitted && (() => {
              const remaining = helpRemainingByIdx?.[p.idx] ?? HELP_PER_PARAGRAPH;
              const helpUsedUp = remaining <= 0;
              const cards =
                '🃏'.repeat(remaining) + '·'.repeat(Math.max(0, HELP_PER_PARAGRAPH - remaining));
              return (
                <div className="px-4 pb-3 pt-2 flex flex-wrap gap-2 items-center justify-end border-t border-amber-50">
                  <button
                    type="button"
                    onClick={() => onHelp(p.idx)}
                    disabled={disabled || isEmpty || helpUsedUp}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold border-2 border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:scale-[1.04] disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed flex items-center gap-1.5"
                    title={
                      helpUsedUp
                        ? '이 문단의 도움 카드를 다 썼어. 친구 설득하기로 평가 받아봐!'
                        : isEmpty
                          ? '먼저 문단을 조금 써 보자'
                          : `이 문단에 대해 같이 고민하기 (${remaining}장 남음)`
                    }
                  >
                    🤝 같이 고민해줘
                    <span className="text-[11px] font-mono opacity-80">{cards}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onShow(p.idx)}
                    disabled={disabled || isEmpty}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-400 hover:bg-amber-500 text-white shadow-sm hover:scale-[1.04] disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
                    title={isEmpty ? '먼저 문단을 조금 써 보자' : `이 문단으로 친구 설득하기`}
                  >
                    🎯 친구 설득하기
                  </button>
                </div>
              );
            })()}
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
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
        💡 <span className="font-bold">정석은 본론 3문단</span>이야. 1~2문단으로도
        넘어갈 수 있지만 그러면 친구가 쪼끔 더 까칠해질 수 있어!
      </p>
    </div>
  );
}
