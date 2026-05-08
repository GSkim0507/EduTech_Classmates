import type { Tone } from '@/lib/types';

type Mood = 'calm' | 'sharp';

export type FriendFaceProps = {
  mood?: Mood;
  size?: number;
  className?: string;
  /** 자동으로 mood 결정: tone='annoying' → sharp(약오름) / 'less-annoying' → calm(잘난 척) */
  tone?: Tone | null;
};

function moodFromTone(tone?: Tone | null): Mood {
  // 게임 페르소나:
  //  - annoying = 학생 잘 씀 → 친구 약오름 (sharp)
  //  - less-annoying = 학생 못 씀 → 친구 잘난 척 (calm)
  return tone === 'annoying' ? 'sharp' : 'calm';
}

/**
 * 인라인 SVG 친구 얼굴.
 * mood='calm'  : 잘난 척 — 한쪽 눈 윙크 + 입꼬리 한쪽 ↑ + 핑크볼
 * mood='sharp' : 약오름 — 눈썹 V자 ↓ + 입 ⌒ ↓ + 빨간 볼
 */
export default function FriendFace({
  mood,
  size = 80,
  className,
  tone,
}: FriendFaceProps) {
  const m: Mood = mood ?? moodFromTone(tone);
  const fill = m === 'calm' ? '#fef3c7' : '#fee2e2';     // calm=amber-100, sharp=red-100
  const stroke = m === 'calm' ? '#f59e0b' : '#dc2626';    // calm=amber-500, sharp=red-600
  const ink = '#27272a';

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={m === 'calm' ? '잘난 척하는 친구' : '약오른 친구'}
    >
      {/* 얼굴 */}
      <circle cx="50" cy="52" r="42" fill={fill} stroke={stroke} strokeWidth="3" />

      {/* 머리카락 */}
      <path
        d="M 18 45 Q 30 18 50 14 Q 70 18 82 45"
        fill={stroke}
        opacity="0.85"
      />

      {m === 'calm' ? (
        <>
          {/* 잘난 척: 한쪽 눈 윙크 (오른쪽 눈만 동그라미) + 옆으로 휜 미소 + 핑크볼 */}
          {/* 왼쪽 눈 — 윙크 (선) */}
          <path
            d="M 30 50 L 42 50"
            stroke={ink}
            strokeWidth="3.2"
            strokeLinecap="round"
          />
          {/* 오른쪽 눈 — 동그란 눈 */}
          <circle cx="64" cy="50" r="3.5" fill={ink} />
          {/* 옆으로 휜 미소 (한쪽 올라감) */}
          <path
            d="M 35 70 Q 50 76 65 66"
            stroke={ink}
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
          />
          {/* 핑크볼 (잘난 척의 여유) */}
          <circle cx="28" cy="63" r="4.5" fill="#fb7185" opacity="0.5" />
          <circle cx="72" cy="63" r="4.5" fill="#fb7185" opacity="0.5" />
        </>
      ) : (
        <>
          {/* 약오름: 눈썹 V자 ↓ + 노려보는 눈 + 입 ⌒ ↓ + 빨간 볼 */}
          {/* 왼쪽 눈썹 — 안쪽이 내려간 V자 시작 */}
          <path
            d="M 26 35 L 42 41"
            stroke={ink}
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          {/* 오른쪽 눈썹 — 안쪽이 내려감 */}
          <path
            d="M 58 41 L 74 35"
            stroke={ink}
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          {/* 노려보는 눈 (작고 짙음) */}
          <circle cx="36" cy="52" r="3" fill={ink} />
          <circle cx="64" cy="52" r="3" fill={ink} />
          {/* 입 ⌒ ↓ (반전 미소, 짜증) */}
          <path
            d="M 35 72 Q 50 64 65 72"
            stroke={ink}
            strokeWidth="3.4"
            fill="none"
            strokeLinecap="round"
          />
          {/* 빨간 볼 (분노 톤) */}
          <circle cx="26" cy="64" r="5" fill="#dc2626" opacity="0.6" />
          <circle cx="74" cy="64" r="5" fill="#dc2626" opacity="0.6" />
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
