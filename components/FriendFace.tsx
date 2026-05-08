import type { Tone } from '@/lib/types';

type Mood = 'calm' | 'sharp';

export type FriendFaceProps = {
  mood?: Mood;
  size?: number;
  className?: string;
  /** 자동으로 mood 결정: tone이 'annoying'이면 sharp */
  tone?: Tone | null;
};

function moodFromTone(tone?: Tone | null): Mood {
  return tone === 'annoying' ? 'sharp' : 'calm';
}

/**
 * 인라인 SVG 친구 얼굴.
 * mood='calm'  : 둥근 눈 + 살짝 웃는 입 (덜 깐깐한)
 * mood='sharp' : 한쪽 눈썹 올라간 + 한쪽 입꼬리 (깐깐한)
 */
export default function FriendFace({
  mood,
  size = 80,
  className,
  tone,
}: FriendFaceProps) {
  const m: Mood = mood ?? moodFromTone(tone);
  const fill = m === 'calm' ? '#fef3c7' : '#fce7f3';
  const stroke = m === 'calm' ? '#f59e0b' : '#ec4899';
  const ink = '#27272a';

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={m === 'calm' ? '평온한 친구' : '까칠한 친구'}
    >
      {/* 얼굴 */}
      <circle cx="50" cy="52" r="42" fill={fill} stroke={stroke} strokeWidth="3" />

      {/* 머리카락 (간단한 곡선) */}
      <path
        d="M 18 45 Q 30 18 50 14 Q 70 18 82 45"
        fill={stroke}
        opacity="0.85"
      />

      {m === 'calm' ? (
        <>
          {/* 평온: 동그란 눈 + 호감 입 */}
          <circle cx="36" cy="50" r="3.5" fill={ink} />
          <circle cx="64" cy="50" r="3.5" fill={ink} />
          <path
            d="M 35 70 Q 50 80 65 70"
            stroke={ink}
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
          />
          {/* 양 볼 핑크 */}
          <circle cx="28" cy="62" r="4.5" fill="#fb7185" opacity="0.45" />
          <circle cx="72" cy="62" r="4.5" fill="#fb7185" opacity="0.45" />
        </>
      ) : (
        <>
          {/* 까칠: 한쪽 눈썹 올라감 */}
          <path
            d="M 26 38 L 42 36"
            stroke={ink}
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <path
            d="M 58 32 L 74 38"
            stroke={ink}
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          {/* 살짝 째진 눈 */}
          <path
            d="M 32 50 L 40 50"
            stroke={ink}
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          <circle cx="64" cy="50" r="3.5" fill={ink} />
          {/* 한쪽 올라간 짜증 입 */}
          <path
            d="M 35 72 Q 50 64 65 70"
            stroke={ink}
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

/**
 * 작은 인라인 버전 (채팅 말풍선 옆에 붙이는 용)
 */
export function FriendFaceMini({
  tone,
  size = 28,
  className,
}: {
  tone?: Tone | null;
  size?: number;
  className?: string;
}) {
  return <FriendFace tone={tone} size={size} className={className} />;
}
