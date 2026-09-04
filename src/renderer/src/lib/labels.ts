import type { FolderRule, RequiredArea, Spec, SpecCategory } from '@shared/types'

// Plain-words labels shared by the board, the memory panel and the detail view.

export const CATEGORY_LABEL: Record<SpecCategory, string> = {
  vision: 'Vision',
  audience: 'Who it’s for',
  features: 'What it does',
  design: 'Look & feel',
  tech: 'Under the hood',
  data: 'Data',
  research: 'Research',
  risks: 'Hard parts',
  business: 'Business & money',
  decisions: 'Decisions'
}

/** One dusk hue per section of the board — the same family as the phases,
 *  so a board and its guide rail read as one system. */
export const CATEGORY_COLOR: Record<SpecCategory, string> = {
  vision: '#4a7ff2',
  audience: '#7b7ed8',
  features: '#007aff',
  design: '#e8a87c',
  tech: '#2f3338',
  data: '#5e8f84',
  research: '#c98ab5',
  risks: '#d98d63',
  business: '#2c9a63',
  decisions: '#636363'
}

/** "business-model" → "Business model & pricing". The agent may invent its own
 *  area slugs, so anything unknown is simply prettified. */
const AREA_LABEL: Record<string, string> = {
  'business-model': 'Business model & pricing',
  'platform-rules': 'Platform rules (App Store / Play)',
  'store-rules': 'Store rules & permissions',
  'backend-hosting': 'Backend & hosting',
  'auth-accounts': 'Accounts & sign-in',
  payments: 'Payments & billing',
  'legal-privacy': 'Legal & privacy',
  notifications: 'Notifications',
  'offline-sync': 'Working offline & syncing',
  'analytics-metrics': 'Analytics & success metrics',
  'support-ops': 'Support & running it day to day',
  'launch-distribution': 'Launch & distribution',
  accessibility: 'Accessibility',
  security: 'Security',
  'trust-safety': 'Trust, safety & moderation',
  'seo-discovery': 'Being found (search & discovery)',
  onboarding: 'First run & onboarding',
  'data-model': 'Data & storage',
  integrations: 'Integrations & third parties',
  localization: 'Languages & regions',
  'performance-cost': 'Speed & running costs',
  hardware: 'Hardware, firmware & manufacturing',
  'ai-behaviour': 'AI behaviour, prompts & guardrails',
  'ai-cost-limits': 'AI cost, rate limits & fallbacks',
  packaging: 'Packaging & releases',
  'game-economy': 'Game economy & progression',
  'inventory-logistics': 'Stock, shipping & returns',
  'two-sided-liquidity': 'Both sides of the marketplace',
  'internal-access': 'Who inside can see what',
  'backup-recovery': 'Backups & recovery',
  'content-pipeline': 'Where the content comes from',
  'api-contract': 'The public interface others build on',
  'rate-limits': 'Quotas, rate limits & abuse',
  'device-testing': 'Testing on real devices',
  'app-review': 'Getting through store review',
  'browser-support': 'Browsers & devices supported',
  'migration-rollout': 'Rollout & migration of existing users'
}

export function areaLabel(area: string): string {
  if (AREA_LABEL[area]) return AREA_LABEL[area]
  const s = area.replace(/[-_]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : area
}

/** What the owner reads next to an area of the checklist. */
export const AREA_STATUS_LABEL: Record<RequiredArea['status'], string> = {
  empty: 'Nothing yet',
  partial: 'Started',
  covered: 'Covered',
  'n/a': 'Not needed'
}

export const STATUS_LABEL: Record<Spec['status'], string> = {
  draft: 'Draft',
  challenged: 'Stress-tested',
  confirmed: 'Confirmed'
}

export const TAG_LABEL: Record<string, string> = {
  discovery: 'Found while building',
  skip: 'Checks skipped — see why',
  'as-built': 'How it works today'
}

/** "4 min", "1h 12min", "under a min" — subtle, data not decoration. */
export function humanizeDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 1) return 'under a min'
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m ? `${h}h ${m}min` : `${h}h`
}

/** "set by Claude Code · Sep 2 · owner approved ✓" — muted provenance line
 *  under a house rule. Empty string when the rule predates provenance tracking. */
export function ruleProvenance(r: FolderRule): string {
  const bits: string[] = []
  if (r.setBy) bits.push(`set by ${r.setBy === 'owner' ? 'the owner' : r.setBy.slice('agent:'.length)}`)
  if (r.setAt) {
    const d = new Date(r.setAt)
    if (!Number.isNaN(d.getTime())) {
      bits.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
    }
  }
  if (r.setBy && r.setBy !== 'owner') bits.push(r.confirmedByOwner ? 'owner approved ✓' : 'awaiting owner approval')
  if (r.supersedes) bits.push(`replaces "${r.supersedes}"`)
  return bits.join(' · ')
}

/** Markdown body → the first plain sentence, for a collapsed card. */
export function firstSentence(markdown: string, max = 150): string {
  // The opening line of the body, not the opening line plus half a list item.
  const opening =
    markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .split('\n')
      .map((l) => l.replace(/^\s*(#{1,6}|[-*+]|\d+\.)\s*/, '').trim())
      .find((l) => l.length > 0) ?? ''
  const flat = opening
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return ''
  const stop = flat.search(/[.!?](\s|$)/)
  const cut = stop > 20 ? flat.slice(0, stop + 1) : flat
  return cut.length > max ? `${cut.slice(0, max).trimEnd()}…` : cut
}
