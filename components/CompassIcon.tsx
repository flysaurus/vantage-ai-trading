'use client';
import { useEffect, useRef } from 'react';

interface CompassIconProps {
  size?: number;
  color?: string; // default white
  animated?: boolean; // needle sweep animation
  settling?: boolean; // settling animation
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
    if (!animated || !needleRef.current) return;

    let startTime: number;
    let animFrame: number;

    function sweep(timestamp: number) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const angle = (elapsed / 2000) * 360;
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${angle}deg)`;
        needleRef.current.style.transformOrigin = 'center';
      }
      animFrame = requestAnimationFrame(sweep);
    }

    animFrame = requestAnimationFrame(sweep);
    return () => cancelAnimationFrame(animFrame);
  }, [animated]);

  useEffect(() => {
    if (!settling || !needleRef.current) return;

    const keyframes = [
      { transform: 'rotate(0deg)', transformOrigin: '50% 50%' },
      { transform: 'rotate(12deg)', transformOrigin: '50% 50%' },
      { transform: 'rotate(-8deg)', transformOrigin: '50% 50%' },
      { transform: 'rotate(5deg)', transformOrigin: '50% 50%' },
      { transform: 'rotate(-3deg)', transformOrigin: '50% 50%' },
      { transform: 'rotate(0deg)', transformOrigin: '50% 50%' },
    ];

    needleRef.current.animate(keyframes, {
      duration: 600,
      easing: 'ease-out',
      fill: 'forwards',
    });
  }, [settling]);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  const northH = size * 0.38;
  const sideH = size * 0.18;
  const southH = size * 0.18;
  const pointW = size * 0.07;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      fill="none"
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke={color}
        strokeWidth={size * 0.04}
        fill="none"
        opacity={0.9}
      />

      <g ref={needleRef}>
        <polygon
          points={`${cx},${cy - northH} ${cx + pointW},${cy} ${cx},${cy + southH * 0.3} ${cx - pointW},${cy}`}
          fill={color}
        />
        <polygon
          points={`${cx},${cy + southH} ${cx + pointW * 0.7},${cy} ${cx},${cy - southH * 0.3} ${cx - pointW * 0.7},${cy}`}
          fill={color}
          opacity={0.6}
        />
        <polygon
          points={`${cx + sideH},${cy} ${cx},${cy - pointW * 0.7} ${cx - sideH * 0.3},${cy} ${cx},${cy + pointW * 0.7}`}
          fill={color}
          opacity={0.5}
        />
        <polygon
          points={`${cx - sideH},${cy} ${cx},${cy - pointW * 0.7} ${cx + sideH * 0.3},${cy} ${cx},${cy + pointW * 0.7}`}
          fill={color}
          opacity={0.5}
        />
      </g>

      <circle cx={cx} cy={cy} r={size * 0.04} fill={color} />
    </svg>
  );
}
