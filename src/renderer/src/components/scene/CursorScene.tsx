import React, { useEffect, useMemo, useRef } from 'react'
import { FlyingCursors, type CursorDef } from './cursors'
import { FrostedWord } from './FrostedWord'

// The multiplayer moment: a frosted-glass title with the AI crew's cursors
// flying around it, while spec chips write themselves into the space.

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

export function CursorScene({
  word,
  chips,
  compact = false
}: {
  word: string
  /** Spec titles floating around; defaults to the canonical board topics */
  chips?: string[]
  compact?: boolean
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const agents = compact ? AGENTS.slice(0, 3) : AGENTS
    const engine = new FlyingCursors(host, agents)
    engine.start()
    const onVis = (): void => {
      if (document.hidden) engine.stop()
      else engine.start()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      engine.destroy()
    }
  }, [compact])

  const shown = useMemo(() => {
    const list = (chips && chips.length ? chips : DEFAULT_CHIPS).slice(0, CHIP_SLOTS.length)
    return list.map((text, i) => ({ text, slot: CHIP_SLOTS[i], i }))
  }, [chips])

  return (
    <div ref={hostRef} className={`cursor-scene${compact ? ' compact' : ''}`}>
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
        <FrostedWord>{word}</FrostedWord>
      </div>
    </div>
  )
}
