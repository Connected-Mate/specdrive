import React, { useMemo } from 'react'
import type { Flow } from '@shared/types'

// Hand-rolled screen-flow map: screens as nodes in left-to-right layers,
// user actions as labeled arrows. No graph library — small, offline, ours.

const NODE_W = 172
const COL_GAP = 92
const ROW_GAP = 26
const PAD = 24
const THUMB_H = 74

interface Node {
  id: string
  name: string
  purpose?: string
  x: number
  y: number
  hasSketch: boolean
  entry: boolean
}

function layout(
  flow: Flow,
  sketchScreens: Set<string>,
  NODE_H: number
): { nodes: Node[]; w: number; h: number } {
  const ids = flow.screens.map((s) => s.id)
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const l of flow.links) incoming.set(l.to, (incoming.get(l.to) ?? 0) + 1)

  // Longest-path layering, bounded to avoid cycles spinning.
  const depth = new Map<string, number>(ids.map((id) => [id, 0]))
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false
    for (const l of flow.links) {
      const d = (depth.get(l.from) ?? 0) + 1
      if (d > (depth.get(l.to) ?? 0) && d < ids.length) {
        depth.set(l.to, d)
        changed = true
      }
    }
    if (!changed) break
  }

  const cols = new Map<number, string[]>()
  for (const id of ids) {
    const d = depth.get(id) ?? 0
    cols.set(d, [...(cols.get(d) ?? []), id])
  }
  const maxDepth = Math.max(...cols.keys())
  const tallest = Math.max(...[...cols.values()].map((c) => c.length))
  const H = PAD * 2 + tallest * NODE_H + (tallest - 1) * ROW_GAP

  const nodes: Node[] = []
  for (const [d, colIds] of cols) {
    const colH = colIds.length * NODE_H + (colIds.length - 1) * ROW_GAP
    const y0 = (H - colH) / 2
    colIds.forEach((id, i) => {
      const s = flow.screens.find((sc) => sc.id === id)!
      nodes.push({
        id,
        name: s.name,
        purpose: s.purpose,
        x: PAD + d * (NODE_W + COL_GAP),
        y: y0 + i * (NODE_H + ROW_GAP),
        hasSketch: sketchScreens.has(s.name.toLowerCase()),
        entry: Boolean(s.entry)
      })
    })
  }
  return { nodes, w: PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP, h: H }
}

export function FlowMap({
  flow,
  sketchScreens,
  thumbs,
  onOpenScreen
}: {
  flow: Flow
  sketchScreens: Set<string>
  /** screen name (lowercase) → data-url of its wireframe, for in-node thumbnails */
  thumbs: Record<string, string>
  onOpenScreen: (screenName: string) => void
}): React.JSX.Element {
  const anyThumb = flow.screens.some((s) => thumbs[s.name.toLowerCase()])
  const NODE_H = anyThumb ? 64 + THUMB_H : 64
  const { nodes, w, h } = useMemo(
    () => layout(flow, sketchScreens, NODE_H),
    [flow, sketchScreens, NODE_H]
  )
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  return (
    <div className="flowmap-scroll">
      <svg className="flowmap" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0.5 0.8 7 4 0.5 7.2Z" fill="#9a9a9a" />
          </marker>
        </defs>
        {flow.links.map((l, i) => {
          const a = byId.get(l.from)
          const b = byId.get(l.to)
          if (!a || !b) return null
          const forward = b.x > a.x
          const x1 = forward ? a.x + NODE_W : a.x
          const y1 = a.y + NODE_H / 2
          const x2 = forward ? b.x - 4 : b.x + NODE_W + 4
          const y2 = b.y + NODE_H / 2
          const dx = Math.max(36, Math.abs(x2 - x1) / 2)
          const c1x = forward ? x1 + dx : x1 - dx
          const c2x = forward ? x2 - dx : x2 + dx
          const mx = (x1 + x2) / 2
          const my = (y1 + y2) / 2 - 9
          const alt = Boolean(l.condition)
          return (
            <g key={i} opacity={alt ? 0.75 : 1}>
              <path
                d={`M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="#c9c9c9"
                strokeWidth="1.5"
                strokeDasharray={alt ? '5 4' : undefined}
                markerEnd="url(#arrow)"
              />
              {alt && !l.label && (
                <text x={mx} y={my + 3} textAnchor="middle" className="flow-label flow-cond">
                  {l.condition}
                </text>
              )}
              {l.label &&
                (() => {
                  const txt = l.condition ? `${l.label} — ${l.condition}` : l.label
                  return (
                    <g>
                      <rect
                        x={mx - txt.length * 2.9 - 7}
                        y={my - 9}
                        width={txt.length * 5.8 + 14}
                        height={17}
                        rx={8.5}
                        fill="#f7f7f7"
                        stroke="rgba(0,0,0,0.07)"
                      />
                      <text x={mx} y={my + 3} textAnchor="middle" className="flow-label">
                        {txt}
                      </text>
                    </g>
                  )
                })()}
            </g>
          )
        })}
        {nodes.map((n, i) => {
          const thumb = thumbs[n.name.toLowerCase()]
          const textTop = thumb ? THUMB_H : 0
          return (
            <g
              key={n.id}
              className={`flow-node${n.hasSketch ? ' clickable' : ''}`}
              transform={`translate(${n.x}, ${n.y})`}
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => n.hasSketch && onOpenScreen(n.name)}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={16}
                className={`flow-node-bg${n.entry ? ' entry' : ''}`}
              />
              {n.entry && (
                <g transform={`translate(10, 10)`}>
                  <rect width={40} height={17} rx={8.5} fill="#007aff" />
                  <text x={20} y={12} textAnchor="middle" className="flow-start-badge">
                    Start
                  </text>
                </g>
              )}
              {thumb && (
                <>
                  <clipPath id={`thumb-${n.id}`}>
                    <path
                      d={`M 0 16 Q 0 0 16 0 L ${NODE_W - 16} 0 Q ${NODE_W} 0 ${NODE_W} 16 L ${NODE_W} ${THUMB_H} L 0 ${THUMB_H} Z`}
                    />
                  </clipPath>
                  <g clipPath={`url(#thumb-${n.id})`}>
                    <foreignObject width={NODE_W} height={THUMB_H}>
                      <iframe
                        sandbox=""
                        src={thumb}
                        tabIndex={-1}
                        style={{
                          width: NODE_W * 2.6,
                          height: THUMB_H * 2.6 + 90,
                          transform: 'scale(0.385)',
                          transformOrigin: 'top left',
                          border: 'none',
                          background: '#fff',
                          pointerEvents: 'none'
                        }}
                      />
                    </foreignObject>
                    <rect width={NODE_W} height={THUMB_H} fill="transparent" stroke="rgba(0,0,0,0.06)" />
                  </g>
                </>
              )}
              <text x={16} y={textTop + (n.purpose ? 27 : 37)} className="flow-name">
                {n.name.length > 20 ? n.name.slice(0, 19) + '…' : n.name}
              </text>
              {n.purpose && (
                <text x={16} y={textTop + 45} className="flow-purpose">
                  {n.purpose.length > 26 ? n.purpose.slice(0, 25) + '…' : n.purpose}
                </text>
              )}
              {n.hasSketch && (
                <circle cx={NODE_W - 14} cy={textTop + 14} r={3.5} className="flow-sketch-dot" />
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
