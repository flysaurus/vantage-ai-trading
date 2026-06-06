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
    needleRef.current.style.transformBox = 'fill-box';
    needleRef.current.style.transformOrigin = 'center';
    let startTime: number;
    let animFrame: number;
    function sweep(timestamp: number) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const angle = (elapsed / 2000) * 360;
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${angle}deg)`;
      }
      animFrame = requestAnimationFrame(sweep);
    }
    animFrame = requestAnimationFrame(sweep);
    return () => cancelAnimationFrame(animFrame);
  }, [animated]);

  useEffect(() => {
    if (!settling) return;
    if (!needleRef.current) return;
    needleRef.current.style.transformBox = 'fill-box';
    needleRef.current.style.transformOrigin = 'center';
    needleRef.current.animate([
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(14deg)' },
      { transform: 'rotate(-9deg)' },
      { transform: 'rotate(5deg)' },
      { transform: 'rotate(-2deg)' },
      { transform: 'rotate(0deg)' },
    ], {
      duration: 700,
      easing: 'ease-out',
      fill: 'forwards',
    });
  }, [settling]);

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
