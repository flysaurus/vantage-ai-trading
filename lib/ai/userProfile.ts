// ─── User Profile Context Builder ────────────────────────────
// Builds investor-style-aware context for injection into all AI prompts.
// Every AI response must reflect the user's chosen style and risk tolerance.

export interface UserProfile {
  investorStyle: 'Lynch' | 'Buffett' | 'Livermore' | 'Munger' | 'Soros'
  riskTolerance: 'Conservative' | 'Moderate' | 'Aggressive'
  name: string
}

export function getInvestorStylePrompt(
  style: UserProfile['investorStyle']
): string {
  const styles: Record<string, string> = {
    Lynch: `Lynch lens: Find growth before Wall Street does. You look for companies with strong earnings growth trading at reasonable P/E ratios. Your questions: Is the story still intact? Is this price reasonable for the growth rate? Would a normal person understand this business? Red flag language: 'broken story', 'thesis changed', 'priced for perfection'. Green flag language: 'earnings acceleration', 'reasonable multiple', 'they get it right'.`,

    Buffett: `Buffett lens: Wonderful companies at fair prices. You look for durable moats, pricing power, and management you'd trust with your wallet. Your questions: Can they raise prices tomorrow? Will this business exist in 20 years? Would I hold this if markets closed for a decade? Red flag language: 'commodity business', 'no moat', 'margin compression'. Green flag language: 'pricing power', 'wide moat', 'compounding machine'.`,

    Livermore: `Livermore lens: Follow the tape, cut losers fast. You follow market leaders and price momentum. Your questions: Is this stock acting right? Is it leading or lagging the market? Where's my exit if I'm wrong? Red flag language: 'lagging peers', 'volume drying up', 'distribution'. Green flag language: 'market leader', 'breaking out on volume', 'relative strength'.`,

    Munger: `Munger lens: Extraordinary businesses, full stop. You concentrate in your highest conviction ideas and wait for the fat pitch. Your questions: Is this truly a great business? What's the switching cost for customers? Would I be happy owning this forever? Red flag language: 'mediocre business', 'capital intensive', 'low returns on equity'. Green flag language: 'inevitable', 'compounding flywheel', 'invert the risk'.`,

    Soros: `Soros lens: Find the macro dislocation. You identify reflexive feedback loops and asymmetric bets where the market is wrong. Your questions: What narrative is the market pricing in? Where is the bias? What breaks the consensus view? Red flag language: 'crowded trade', 'priced for perfection', 'consensus view'. Green flag language: 'reflexive', 'dislocation', 'asymmetric', 'narrative shift'.`,
  }
  return styles[style] || styles.Lynch
}

export function getRiskTolerancePrompt(
  risk: UserProfile['riskTolerance']
): string {
  const risks: Record<string, string> = {
    Conservative: `Risk tolerance: CONSERVATIVE
- Prioritize capital preservation above all
- Flag any position with >15% loss immediately
- Emphasize diversification and position sizing
- Prefer dividend-paying, low-beta stocks
- Avoid speculative positions and high P/E names
- Recommend raising cash in uncertain markets`,

    Moderate: `Risk tolerance: MODERATE
- Balance growth and capital preservation
- Accept 20-25% drawdowns on individual positions
- Maintain diversification across sectors
- Allow some speculative positions (<15% of portfolio)
- Focus on risk-adjusted returns`,

    Aggressive: `Risk tolerance: AGGRESSIVE
- Prioritize maximum long-term returns
- Accept high volatility for high upside
- Concentration in highest-conviction ideas is fine
- Speculative positions acceptable
- Focus on absolute returns over benchmark`,
  }
  return risks[risk] || risks.Moderate
}

export function buildUserProfileContext(
  profile: UserProfile
): string {
  return `
USER INVESTMENT PROFILE:
Name: ${profile.name}
Investor Style: ${profile.investorStyle}
Risk Tolerance: ${profile.riskTolerance}

${getInvestorStylePrompt(profile.investorStyle)}

${getRiskTolerancePrompt(profile.riskTolerance)}

Apply this profile to EVERY recommendation.
Filter all analysis through this lens.
Reference the style explicitly when relevant:
"As a ${profile.investorStyle}-style investor..."
`
}
