import React from 'react';

interface CompletionGaugeProps {
  percentage: number;
  completedCount: number;
  totalCount: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}

export const CompletionGauge: React.FC<CompletionGaugeProps> = ({
  percentage,
  completedCount,
  totalCount,
  size = 180,
  strokeWidth = 14,
  color = '#10b981',
  label = 'Tasks Done',
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPercentage = Math.min(100, Math.max(0, percentage));
  const strokeDashoffset = circumference - (clampedPercentage / 100) * circumference;

  return (
    <div
      className="mm-card mm-gauge"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        width: size,
        height: size,
      }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Value Fill */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          style={{
            transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </svg>

      <div
        style={{
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <span style={{ fontSize: 32, fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>
          {clampedPercentage}%
        </span>
        <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, fontWeight: 600 }}>
          {completedCount} / {totalCount} {label}
        </span>
      </div>
    </div>
  );
};
