import React from 'react'

// A word rendered as frosted glass: sharp copy fading out toward the bottom,
// blurred copy fading the other way, chromatic twins, top sheen, and a rounded
// glass-chip overlay with layered inset shadows. Tilted a hair.

export function FrostedWord({ children }: { children: React.ReactNode }): React.JSX.Element {
  const mask = (dir: string): React.CSSProperties => ({
    maskImage: dir,
    WebkitMaskImage: dir
  })
  return (
    <span className="frosted-word">
      <span aria-hidden className="frosted-halo" />
      <span className="frosted-stack">
        <span aria-hidden className="frosted-layer" style={{ filter: 'blur(9px)', opacity: 0.14 }}>
          {children}
        </span>
        <span
          aria-hidden
          className="frosted-layer"
          style={{
            transform: 'translate(-1.5px, 3px)',
            filter: 'blur(5px)',
            opacity: 0.16,
            ...mask('linear-gradient(186deg, transparent 20%, black 100%)')
          }}
        >
          {children}
        </span>
        <span
          className="frosted-sharp"
          style={mask('linear-gradient(186deg, black 0%, black 55%, transparent 108%)')}
        >
          {children}
        </span>
        <span
          aria-hidden
          className="frosted-layer"
          style={{
            filter: 'blur(2px)',
            ...mask('linear-gradient(186deg, transparent 0%, black 60%, black 100%)')
          }}
        >
          {children}
        </span>
        <span
          aria-hidden
          className="frosted-layer"
          style={{
            transform: 'translate(1.5px, 2px)',
            filter: 'blur(3.5px)',
            opacity: 0.28,
            ...mask('linear-gradient(186deg, transparent 30%, black 100%)')
          }}
        >
          {children}
        </span>
        <span
          aria-hidden
          className="frosted-layer frosted-sheen"
          style={mask('linear-gradient(180deg, black 0%, transparent 30%)')}
        >
          {children}
        </span>
        <span aria-hidden className="frosted-chip" />
        <span aria-hidden className="frosted-chip-sheen" />
      </span>
    </span>
  )
}
