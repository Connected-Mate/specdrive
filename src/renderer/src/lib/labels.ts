import type { FolderRule, Spec, SpecCategory } from '@shared/types'

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
  decisions: 'Decisions'
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
