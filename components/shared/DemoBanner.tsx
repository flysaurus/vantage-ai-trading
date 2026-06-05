'use client';
import { useRouter } from 'next/navigation';

export default function DemoBanner({ investorStyle }: { investorStyle?: string }) {
  const router = useRouter();
  const label = (() => {
    const s = (investorStyle || 'buffett').toLowerCase();
    const map: Record<string, string> = {
      buffett: 'Buffett Value Style',
      lynch: 'Lynch Growth Style',
      livermore: 'Livermore Momentum Style',
      soros: 'Soros Macro Style',
      munger: 'Munger Dividend Style',
    };
    return map[s] || 'Growth Style';
  })();

  return (
    <div className="mx-4 mb-3 flex items-center justify-between bg-slate-800/80 border border-cyan-500/20 rounded-xl px-4 py-2.5">
      <div>
        <p className="text-cyan-400 text-xs font-medium leading-none mb-0.5">Demo Mode</p>
        <p className="text-slate-400 text-xs">Simulated portfolio · {label}</p>
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
