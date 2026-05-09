import Image from 'next/image';

/**
 * The Annoying Classmates 브랜드 헤더 — viewport 최상단 고정 (우측 정렬).
 * - position: fixed (정상 흐름에서 빠짐) + body에 padding-top 으로 콘텐츠 push.
 * - 우측 끝에 별하 심볼 + 'The Annoying Classmates' 워드마크.
 *
 * 심볼 원본 비율 357 × 256 (≈ 1.39:1)
 */
export default function BrandHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-[60] h-12 bg-amber-50/95 backdrop-blur-sm border-b border-amber-100 flex items-center justify-start px-4 sm:px-6">
      <a
        href="/"
        className="inline-flex items-center gap-2 px-2 py-1 rounded-full hover:bg-white/70 transition"
        aria-label="The Annoying Classmates 홈"
      >
        <Image
          src="/byeolha-symbol.png"
          alt=""
          width={45}
          height={32}
          priority
          className="h-7 w-auto"
        />
        <span className="font-display text-base sm:text-lg text-amber-700 tracking-tight whitespace-nowrap">
          The Annoying Classmates
        </span>
      </a>
    </header>
  );
}
