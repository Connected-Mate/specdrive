import React, { useMemo } from 'react'
import type { Flow } from '@shared/types'
import { KitWireframe } from './wireframe-kit/KitWireframe'
import type { PlanWireframeNode } from './wireframe-kit/types'

export type FlowThumb =
  | { kind: 'html'; url: string }
  | { kind: 'kit'; nodes: PlanWireframeNode[] }

// The visual plan: screens as little device cards (wireframe inside, name
// below), user actions as labeled arrows. Longest-path layering, left to
// right, scaled to fit the pane — no graph library, no horizontal scroll.

const NODE_W = 240
const THUMB_H = 168
const LABEL_H = 54
const NODE_H = THUMB_H + LABEL_H
const COL_GAP = 120
const ROW_GAP = 36
const PAD = 34

interface Node {
  id: string
  name: string
  purpose?: string
  x: number
  y: number
  hasSketch: boolean
  entry: boolean
}

function layout(flow: Flow, sketchScreens: Set<string>): { nodes: Node[]; w: number; h: number } {
  const ids = flow.screens.map((s) => s.id)
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
  /** screen name (lowercase) → wireframe thumb (kit tree or legacy html url) */
  thumbs: Record<string, FlowThumb>
  onOpenScreen: (screenName: string) => void
}): React.JSX.Element {
  const { nodes, w, h } = useMemo(() => layout(flow, sketchScreens), [flow, sketchScreens])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  return (
    <div className="flowmap-card">
      <svg
        className="flowmap"
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: '100%', minWidth: `${Math.round(w * 0.9)}px`, height: 'auto', display: 'block' }}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
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
          const x2 = forward ? b.x - 5 : b.x + NODE_W + 5
          const y2 = b.y + NODE_H / 2
          const dx = Math.max(40, Math.abs(x2 - x1) / 2)
          const c1x = forward ? x1 + dx : x1 - dx
          const c2x = forward ? x2 - dx : x2 + dx
          const mx = (x1 + x2) / 2
          const my = (y1 + y2) / 2 - 10
          const alt = Boolean(l.condition)
          const txt = l.label ? (l.condition ? `${l.label} — ${l.condition}` : l.label) : l.condition
          return (
            <g
              key={i}
              opacity={alt ? 0.8 : 1}
              className="flow-edge"
              style={{ '--i': i } as React.CSSProperties}
            >
              <path
                d={`M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="#c4c4c4"
                strokeWidth="1.6"
                pathLength={alt ? undefined : 1}
                className={alt ? undefined : 'flow-edge-draw'}
                strokeDasharray={alt ? '6 5' : undefined}
                markerEnd="url(#arrow)"
              />
              {txt && (
                <g>
                  <rect
                    x={mx - txt.length * 3.1 - 8}
                    y={my - 10}
                    width={txt.length * 6.2 + 16}
                    height={19}
                    rx={9.5}
                    fill="#ffffff"
                    stroke="rgba(0,0,0,0.08)"
                  />
                  <text x={mx} y={my + 3.5} textAnchor="middle" className="flow-label">
                    {txt}
                  </text>
                </g>
              )}
            </g>
          )
        })}
        {nodes.map((n, i) => {
          const thumb = thumbs[n.name.toLowerCase()]
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
                rx={18}
                className={`flow-node-bg${n.entry ? ' entry' : ''}`}
              />
              <clipPath id={`thumb-${n.id}`}>
                <path
                  d={`M 0 18 Q 0 0 18 0 L ${NODE_W - 18} 0 Q ${NODE_W} 0 ${NODE_W} 18 L ${NODE_W} ${THUMB_H} L 0 ${THUMB_H} Z`}
                />
              </clipPath>
              <g clipPath={`url(#thumb-${n.id})`}>
                {thumb ? (
                  <foreignObject width={NODE_W} height={THUMB_H}>
                    {thumb.kind === 'kit' ? (
                      <div
                        style={{
                          width: NODE_W * 1.8,
                          height: THUMB_H * 1.8,
                          transform: 'scale(0.5555)',
                          transformOrigin: 'top left',
                          background: '#fff',
                          pointerEvents: 'none',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Lay content out at natural height, crop the bottom. */}
                        <div style={{ width: '100%', padding: 6 }}>
                          <KitWireframe nodes={thumb.nodes} density="compact" fill={false} />
                        </div>
                      </div>
                    ) : (
                      <iframe
                        sandbox=""
                        src={thumb.url}
                        tabIndex={-1}
                        style={{
                          width: NODE_W * 2.2,
                          height: THUMB_H * 2.2 + 120,
                          transform: 'scale(0.455)',
                          transformOrigin: 'top left',
                          border: 'none',
                          background: '#fff',
                          pointerEvents: 'none'
                        }}
                      />
                    )}
                  </foreignObject>
                ) : (
                  <>
                    <rect width={NODE_W} height={THUMB_H} fill="#fafafa" />
                    <text
                      x={NODE_W / 2}
                      y={THUMB_H / 2 + 4}
                      textAnchor="middle"
                      className="flow-placeholder"
                    >
                      sketch coming
                    </text>
                  </>
                )}
                <rect
                  width={NODE_W}
                  height={THUMB_H}
                  fill="transparent"
                  stroke="rgba(0,0,0,0.06)"
                />
              </g>
              <text x={16} y={THUMB_H + (n.purpose ? 25 : 32)} className="flow-name">
                {n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name}
              </text>
              {n.purpose && (
                <text x={16} y={THUMB_H + 42} className="flow-purpose">
                  {n.purpose.length > 30 ? n.purpose.slice(0, 29) + '…' : n.purpose}
                </text>
              )}
              {n.entry && (
                <g transform={`translate(${NODE_W - 52}, 12)`}>
                  <rect width={40} height={18} rx={9} fill="#007aff" />
                  <text x={20} y={12.5} textAnchor="middle" className="flow-start-badge">
                    Start
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
