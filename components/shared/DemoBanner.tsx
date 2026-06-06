'use client';
import { useRouter } from 'next/navigation';

export default function DemoBanner() {
  const router = useRouter();
  return (
    <div className="mx-4 mb-3 flex items-center justify-between bg-slate-800/80 border border-cyan-500/20 rounded-xl px-4 py-2.5">
      <div>
        <p className="text-cyan-400 text-xs font-medium leading-none mb-0.5">
          Demo Mode
        </p>
        <p className="text-slate-400 text-xs">
          Simulated portfolio · Lynch Growth Style
        </p>
      </div>
      <button
        onClick={() => router.push('/settings')}
        className="text-xs font-semibold text-white bg-cyan-500 hover:bg-cyan-600 px-3 py-1.5 rounded-lg whitespace-nowrap transition"
      >
        Connect →
      </button>
    </div>
  );
}
