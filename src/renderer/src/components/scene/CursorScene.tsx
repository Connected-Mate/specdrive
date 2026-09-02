import React, { useEffect, useMemo, useRef } from 'react'
import { FlyingCursors, type CursorDef, type SceneVariant } from './cursors'
import { FrostedWord } from './FrostedWord'

// The multiplayer moment: a frosted-glass title with the AI crew's cursors
// flying around it, while spec chips write themselves into the space.
//
// 'hero'   — the full-size scene on an empty board (and the easter egg).
// 'header' — the slim permanent band on top of every project screen, where the
//            cursors are the agents really working on this project.

const AGENTS: CursorDef[] = [
  { name: 'Interview agent', color: '#4a7ff2' },
  { name: 'Challenge agent', color: '#7b7ed8' },
  { name: 'Research agent', color: '#c98ab5' },
  { name: 'Design agent', color: '#e8a87c' },
  { name: 'Build agent', color: '#007aff' }
]

const DEFAULT_CHIPS = [
  'Vision — why this exists',
  'Who it’s for',
  'What it does',
  'Look & feel',
  'Under the hood',
  'Hard parts — ranked',
  'Screen flow',
  'Build plan — step by step'
]

/** Slots around the word, in % of the scene box. Tuned to ring the center. */
const CHIP_SLOTS: { x: number; y: number; tilt: number }[] = [
  { x: 12, y: 16, tilt: -1.4 },
  { x: 66, y: 11, tilt: 1 },
  { x: 76, y: 70, tilt: -0.8 },
  { x: 8, y: 66, tilt: 1.2 },
  { x: 38, y: 82, tilt: -1 },
  { x: 84, y: 36, tilt: 1.6 },
  { x: 26, y: 8, tilt: 0.8 },
  { x: 56, y: 76, tilt: -1.6 }
]

/** The cursor to send beside the name, and what it just did. `nonce` changes
 *  on every new real action so the same summary can fire twice. */
export interface SceneSpotlight {
  key: string
  text: string
  nonce: number
}

export function CursorScene({
  word,
  chips,
  compact = false,
  variant = 'hero',
  agents,
  caption,
  spotlight
}: {
  word: string
  /** Spec titles floating around; defaults to the canonical board topics */
  chips?: string[]
  compact?: boolean
  variant?: SceneVariant
  /** Real agents to draw. Omitted → the decorative crew (hero scene only). */
  agents?: CursorDef[]
  /** One plain line under the name, header variant only */
  caption?: React.ReactNode
  spotlight?: SceneSpotlight
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<FlyingCursors | null>(null)
  const header = variant === 'header'

  // Rebuild only when the cast really changes — not on every activity tick.
  const cast = useMemo<CursorDef[]>(
    () => agents ?? (compact ? AGENTS.slice(0, 3) : AGENTS),
    [agents, compact]
  )
  const castKey = cast.map((c) => `${c.key ?? c.name}:${c.color}:${c.muted ? 'm' : ''}`).join('|')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!cast.length) return
    const engine = new FlyingCursors(host, cast, variant)
    engineRef.current = engine
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) {
      // Static positions, no drifting and no darting — the scene still reads.
      engine.renderStatic()
    } else {
      engine.start()
    }
    const onVis = (): void => {
      if (still) return
      if (document.hidden) engine.stop()
      else engine.start()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      engine.destroy()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castKey, variant])

  // A real action just landed: that agent's cursor darts beside the name.
  useEffect(() => {
    if (!spotlight) return
    engineRef.current?.spotlight(spotlight.key, spotlight.text)
  }, [spotlight?.key, spotlight?.text, spotlight?.nonce])

  const shown = useMemo(() => {
    if (header) return []
    const list = (chips && chips.length ? chips : DEFAULT_CHIPS).slice(0, CHIP_SLOTS.length)
    return list.map((text, i) => ({ text, slot: CHIP_SLOTS[i], i }))
  }, [chips, header])

  return (
    <div
      ref={hostRef}
      className={`cursor-scene${compact ? ' compact' : ''}${header ? ' header' : ''}`}
    >
      {shown.map(({ text, slot, i }) => (
        <span
          key={`${i}-${text}`}
          className="spec-chip"
          style={
            {
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              '--tilt': `${slot.tilt}deg`,
              '--chip-delay': `${i * 1.1}s`
            } as React.CSSProperties
          }
        >
          <span className="spec-chip-dot" />
          {text}
        </span>
      ))}
      <div className="cursor-scene-word">
        {header ? (
          <>
            <h1 className="scene-title">
              <FrostedWord>{word}</FrostedWord>
            </h1>
            {caption && <span className="scene-caption">{caption}</span>}
          </>
        ) : (
          <FrostedWord>{word}</FrostedWord>
        )}
      </div>
    </div>
  )
}
