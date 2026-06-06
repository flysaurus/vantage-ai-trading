'use client';
import { useEffect, useRef } from 'react';

interface CompassIconProps {
  size?: number;
  color?: string;
  animated?: boolean;
  settling?: boolean;
  className?: string;
}

export default function CompassIcon({
  size = 40,
  color = 'white',
  animated = false,
  settling = false,
  className = '',
}: CompassIconProps) {
  const needleRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!animated) return;
    if (!needleRef.current) return;
    const el = needleRef.current;
    el.style.transformBox = 'fill-box';
    el.style.transformOrigin = 'center';

    // Randomly pick a direction: -25° (left) or +25° (right)
    const targetAngle = Math.random() < 0.5 ? -25 : 25;

    // Smooth CSS transition — 1.2s ease-in-out each way
    el.style.transition = 'transform 1.2s ease-in-out';

    // Phase 1: sway out to target angle
    const t1 = setTimeout(() => {
      el.style.transform = `rotate(${targetAngle}deg)`;
    }, 50);

    // Phase 2: return to north
    const t2 = setTimeout(() => {
      el.style.transform = 'rotate(0deg)';
    }, 1300);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      el.style.transition = '';
      el.style.transform = '';
    };
  }, [animated]);

  // settling kept for backwards compat — no-op, the animated effect is the primary animation

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const northTip = cy - size * 0.36;
  const southTip = cy + size * 0.22;
  const ewTip = size * 0.22;
  const northW = size * 0.065;
  const southW = size * 0.05;
  const ewW = size * 0.05;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      fill="none"
    >
      <circle
        cx={cx} cy={cy} r={r}
        stroke={color}
        strokeWidth={Math.max(1.5, size * 0.04)}
        fill="none"
        opacity={0.95}
      />
      <g ref={needleRef}>
        <polygon
          points={`${cx},${northTip} ${cx + northW},${cy} ${cx},${cy + size * 0.08} ${cx - northW},${cy}`}
          fill={color} opacity={1}
        />
        <polygon
          points={`${cx},${southTip} ${cx + southW},${cy} ${cx},${cy - size * 0.06} ${cx - southW},${cy}`}
          fill={color} opacity={0.45}
        />
        <polygon
          points={`${cx + ewTip},${cy} ${cx},${cy - ewW} ${cx - size * 0.05},${cy} ${cx},${cy + ewW}`}
          fill={color} opacity={0.35}
        />
        <polygon
          points={`${cx - ewTip},${cy} ${cx},${cy - ewW} ${cx + size * 0.05},${cy} ${cx},${cy + ewW}`}
          fill={color} opacity={0.35}
        />
      </g>
      <circle
        cx={cx} cy={cy}
        r={Math.max(1.5, size * 0.04)}
        fill={color} opacity={0.8}
      />
    </svg>
  );
}
