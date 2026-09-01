import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectBundle } from '@shared/types'
import { clientLabel, useLiveSessions } from '@/lib/useLive'
import type { CursorDef } from './cursors'
import type { SceneSpotlight } from './CursorScene'

// Who is really around this project right now.
//
// Two honest sources, nothing invented:
//   • live MCP sessions on this machine, filtered to this project → solid cursors
//   • actors seen in the project's own activity log        → faded cursors
// If nobody has ever touched the project, nobody is drawn.

/** The dusk gradient, used as the crew's palette. */
const DUSK = ['#4a7ff2', '#7b7ed8', '#c98ab5', '#e8a87c', '#007aff']

/** Stable colour per client name, so Claude Code is always the same cursor. */
function colorFor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return DUSK[h % DUSK.length]
}

/** Plain words, short enough to read at a glance beside the name. */
function shorten(s: string, max = 40): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

/** How far back an activity entry still counts as "seen recently". */
const RECENT_ENTRIES = 40
/** On first render, only replay the last action if it just happened. */
const FRESH_MS = 120_000
const MAX_CURSORS = 5

export function useSceneAgents(bundle: ProjectBundle): {
  agents: CursorDef[]
  spotlight?: SceneSpotlight
} {
  const sessions = useLiveSessions()
  const { project, activity } = bundle

  const live = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.project === project.id ||
          (s.project ?? '').toLowerCase() === project.name.toLowerCase()
      ),
    [sessions, project.id, project.name]
  )

  const agents = useMemo<CursorDef[]>(() => {
    const out: CursorDef[] = []
    const seenLabels = new Map<string, number>()
    for (const s of live) {
      const base = clientLabel(s.client)
      const n = (seenLabels.get(base) ?? 0) + 1
      seenLabels.set(base, n)
      out.push({
        key: `live:${s.pid}`,
        name: n > 1 ? `${base} · ${n}` : base,
        color: colorFor(s.client),
        muted: false
      })
    }

    const recent = activity.slice(-RECENT_ENTRIES)
    // No live session but the board has been written to → the agent that wrote
    // it is still part of the crew, just not connected this second.
    if (!live.length && recent.some((a) => a.actor === 'agent')) {
      out.push({ key: 'agent', name: 'Your AI agent', color: '#7b7ed8', muted: true })
    }
    if (recent.some((a) => a.actor === 'app')) {
      out.push({ key: 'app', name: 'You', color: '#3e3e3e', muted: true })
    }
    return out.slice(0, MAX_CURSORS)
  }, [live, activity])

  // The last real action drives the most active cursor.
  const last = activity.length ? activity[activity.length - 1] : null
  const liveKey = live.map((s) => s.pid).join(',')
  const [spotlight, setSpotlight] = useState<SceneSpotlight>()
  const lastSeen = useRef<string | null>(null)
  const nonce = useRef(0)

  useEffect(() => {
    if (!last) return
    const stamp = `${last.ts}|${last.summary}`
    if (lastSeen.current === stamp) return
    const firstPass = lastSeen.current === null
    lastSeen.current = stamp
    // Don't replay ancient history the moment a project is opened.
    if (firstPass && Date.now() - new Date(last.ts).getTime() > FRESH_MS) return
    const key = last.actor === 'app' ? 'app' : live.length ? `live:${live[0].pid}` : 'agent'
    nonce.current += 1
    setSpotlight({ key, text: shorten(last.summary), nonce: nonce.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.ts, last?.summary, last?.actor, liveKey])

  // Opening another project starts from a clean slate.
  useEffect(() => {
    lastSeen.current = null
    setSpotlight(undefined)
  }, [project.id])

  return { agents, spotlight }
}
