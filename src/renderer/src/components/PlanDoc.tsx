import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { PlanBlock, PlanDoc as PlanDocType } from '@shared/types'
import { Markdown } from '@/lib/markdown'
import { PHASE_COLOR } from '@/lib/phaseColors'

// The visual plan document (agent-native style): narrative sections, decision
// callouts, sketchy diagrams, trade-off tables and open questions — the plan
// the owner READS, above the checklist the agent executes.
//
// Laid out like a magazine spread: chapters down the left, the narrative in
// the middle at a readable measure, and everything that asks something of the
// owner (decisions, risks, questions) pinned in the margin on wide windows.

const TONE_LABEL: Record<string, string> = {
  decision: 'Decision',
  risk: 'Risk we accept',
  note: 'Note'
}

/** Each tone borrows one stop of the dusk gradient — the brand, systematized. */
const TONE_COLOR: Record<string, string> = {
  decision: PHASE_COLOR.build,
  risk: PHASE_COLOR.risks,
  note: PHASE_COLOR.challenge
}

/** Pane widths at which the plan gains a chapter list, then a margin column. */
const TOC_AT = 820
const MARGIN_AT = 1150

/** Base stylesheet injected into diagram iframes — the hand-drawn kit. */
const WF_BASE_CSS = `
:root{--wf-line:#c6c6c6;--wf-card:#ffffff;--wf-accent-soft:rgba(0,122,255,0.08);--wf-ink:#3e3e3e}
*{box-sizing:border-box}
body{margin:0;padding:20px;font-family:'Bradley Hand','Marker Felt','Comic Sans MS',cursive;color:var(--wf-ink);background:transparent;font-size:14px;line-height:1.35}
.diagram-panel{display:flex;gap:16px;flex-wrap:wrap;align-items:stretch}
.diagram-card{border:1.6px solid var(--wf-line);border-radius:10px;padding:12px 14px;background:var(--wf-card);display:grid;gap:8px;align-content:start;min-width:130px;flex:1;box-shadow:2px 3px 0 rgba(0,0,0,0.045)}
.diagram-card strong{font-size:15px;color:#0a0a0a;letter-spacing:0.01em}
.diagram-card span{border:1.3px solid var(--wf-line);border-radius:7px;padding:5px 9px;background:#fff}
.diagram-panel[data-rough] .diagram-card,[data-rough] .diagram-card{transform:rotate(-0.5deg)}
.diagram-panel[data-rough] .diagram-card:nth-child(even),[data-rough] .diagram-card:nth-child(even){transform:rotate(0.4deg)}
.arrow{align-self:center;font-size:20px;color:var(--wf-line);flex:none}
`

