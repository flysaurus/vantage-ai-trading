'use client';

import { useState } from 'react';
import CompassIcon from '@/components/CompassIcon';

const THEMES = [
  { key: 'ai_infrastructure', emoji: '🤖', name: 'AI Infrastructure' },
  { key: 'clean_energy', emoji: '🌱', name: 'Clean Energy' },
  { key: 'cybersecurity', emoji: '🛡️', name: 'Cybersecurity' },
  { key: 'healthcare_innovation', emoji: '🧬', name: 'Healthcare' },
  { key: 'dividend_aristocrats', emoji: '💰', name: 'Dividends' },
  { key: 'reshoring', emoji: '🏭', name: 'Reshoring' },
  { key: 'fintech', emoji: '💳', name: 'Fintech' },
  { key: 'consumer_comeback', emoji: '🛍️', name: 'Consumer' },
];

type Step = 'theme' | 'budget' | 'custom';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBasketGenerated: (msg: string, data: any) => void;
}

export default function BuildBasketModal({ isOpen, onClose, onBasketGenerated }: Props) {
  const [step, setStep] = useState<Step>('theme');
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [budget, setBudget] = useState('');
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  if (!isOpen) return null;

  const themeData = THEMES.find(t => t.key === selectedTheme);

  async function handleGenerate() {
    if (!selectedTheme) return;
    setIsGenerating(true);
    const budgetText = budget ? ` with a $${parseInt(budget).toLocaleString()} budget` : '';
    const message = `Build me a ${themeData?.name} basket${budgetText}`;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, mode: 'theme', responseMode: 'detailed' }),
      });
      const data = await res.json();
      onClose();
      onBasketGenerated(message, data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerateCustom() {
    if (!customName.trim() || !customDesc.trim()) return;
    setIsGenerating(true);
    const message = `Build me a custom basket called "${customName}". Focus on: ${customDesc}`;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, mode: 'theme', responseMode: 'detailed' }),
      });
      const data = await res.json();
      onClose();
      onBasketGenerated(message, data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }

  function reset() {
    setStep('theme');
    setSelectedTheme(null);
    setBudget('');
    setCustomName('');
    setCustomDesc('');
    setIsGenerating(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0 pt-safe">
        <div className="flex items-center gap-3">
          {step !== 'theme' && (
            <button
              onClick={() => setStep('theme')}
              className="text-slate-400 p-1"
            >
              ←
            </button>
          )}
          <div>
            <h2 className="text-white font-semibold text-lg">
              {step === 'theme'
                ? 'Build a Basket'
                : step === 'custom'
                  ? 'Custom Basket'
                  : themeData?.name || ''}
            </h2>
            <p className="text-slate-400 text-xs">
              {step === 'theme'
                ? 'AI scores stocks for your style'
                : step === 'custom'
                  ? 'Describe your investment theme'
                  : 'Set your budget'}
            </p>
          </div>
        </div>

        <button
          onClick={reset}
          className="text-slate-400 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-800"
        >
          ✕
        </button>
      </div>

      {/* STEP: Theme selection */}
      {step === 'theme' && (
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6">
          {/* Section label */}
          <p className="text-slate-500 text-xs uppercase tracking-wider mb-3">
            Select a theme
          </p>

          <div className="grid grid-cols-2 gap-3">
            {THEMES.map(theme => (
              <button
                key={theme.key}
                onClick={() => {
                  setSelectedTheme(theme.key);
                  setStep('budget');
                }}
                className="flex items-center gap-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 hover:border-cyan-500/60 rounded-2xl p-4 text-left transition-all active:scale-95"
              >
                <span className="text-3xl flex-shrink-0">
                  {theme.emoji}
                </span>
                <p className="text-white text-sm font-semibold leading-tight">
                  {theme.name}
                </p>
              </button>
            ))}

            {/* Custom basket — full width, dashed border */}
            <button
              onClick={() => setStep('custom')}
              className="col-span-2 flex items-center gap-3 bg-slate-800/50 hover:bg-slate-700 border border-slate-700 border-dashed hover:border-cyan-500/60 rounded-2xl p-4 text-left transition-all"
            >
              <span className="text-3xl">✏️</span>
              <div>
                <p className="text-white text-sm font-semibold">
                  Custom Basket
                </p>
                <p className="text-slate-400 text-xs">
                  Describe your own theme
                </p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* STEP: Budget */}
      {step === 'budget' && (
        <>
          <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4">
            {/* Theme preview */}
            <div className="flex items-center gap-3 mb-6 p-4 bg-slate-800 rounded-2xl border border-slate-700">
              <span className="text-4xl">
                {themeData?.emoji}
              </span>
              <div>
                <p className="text-white font-semibold">
                  {themeData?.name}
                </p>
                <p className="text-slate-400 text-xs">
                  AI will score and rank stocks for your Growth-Style mandate
                </p>
              </div>
            </div>

            {/* Budget input */}
            <p className="text-slate-400 text-xs uppercase tracking-wider mb-3">
              Budget (optional)
            </p>

            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-3xl font-light">$</span>
                <input
                  type="number"
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                  placeholder="0"
                  className="bg-transparent text-white text-4xl font-bold flex-1 outline-none placeholder-slate-700"
                  autoFocus
                />
              </div>

              {/* Quick amounts */}
              <div className="grid grid-cols-4 gap-2 mt-4">
                {[1000, 5000, 10000, 25000].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setBudget(String(amt))}
                    className={`py-2.5 rounded-xl text-sm font-medium transition ${
                      budget === String(amt)
                        ? 'bg-cyan-500 text-white'
                        : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    ${amt >= 1000 ? `${amt / 1000}K` : amt}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-slate-500 text-xs text-center">
              Skip budget to set per-stock quantity on the next screen
            </p>
          </div>

          {/* Generate button — pinned to bottom */}
          <div className="flex-shrink-0 px-5 pb-8 pt-4 border-t border-slate-800">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-4 rounded-2xl text-base transition-all flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Scoring stocks...
                </>
              ) : (
                `Generate ${themeData?.emoji} Basket`
              )}
            </button>
            <p className="text-slate-600 text-xs text-center mt-2">
              Uses 1 deep analysis
            </p>
          </div>
        </>
      )}

      {/* STEP: Custom basket */}
      {step === 'custom' && (
        <>
          <div className="flex-1 overflow-y-auto px-5 pt-6">
            <div className="bg-slate-800 rounded-2xl p-4 mb-3 border border-slate-700">
              <p className="text-slate-400 text-xs mb-2">Basket name</p>
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="e.g. Water Infrastructure"
                className="bg-transparent text-white text-lg font-medium w-full outline-none placeholder-slate-600"
                autoFocus
              />
            </div>

            <div className="bg-slate-800 rounded-2xl p-4 mb-3 border border-slate-700">
              <p className="text-slate-400 text-xs mb-2">What do you want to invest in?</p>
              <textarea
                value={customDesc}
                onChange={e => setCustomDesc(e.target.value)}
                placeholder="e.g. Companies building water infrastructure, treatment, and distribution"
                className="bg-transparent text-white text-sm w-full outline-none placeholder-slate-600 resize-none leading-relaxed"
                rows={3}
              />
            </div>

            <div className="bg-slate-800 rounded-2xl p-4 mb-3 border border-slate-700">
              <p className="text-slate-400 text-xs mb-2">Budget (optional)</p>
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-xl">$</span>
                <input
                  type="number"
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                  placeholder="0"
                  className="bg-transparent text-white text-2xl font-semibold flex-1 outline-none placeholder-slate-600"
                />
              </div>
            </div>
          </div>

          {/* Generate button — pinned */}
          <div className="flex-shrink-0 px-5 pb-8 pt-4 border-t border-slate-800">
            <button
              onClick={handleGenerateCustom}
              disabled={!customName.trim() || !customDesc.trim() || isGenerating}
              className="w-full bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-4 rounded-2xl text-base transition flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <CompassIcon size={18} color="white" animated={true} />
                  Scoring stocks...
                </>
              ) : (
                '✏️ Generate Custom Basket →'
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
