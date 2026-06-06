'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Compass as CompassIcon } from 'lucide-react'

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

type Step = 'theme' | 'budget' | 'custom_input'

interface BuildBasketModalProps {
  isOpen: boolean
  onClose: () => void
  onBasketGenerated: (message: string, data: any) => void
}

export default function BuildBasketModal({ isOpen, onClose, onBasketGenerated }: BuildBasketModalProps) {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null)
  const [budget, setBudget] = useState<string>('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [step, setStep] = useState<Step>('theme')
  const [customName, setCustomName] = useState('')
  const [customDesc, setCustomDesc] = useState('')
  const router = useRouter()

  if (!isOpen) return null

  function handleThemeSelect(key: string) {
    if (key === 'custom') {
      setSelectedTheme('custom')
      setStep('custom_input')
      return
    }
    setSelectedTheme(key)
    setStep('budget')
  }
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

  async function handleGenerateCustom() {
    if (!customName.trim() || !customDesc.trim()) return
    setIsGenerating(true)

    const message = `Build me a custom basket called "${customName}". Focus on: ${customDesc}`

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, mode: 'theme', responseMode: 'detailed' })
      })
      const data = await res.json()
      onClose()
      onBasketGenerated(message, data)
    } catch (err) {
      console.error('Custom basket error:', err)
    } finally {
      setIsGenerating(false)
    }
  }

  const selectedThemeData = THEMES.find(t => t.key === selectedTheme)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 rounded-t-3xl border-t border-slate-700 flex flex-col max-h-[80vh]">

        {/* Handle bar — fixed */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-600" />
        </div>

        {/* Header — fixed */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-2">
            {(step === 'budget' || step === 'custom_input') && (
              <button onClick={handleBack} className="text-slate-400 mr-1 text-lg">←</button>
            )}
            <div>
              <h2 className="text-white font-semibold text-lg">
                {step === 'theme' ? '🧺 Build a Basket' : step === 'custom_input' ? '✏️ Custom Basket' : `${selectedThemeData?.emoji} ${selectedThemeData?.name}`}
              </h2>
              <p className="text-slate-400 text-xs">
                {step === 'theme' ? 'AI scores and ranks stocks for your style' : step === 'custom_input' ? 'Describe what you want to invest in' : selectedThemeData?.desc}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 text-2xl leading-none w-8 h-8 flex items-center justify-center">×</button>
        </div>

        {/* ── THEME STEP: scrollable grid ── */}
        {step === 'theme' && (
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6">
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map(theme => (
                <button
                  key={theme.key}
                  onClick={() => handleThemeSelect(theme.key)}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-cyan-500/50 rounded-xl p-3 text-left transition-all"
                >
                  <span className="text-xl flex-shrink-0">{theme.emoji}</span>
                  <p className="text-white text-sm font-medium leading-tight">
                    {theme.name}
                  </p>
                </button>
              ))}

              {/* Custom Basket — full width */}
              <button
                onClick={() => handleThemeSelect('custom')}
                className="col-span-2 flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-cyan-500/50 rounded-xl p-3 text-left transition-all"
              >
                <span className="text-xl">✏️</span>
                <p className="text-white text-sm font-medium">
                  Custom Basket
                </p>
              </button>
            </div>
          </div>
        )}

        {/* ── BUDGET STEP: scrollable content + pinned button ── */}
        {step === 'budget' && (
          <>
            <div className="flex-1 overflow-y-auto px-5 pt-4">
              {/* Budget input */}
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

              {/* Short AI description */}
              <p className="text-slate-500 text-xs text-center mb-4">
                AI scores stocks for your Growth-Style mandate
              </p>

              {/* Spacer so content doesn't clash with pinned button */}
              <div className="pb-32" />
            </div>

            {/* Generate button — ALWAYS VISIBLE, pinned to bottom */}
            <div className="flex-shrink-0 px-5 pb-8 pt-3 border-t border-slate-800 bg-slate-900">
              <button onClick={handleGenerate} disabled={isGenerating} className="w-full bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-4 rounded-2xl text-base transition flex items-center justify-center gap-2">
                {isGenerating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Scoring stocks...
                  </>
                ) : (
                  <>Generate {selectedThemeData?.emoji} Basket →</>
                )}
              </button>
              <p className="text-slate-600 text-xs text-center mt-2">Uses 1 deep analysis</p>
            </div>
          </>
        )}

        {/* ── CUSTOM INPUT STEP ── */}
        {step === 'custom_input' && (
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-8">
            {/* Basket name */}
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

            {/* Description */}
            <div className="bg-slate-800 rounded-2xl p-4 mb-4">
              <p className="text-slate-400 text-xs mb-2">What do you want to invest in?</p>
              <textarea
                value={customDesc}
                onChange={e => setCustomDesc(e.target.value)}
                placeholder="e.g. Companies building water infrastructure, treatment, and distribution technology"
                className="bg-transparent text-white text-sm w-full outline-none placeholder-slate-600 resize-none leading-relaxed"
                rows={3}
              />
            </div>

            {/* Budget */}
            <div className="bg-slate-800 rounded-2xl p-4 mb-5">
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

            <button
              onClick={handleGenerateCustom}
              disabled={!customName.trim() || !customDesc.trim() || isGenerating}
              className="w-full bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold py-4 rounded-2xl text-base transition flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <CompassIcon size={18} color="white" />
                  Scoring stocks...
                </>
              ) : (
                '✏️ Generate Custom Basket →'
              )}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
