// ─── Public Share Page ──────────────────────────────────────
// Renders a standalone investor style result page for sharing.
// No auth required, no quiz redirect. Reads style + name from
// URL search params. Falls back cleanly for invalid/missing data.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SharePageClient } from './SharePageClient';
import { INVESTOR_STYLES, type InvestorStyleKey, ALL_STYLE_KEYS } from '@/lib/content/investor-styles';

// ─── Metadata ─────────────────────────────────────────────────

type Props = { searchParams: Promise<{ style?: string; name?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { style, name } = await searchParams;
  const key = (style as InvestorStyleKey) || '';
  const valid = ALL_STYLE_KEYS.includes(key);
  const content = valid ? INVESTOR_STYLES[key] : null;

  const displayName = name || '';
  const headline = content
    ? (displayName ? `${displayName} is ${content.fullHeadline}` : `Someone is ${content.fullHeadline}`)
    : 'Discover your investing style';
  const description = content
    ? content.description.slice(0, 150) + (content.description.length > 150 ? '…' : '')
    : 'Find out which investing personality matches how you think about money, risk, and opportunity.';

  const ogTitle = `${headline} · Vantage`;

  return {
    title: ogTitle,
    description,
    openGraph: {
      title: ogTitle,
      description,
      images: valid ? [`/og/${key}.png`] : ['/og/buffett.png'],
      url: `https://vantage-ai-trading.vercel.app/share?style=${key}` + (name ? `&name=${encodeURIComponent(name)}` : ''),
    },
    twitter: {
      card: 'summary_large_image',
      images: valid ? [`/og/${key}.png`] : ['/og/buffett.png'],
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────

export default async function SharePage({ searchParams }: Props) {
  const { style, name } = await searchParams;

  // Guard: missing or invalid style → redirect to home
  if (!style || !ALL_STYLE_KEYS.includes(style as InvestorStyleKey)) {
    redirect('/');
  }

  const key = style as InvestorStyleKey;

  return <SharePageClient styleKey={key} name={name || ''} />;
}
