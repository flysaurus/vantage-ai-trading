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
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={reset} />

      {/* Bottom sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 rounded-t-3xl border-t border-slate-700 flex flex-col max-h-[82vh]">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            {step !== 'theme' && (
              <button onClick={() => setStep('theme')} className="text-slate-400 text-lg mr-1">←</button>
            )}
            <div>
              <h2 className="text-white font-semibold text-lg">
                {step === 'theme' ? '🧺 Build a Basket' : step === 'custom' ? '✏️ Custom Basket' : `${themeData?.emoji} ${themeData?.name}`}
              </h2>
              <p className="text-slate-400 text-xs">
                {step === 'theme' ? 'AI scores and ranks stocks for your style' : step === 'custom' ? 'Describe what you want to invest in' : 'Set your budget'}
              </p>
            </div>
          </div>
          <button onClick={reset} className="text-slate-500 text-2xl w-8 h-8 flex items-center justify-center">×</button>
        </div>

        {/* STEP: Theme selection */}
        {step === 'theme' && (
          <div className="flex-1 overflow-y-auto px-5 pt-2 pb-6">
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map(theme => (
                <button
                  key={theme.key}
                  onClick={() => { setSelectedTheme(theme.key); setStep('budget'); }}
                  className="flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-cyan-500/50 rounded-xl p-3 text-left transition-all"
                >
                  <span className="text-2xl flex-shrink-0">{theme.emoji}</span>
                  <p className="text-white text-sm font-medium leading-tight">{theme.name}</p>
                </button>
              ))}

              {/* Custom — full width */}
              <button
                onClick={() => setStep('custom')}
                className="col-span-2 flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-cyan-500/50 rounded-xl p-3 text-left transition-all"
              >
                <span className="text-2xl flex-shrink-0">✏️</span>
                <p className="text-white text-sm font-medium">Custom Basket</p>
              </button>
            </div>
          </div>
        )}

        {/* STEP: Budget */}
        {step === 'budget' && (
          <>
            <div className="flex-1 overflow-y-auto px-5 pt-2">
              {/* Budget input */}
              <div className="bg-slate-800 rounded-2xl p-4 mb-3">
                <p className="text-slate-400 text-xs mb-2">Budget (optional)</p>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 text-2xl">$</span>
                  <input
                    type="number"
                    value={budget}
                    onChange={e => setBudget(e.target.value)}
                    placeholder="0"
                    className="bg-transparent text-white text-3xl font-semibold flex-1 outline-none placeholder-slate-600"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  {[1000, 5000, 10000, 25000].map(amt => (
                    <button
                      key={amt}
                      onClick={() => setBudget(String(amt))}
                      className={`flex-1 py-2 rounded-xl text-xs font-medium transition ${budget === String(amt) ? 'bg-cyan-500 text-white' : 'bg-slate-700 text-slate-300'}`}
                    >
                      ${amt >= 1000 ? `${amt / 1000}K` : amt}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-slate-500 text-xs text-center mb-4">
                AI scores stocks for your Growth-Style mandate
              </p>
            </div>

            {/* Generate button — pinned */}
            <div className="flex-shrink-0 px-5 pb-8 pt-3 border-t border-slate-800 bg-slate-900">
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-4 rounded-2xl text-base transition flex items-center justify-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <CompassIcon size={18} color="white" animated={true} />
                    Scoring stocks...
                  </>
                ) : (
                  `Generate ${themeData?.emoji} Basket →`
                )}
              </button>
              <p className="text-slate-600 text-xs text-center mt-2">Uses 1 deep analysis</p>
            </div>
          </>
        )}

        {/* STEP: Custom basket */}
        {step === 'custom' && (
          <>
            <div className="flex-1 overflow-y-auto px-5 pt-2">
              <div className="bg-slate-800 rounded-2xl p-4 mb-3">
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

              <div className="bg-slate-800 rounded-2xl p-4 mb-3">
                <p className="text-slate-400 text-xs mb-2">What do you want to invest in?</p>
                <textarea
                  value={customDesc}
                  onChange={e => setCustomDesc(e.target.value)}
                  placeholder="e.g. Companies building water infrastructure, treatment, and distribution"
                  className="bg-transparent text-white text-sm w-full outline-none placeholder-slate-600 resize-none leading-relaxed"
                  rows={3}
                />
              </div>

              <div className="bg-slate-800 rounded-2xl p-4 mb-3">
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
            <div className="flex-shrink-0 px-5 pb-8 pt-3 border-t border-slate-800 bg-slate-900">
              <button
                onClick={handleGenerateCustom}
                disabled={!customName.trim() || !customDesc.trim() || isGenerating}
                className="w-full bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-4 rounded-2xl text-base transition flex items-center justify-center gap-2"
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
    </>
  );
}
