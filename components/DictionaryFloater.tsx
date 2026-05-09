'use client';

import { useState, useEffect, useRef } from 'react';

const DICT_URL = 'https://m.terms.naver.com/';

/**
 * 좌측 하단에 떠있는 "📖 사전" 버튼.
 * 클릭하면 휴대폰 모양 팝업(우측 하단)에 네이버 지식백과 모바일 페이지를 iframe으로 띄움.
 *
 * 주의:
 * - 일부 사이트(네이버 포함)는 X-Frame-Options로 iframe 임베드를 차단할 수 있음.
 * - 차단 감지 시 fallback 안내(새 창 열기 버튼) 노출.
 *
 * sandbox 속성으로 navigation/popup 차단:
 *   allow-scripts allow-same-origin allow-forms — 기본 동작은 허용,
 *   top navigation·popup·downloads는 자동 차단됨.
 */
export default function DictionaryFloater() {
  const [open, setOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const loadTimerRef = useRef<NodeJS.Timeout | null>(null);

  // open 시 일정 시간 안에 onLoad가 안 발생하면 차단 의심
  useEffect(() => {
    if (!open) return;
    setLoadFailed(false);
    loadTimerRef.current = setTimeout(() => {
      // 4초 내에 onLoad가 발생하지 않았다면 차단으로 간주
      if (iframeRef.current && !iframeRef.current.dataset.loaded) {
        setLoadFailed(true);
      }
    }, 4000);
    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [open]);

  const handleIframeLoad = () => {
    if (iframeRef.current) iframeRef.current.dataset.loaded = '1';
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
  };

  const handleOpenInNewWindow = () => {
    window.open(DICT_URL, '_blank', 'noopener,noreferrer,width=400,height=700');
  };

  return (
    <>
      {/* 좌측 하단 플로팅 사전 버튼 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-5 left-5 z-40 rounded-full shadow-lg border-2 transition flex items-center gap-2 px-4 py-3 font-bold text-base hover:scale-105 ${
          open
            ? 'bg-stone-700 text-white border-stone-800'
            : 'bg-white text-stone-700 border-amber-300 hover:bg-amber-50'
        }`}
        aria-label={open ? '사전 닫기' : '사전 열기'}
      >
        <span className="text-lg">{open ? '✕' : '📖'}</span>
        <span>{open ? '닫기' : '사전'}</span>
      </button>

      {/* 휴대폰 모양 팝업 (우측 하단) */}
      {open && (
        <div
          className="fixed bottom-20 left-5 z-40 pop-in"
          style={{ width: 360, maxWidth: 'calc(100vw - 40px)' }}
        >
          {/* 휴대폰 frame */}
          <div className="bg-stone-900 rounded-[36px] p-2 shadow-2xl">
            <div
              className="bg-white rounded-[28px] overflow-hidden relative"
              style={{ height: 640, maxHeight: 'calc(100vh - 140px)' }}
            >
              {/* 헤더 (휴대폰 노치 흉내) */}
              <div className="bg-stone-100 border-b border-stone-200 px-4 py-2 flex items-center justify-between">
                <span className="text-xs font-bold text-stone-700">📖 사전</span>
                <span className="text-[10px] text-stone-400 font-mono">
                  m.terms.naver.com
                </span>
              </div>

              {/* iframe 또는 fallback */}
              {!loadFailed ? (
                <iframe
                  ref={iframeRef}
                  src={DICT_URL}
                  onLoad={handleIframeLoad}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  className="w-full"
                  style={{ height: 'calc(100% - 40px)', border: 0 }}
                  title="네이버 지식백과 — 사전"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-center px-6 py-12 h-full">
                  <div className="text-5xl mb-4">😓</div>
                  <div className="text-sm font-bold text-stone-700 mb-1">
                    사전 페이지가 화면 안에 표시되지 않아.
                  </div>
                  <div className="text-xs text-stone-500 mb-5 leading-relaxed">
                    네이버 지식백과는 다른 사이트에 끼워서 보여주지 못하게
                    막아두었거든.
                    <br />새 창에서 열어볼래?
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenInNewWindow}
                    className="rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold px-6 py-3 shadow-md hover:scale-105 transition"
                  >
                    🔗 새 창에서 열기
                  </button>
                </div>
              )}
            </div>
            {/* 휴대폰 하단 노치 */}
            <div className="flex justify-center mt-1">
              <div className="w-20 h-1 bg-stone-700 rounded-full" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
