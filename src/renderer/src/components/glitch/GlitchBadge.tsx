import React, { useEffect, useRef } from 'react'
import { GlitchWord, IDLE } from './engine'

const LAYERS = 8

/** The connection indicator: a word on a green badge tearing itself apart —
 *  the reference glitch design, compact. Runs while an agent session is live. */
export function GlitchBadge({ word }: { word: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const base = host.querySelector<HTMLElement>('[data-glitch-base]')
    const layers = Array.from(host.querySelectorAll<HTMLElement>('[data-glitch-layer]'))
    if (!base) return
    const engine = new GlitchWord(base, layers, word, reduced)
    engine.setOptions(IDLE)

    // Calm at rest — the tear only runs while the pointer hovers it.
    let hovered = false
    let hidden = false
    const sync = (): void => {
      if (hovered && !hidden) engine.start()
      else engine.stop()
    }
    const onEnter = (): void => {
      hovered = true
      sync()
    }
    const onLeave = (): void => {
      hovered = false
      sync()
    }
    host.addEventListener('pointerenter', onEnter)
    host.addEventListener('pointerleave', onLeave)
    const onVis = (): void => {
      hidden = document.hidden
      sync()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      host.removeEventListener('pointerenter', onEnter)
      host.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVis)
      engine.destroy()
    }
  }, [word])

  return (
    <div ref={hostRef} className="glitch-host" role="img" aria-label={`${word} is live`}>
      <span data-glitch-magnet className="glitch-magnet">
        <span className="glitch-grid">
          {/* invisible resting copy pins the badge width during scramble */}
          <span aria-hidden className="glitch-cell glitch-text invisible-anchor">
            {word}
          </span>
          <span data-glitch-base className="glitch-cell glitch-unit">
            <span data-glitch-badge className="gw-badge" />
            <span data-glitch-text className="glitch-text">
              {word}
            </span>
          </span>
          {Array.from({ length: LAYERS }).map((_, i) => (
            <span
              key={i}
              data-glitch-layer
              aria-hidden
              style={{ opacity: 0 }}
              className="glitch-cell glitch-unit"
            >
              <span className="gw-badge" style={{ animationDelay: `${-(i * 2.4).toFixed(1)}s` }} />
              <span data-glitch-text className="glitch-text">
                {word}
              </span>
            </span>
          ))}
        </span>
      </span>
    </div>
  )
}
