import React from 'react';

interface PronunciationScoreCircleProps {
  score: number; // Score from 0 to 5 (qualityScore from API) or 0 to 1
}

const PronunciationScoreCircle: React.FC<PronunciationScoreCircleProps> = ({ score }) => {
  const size = 20;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Normalize: if score > 1, assume 0-5 scale; otherwise 0-1
  const normalizedScore = score > 1 ? Math.min(score / 5, 1) : Math.min(score, 1);
  const offset = circumference - normalizedScore * circumference;

  const scorePercentage = Math.round(normalizedScore * 100);

  const getColor = () => {
    if (scorePercentage < 60) return 'text-rose-500 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]';
    if (scorePercentage < 80) return 'text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]';
    return 'text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.6)]';
  };

  const color = getColor();

  return (
    <div className="relative flex items-center justify-center select-none" style={{ width: size, height: size }}>
      <svg className="absolute transform -rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          className="text-white/10"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        {/* Progress */}
        <circle
          className={`${color} transition-all duration-1000 ease-out`}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
          }}
        />
      </svg>
      <span className={`text-[8px] font-bold tracking-tighter ${color.split(' ')[0]}`}>
        {scorePercentage}
      </span>
    </div>
  );
};

export default PronunciationScoreCircle;