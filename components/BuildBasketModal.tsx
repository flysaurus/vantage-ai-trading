'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const THEMES = [
  { key: 'ai_infrastructure', emoji: '🤖', name: 'AI Infrastructure', desc: 'NVDA, AMD, MSFT, data centers' },
  { key: 'clean_energy', emoji: '🌱', name: 'Clean Energy', desc: 'Solar, wind, EVs, grid tech' },
  { key: 'cybersecurity', emoji: '🛡️', name: 'Cybersecurity', desc: 'Zero trust, cloud security' },
  { key: 'healthcare_innovation', emoji: '🧬', name: 'Healthcare', desc: 'Biotech, medtech, genomics' },
  { key: 'dividend_aristocrats', emoji: '💰', name: 'Dividends', desc: 'Consistent yield, stable FCF' },
  { key: 'reshoring', emoji: '🏭', name: 'Reshoring', desc: 'US manufacturing, supply chain' },
  { key: 'fintech', emoji: '💳', name: 'Fintech', desc: 'Payments, lending, crypto infra' },
  { key: 'consumer_comeback', emoji: '🛍️', name: 'Consumer', desc: 'Retail, travel, discretionary' }
]

interface BuildBasketModalProps {
  isOpen: boolean
  onClose: () => void
  onBasketGenerated: (message: string, data: any) => void
}

export default function BuildBasketModal({ isOpen, onClose, onBasketGenerated }: BuildBasketModalProps) {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null)
  const [budget, setBudget] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [step, setStep] = useState<'theme' | 'budget'>('theme')
  const router = useRouter()

  if (!isOpen) return null

  function handleThemeSelect(key: string) { setSelectedTheme(key); setStep('budget') }
  function handleBack() { setStep('theme'); setSelectedTheme(null) }

  async function handleGenerate() {
    if (!selectedTheme) return
    setIsGenerating(true)
    const theme = THEMES.find(t => t.key === selectedTheme)
    const budgetText = budget ? ` with a $${parseInt(budget).toLocaleString()} budget` : ''
    const message = `Build me a ${theme?.name} basket${budgetText}`
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, mode: 'theme', responseMode: 'detailed' }) })
      const data = await res.json()
      onClose()
      onBasketGenerated(message, data)
    } catch (err) { console.error('Basket generation error:', err) }
    finally { setIsGenerating(false) }
  }

  const selectedThemeData = THEMES.find(t => t.key === selectedTheme)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 rounded-t-3xl border-t border-slate-700 max-h-[85vh] overflow-y-auto animate-slide-up">
        <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-slate-600" /></div>
        <div className="flex items-center justify-between px-5 pb-4">
          <div className="flex items-center gap-2">
            {step === 'budget' && (<button onClick={handleBack} className="text-slate-400 mr-1 text-lg">←</button>)}
            <div>
              <h2 className="text-white font-semibold text-lg">{step === 'theme' ? '🧺 Build a Basket' : `${selectedThemeData?.emoji} ${selectedThemeData?.name}`}</h2>
              <p className="text-slate-400 text-xs">{step === 'theme' ? 'AI scores and ranks stocks for your style' : selectedThemeData?.desc}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 text-2xl leading-none w-8 h-8 flex items-center justify-center">×</button>
        </div>
        {step === 'theme' && (
          <div className="px-5 pb-8">
            <div className="grid grid-cols-2 gap-3">
              {THEMES.map(theme => (
                <button key={theme.key} onClick={() => handleThemeSelect(theme.key)} className="flex flex-col items-start bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-cyan-500/50 rounded-2xl p-4 text-left transition-all">
                  <span className="text-2xl mb-2">{theme.emoji}</span>
                  <p className="text-white text-sm font-medium leading-tight mb-1">{theme.name}</p>
                  <p className="text-slate-400 text-xs leading-tight">{theme.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 'budget' && (
          <div className="px-5 pb-8">
            <div className="bg-slate-800 rounded-2xl p-4 mb-4">
              <p className="text-slate-400 text-xs mb-3">Budget (optional — you can set per-stock qty on the next screen)</p>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-2xl font-light">$</span>
                <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0" className="bg-transparent text-white text-3xl font-semibold flex-1 outline-none placeholder-slate-600" autoFocus />
              </div>
              <div className="flex gap-2 mt-4">
                {[1000, 5000, 10000, 25000].map(amt => (
                  <button key={amt} onClick={() => setBudget(String(amt))} className={`flex-1 py-2 rounded-xl text-xs font-medium transition ${budget === String(amt) ? 'bg-cyan-500 text-white' : 'bg-slate-700 text-slate-300'}`}>${amt >= 1000 ? `${amt/1000}K` : amt}</button>
                ))}
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-2xl p-4 mb-5 border border-slate-700/50">
              <p className="text-slate-400 text-xs leading-relaxed">🤖 Vantage AI will score stocks across fundamentals, technicals, sentiment, and analyst ratings — then rank them for your <span className="text-cyan-400">Growth-Style</span> mandate.</p>
            </div>
            <button onClick={handleGenerate} disabled={isGenerating} className="w-full bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-4 rounded-2xl text-base transition flex items-center justify-center gap-2">
              {isGenerating ? (<><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Scoring stocks...</>) : (<>Generate {selectedThemeData?.emoji} Basket →</>)}
            </button>
            <p className="text-slate-600 text-xs text-center mt-3">Uses 1 deep analysis (AI-powered)</p>
          </div>
        )}
      </div>
    </>
  )
}