function DiagramBlock({
  block,
  style
}: {
  block: Extract<PlanBlock, { type: 'diagram' }>
  style?: React.CSSProperties
}): React.JSX.Element {
  const src = useMemo(() => {
    const doc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${WF_BASE_CSS}${block.css ?? ''}</style>${block.html}`
    return `data:text/html;charset=utf-8,${encodeURIComponent(doc)}`
  }, [block])
  return (
    <figure className="plandoc-diagram" style={style}>
      <iframe sandbox="" src={src} title={block.caption ?? 'diagram'} tabIndex={-1} />
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  )
}

/** Turns a chapter title into a stable anchor id. */
function slug(title: string, i: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `plan-${base || 'chapter'}-${i}`
}

function renderBlock(b: PlanBlock, i: number, anchor?: string): React.JSX.Element | null {
  const style = { '--i': i } as React.CSSProperties
  switch (b.type) {
    case 'section':
      return (
        <section key={i} id={anchor} className="plandoc-section" style={style}>
          <h3>{b.title}</h3>
          <div className="plandoc-body">
            <Markdown text={b.body} />
          </div>
        </section>
      )
    case 'callout':
      return (
        <div
          key={i}
          className={`plandoc-callout tone-${b.tone}`}
          style={{ ...style, '--tone-color': TONE_COLOR[b.tone] ?? PHASE_COLOR.challenge } as React.CSSProperties}
        >
          <span className="tone-badge">{TONE_LABEL[b.tone] ?? b.tone}</span>
          <div className="plandoc-body">
            <Markdown text={b.body} />
          </div>
        </div>
      )
    case 'table':
      return (
        <div key={i} className="plandoc-table" style={style}>
          {b.title && <span className="table-title">{b.title}</span>}
          <div className="plandoc-table-scroll">
            <table>
              <thead>
                <tr>
                  {b.columns.map((c, ci) => (
                    <th key={ci}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((cell, ci) => (
                      <td key={ci}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    case 'diagram':
      return <DiagramBlock key={i} block={b} style={style} />
    case 'questions':
      return (
        <div key={i} className="plandoc-questions" style={style}>
          <span className="table-title">Open questions — the AI needs you</span>
          {b.items.map((q, qi) => (
            <div key={qi} className="plandoc-question">
              <span className="q">{q.q}</span>
              {q.suggestion && (
                <span className="s">
                  <em>Suggested answer</em> {q.suggestion}
                </span>
              )}
            </div>
          ))}
          <span className="hint">
            Answer these in your next chat — copy the prompt on the right.
          </span>
        </div>
      )
    default:
      return null
  }
}

export function PlanDoc({ doc }: { doc: PlanDocType }): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const [paneW, setPaneW] = useState(0)

  // The columns appear only when the pane is genuinely wide — the sidebar and
  // the guide can both be open or closed, so measure the pane, never the window.
  useEffect(() => {
    const el = wrap.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setPaneW((v) => (Math.abs(v - w) < 1 ? v : w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const wide = paneW >= MARGIN_AT

  const chapters = useMemo(
    () =>
      doc.blocks
        .map((b, i) => (b.type === 'section' ? { i, title: b.title, id: slug(b.title, i) } : null))
        .filter((x): x is { i: number; title: string; id: string } => x !== null),
    [doc.blocks]
  )

  // The margin holds what asks something of the owner; the narrative keeps the
  // rest. On a narrow pane everything stays in the author's order.
  const isMargin = (b: PlanBlock): boolean => b.type === 'callout' || b.type === 'questions'
  const narrative = wide ? doc.blocks.filter((b) => !isMargin(b)) : doc.blocks
  const margin = wide ? doc.blocks.filter(isMargin) : []
  const indexOfBlock = (b: PlanBlock): number => doc.blocks.indexOf(b)

  const showToc = chapters.length > 1 && paneW >= TOC_AT

  // Scroll-spy: the chapter nearest the top of the pane lights up, so the
  // owner always knows where they are in the plan.
  const [activeId, setActiveId] = useState<string | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el || !chapters.length) return undefined
    const scroller = el.closest('.content-body')
    const update = (): void => {
      const top = scroller ? scroller.getBoundingClientRect().top : 0
      let best: string | null = null
      let bestDist = Infinity
      for (const c of chapters) {
        const node = document.getElementById(c.id)
        if (!node) continue
        const d = node.getBoundingClientRect().top - top
        const dist = d <= 40 ? -d : d * 4 // prefer the last head already passed
        if (dist < bestDist) {
          bestDist = dist
          best = c.id
        }
      }
      setActiveId((v) => (v === best ? v : best))
    }
    update()
    scroller?.addEventListener('scroll', update, { passive: true })
    return () => scroller?.removeEventListener('scroll', update)
  }, [chapters, wide, showToc])

  const jumpTo = (id: string): void => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      className={`plandoc-layout${showToc ? ' has-toc' : ''}${wide ? ' wide' : ''}`}
      ref={wrap}
    >
      {showToc && (
        <nav className="plandoc-toc" aria-label="Chapters of the plan">
          <div className="toc-card">
            <div className="toc-head">
              <span className="rail-mini-label">In this plan</span>
              <span className="toc-total">
                {chapters.length} chapter{chapters.length === 1 ? '' : 's'}
              </span>
            </div>
            <ol>
              {chapters.map((c) => (
                <li key={c.id}>
                  <button
                    className={activeId === c.id ? 'on' : ''}
                    aria-current={activeId === c.id ? 'true' : undefined}
                    onClick={() => jumpTo(c.id)}
                  >
                    <span className="toc-dot" />
                    <span className="toc-name">{c.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </nav>
      )}

      <div className="plandoc">
        {narrative.map((b) => {
          const i = indexOfBlock(b)
          return renderBlock(b, i, b.type === 'section' ? slug(b.title, i) : undefined)
        })}
      </div>

      {wide && margin.length > 0 && (
        <aside className="plandoc-margin" aria-label="Decisions, risks and open questions">
          {margin.map((b) => renderBlock(b, indexOfBlock(b)))}
        </aside>
      )}
    </div>
  )
}
