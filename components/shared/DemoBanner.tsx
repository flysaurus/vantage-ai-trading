'use client';
import { useRouter } from 'next/navigation';

export default function DemoBanner() {
  const router = useRouter();
  return (
    <div className="mx-4 mb-3 flex items-center justify-between bg-slate-800/80 border border-cyan-500/20 rounded-xl px-4 py-3">
      <div>
        <p className="text-cyan-400 text-base font-semibold leading-snug">
          Demo Mode
        </p>
        <p className="text-slate-400 text-base leading-snug">
          Simulated portfolio · Lynch Growth Style
        </p>
      </div>
      <button
        onClick={() => router.push('/settings')}
        className="text-base font-semibold text-white bg-cyan-500 hover:bg-cyan-600 px-4 py-2 rounded-lg whitespace-nowrap transition"
      >
        Connect →
      </button>
    </div>
  );
}
