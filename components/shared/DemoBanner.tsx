'use client';
import { useRouter } from 'next/navigation';

export default function DemoBanner() {
  const router = useRouter();
  return (
    <div className="mx-4 mt-2 mb-1 bg-cyan-500/10 border border-cyan-500/20 rounded-xl px-4 py-2 flex justify-between items-center">
      <div>
        <p className="text-cyan-400 text-sm font-semibold">
          Demo Mode
        </p>
        <p className="text-slate-400 text-xs">
          Simulated portfolio · Lynch Growth Style
        </p>
      </div>
      <button
        onClick={() => router.push('/settings')}
        className="text-sm text-cyan-400 font-medium whitespace-nowrap"
      >
        Connect →
      </button>
    </div>
  );
}
