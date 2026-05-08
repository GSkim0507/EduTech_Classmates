'use client';

export interface WinGaugeProps {
  /** 0~100 — 학생 잘함 정도. calibration의 studentScore 또는 0~100 사이 */
  studentScore: number | null;
  className?: string;
}

/**
 * 게임 페르소나 — 학생이 잘 쓸수록 좌측이 길어지고 친구(우측) 영역의 빨간 색이 진해짐.
 * 학생 점수가 없으면(아직 평가 전) 50:50 평이.
 */
export default function WinGauge({ studentScore, className }: WinGaugeProps) {
  const score = typeof studentScore === 'number'
    ? Math.max(0, Math.min(100, studentScore))
    : 50;
  const friendIntensity = score / 100; // 0~1, 친구 약오름 정도

  let caption: string;
  let captionColor: string;
  if (typeof studentScore !== 'number') {
    caption = '아직 평가 전';
    captionColor = 'text-stone-500';
  } else if (score >= 70) {
    caption = '😤 친구가 약오르는 중!';
    captionColor = 'text-red-600';
  } else if (score >= 45) {
    caption = '😐 비등비등';
    captionColor = 'text-stone-600';
  } else {
    caption = '😏 친구가 잘난 척 중';
    captionColor = 'text-amber-700';
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-[10px] font-bold text-stone-500 mb-1">
        <span>나</span>
        <span className={captionColor}>{caption}</span>
        <span>친구</span>
      </div>
      <div className="relative h-3 rounded-full overflow-hidden border border-stone-200 bg-stone-100">
        {/* 학생 영역 (좌측 emerald) */}
        <div
          className="absolute left-0 top-0 bottom-0 bg-emerald-400 transition-all duration-500"
          style={{ width: `${score}%` }}
        />
        {/* 친구 영역 (우측 빨강, 학생 점수 높을수록 진해짐) */}
        <div
          className="absolute right-0 top-0 bottom-0 transition-all duration-500"
          style={{
            width: `${100 - score}%`,
            backgroundColor: `rgba(220, 38, 38, ${0.4 + friendIntensity * 0.5})`,
          }}
        />
      </div>
    </div>
  );
}
