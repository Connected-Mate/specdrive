import React, { useMemo } from 'react'
import type { PlanBlock, PlanDoc as PlanDocType } from '@shared/types'
import { Markdown } from '@/lib/markdown'

// The visual plan document (agent-native style): narrative sections, decision
// callouts, sketchy diagrams, trade-off tables and open questions — the plan
// the owner READS, above the checklist the agent executes.

const TONE_LABEL: Record<string, string> = {
  decision: 'Decision',
  risk: 'Risk we accept',
  note: 'Note'
}

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
  block
}: {
  block: Extract<PlanBlock, { type: 'diagram' }>
}): React.JSX.Element {
  const src = useMemo(() => {
    const doc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${WF_BASE_CSS}${block.css ?? ''}</style>${block.html}`
    return `data:text/html;charset=utf-8,${encodeURIComponent(doc)}`
  }, [block])
  return (
    <figure className="plandoc-diagram">
      <iframe sandbox="" src={src} title={block.caption ?? 'diagram'} tabIndex={-1} />
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  )
}

export function PlanDoc({ doc }: { doc: PlanDocType }): React.JSX.Element {
  return (
    <div className="plandoc">
      {doc.blocks.map((b, i) => {
        const style = { '--i': i } as React.CSSProperties
        switch (b.type) {
          case 'section':
            return (
              <section key={i} className="plandoc-section" style={style}>
                <h3>{b.title}</h3>
                <div className="plandoc-body">
                  <Markdown text={b.body} />
                </div>
              </section>
            )
          case 'callout':
            return (
              <div key={i} className={`plandoc-callout tone-${b.tone}`} style={style}>
                <span className="tone-badge">{TONE_LABEL[b.tone]}</span>
                <div className="plandoc-body">
                  <Markdown text={b.body} />
                </div>
              </div>
            )
          case 'table':
            return (
              <div key={i} className="plandoc-table" style={style}>
                {b.title && <span className="table-title">{b.title}</span>}
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
            )
          case 'diagram':
            return <DiagramBlock key={i} block={b} />
          case 'questions':
            return (
              <div key={i} className="plandoc-questions" style={style}>
                <span className="table-title">Open questions — the AI needs you</span>
                {b.items.map((q, qi) => (
                  <div key={qi} className="plandoc-question">
                    <span className="q">{q.q}</span>
                    {q.suggestion && <span className="s">Suggested answer: {q.suggestion}</span>}
                  </div>
                ))}
                <span className="hint">Answer these in your next chat — copy the prompt on the right.</span>
              </div>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
