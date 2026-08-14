import React, { useMemo } from 'react'
import type { Spec, SpecCategory } from '@shared/types'
import { Markdown } from '@/lib/markdown'
import { useToast } from './Toast'
import { CopyIcon } from './Icons'

// Card detail view, Refero-style: the structured VISUAL rendering on one side
// (swatches, sizes, badges — our design), the raw source on the other, with
// copy and .md download.

const CATEGORY_LABEL: Record<SpecCategory, string> = {
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

/** Pull named hex colors out of prose: "signal blue #007bff (primary action)" */
function extractColors(text: string): { hex: string; name: string; role: string }[] {
  const out: { hex: string; name: string; role: string }[] = []
  const seen = new Set<string>()
  const re = /(?:([a-zA-Z][a-zA-Z\s-]{2,28}?)\s+)?(#(?:[0-9a-fA-F]{3}){1,2})\b(?:\s*\(([^)]{2,40})\))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const hex = m[2].toLowerCase()
    if (seen.has(hex)) continue
    seen.add(hex)
    out.push({
      hex,
      name: (m[1] ?? '').trim() || hex,
      role: (m[3] ?? '').trim()
    })
  }
  return out.slice(0, 12)
}

/** Pull px sizes with their nearby words: "56px display headline" */
function extractSizes(text: string): { px: string; label: string }[] {
  const out: { px: string; label: string }[] = []
  const seen = new Set<string>()
  const re = /(\d{1,4})px\s+([a-zA-Z][a-zA-Z\s/-]{2,30}?)(?=[,.;)]|$)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const key = `${m[1]}-${m[2]}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ px: `${m[1]}px`, label: m[2].trim() })
  }
  return out.slice(0, 8)
}

function textOn(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#0a0a0a' : '#ffffff'
}

export function SpecDetail({ spec, onClose }: { spec: Spec; onClose: () => void }): React.JSX.Element {
  const toast = useToast()
  const colors = useMemo(() => extractColors(spec.content), [spec.content])
  const sizes = useMemo(() => extractSizes(spec.content), [spec.content])

  const md = useMemo(() => {
    const lines = [
      `# ${spec.title}`,
      '',
      `> ${CATEGORY_LABEL[spec.category]} · ${spec.status}${spec.difficulty ? ` · difficulty ${spec.difficulty}/5` : ''}${spec.tags.length ? ` · ${spec.tags.join(', ')}` : ''}`,
      '',
      spec.content
    ]
    if (spec.acceptance) lines.push('', '## How we’ll know it works', '', spec.acceptance)
    if (spec.challengeNote) lines.push('', '## Challenged', '', spec.challengeNote)
    return lines.join('\n')
  }, [spec])

  const download = (): void => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    a.download = `${spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Saved as a .md file in your Downloads')
  }

  return (
    <div className="spec-detail">
      <div className="spec-detail-bar">
        <div>
          <span className="badge">{CATEGORY_LABEL[spec.category]}</span>
          <span className={`badge${spec.status === 'confirmed' ? ' badge-blue' : ''}`} style={{ marginLeft: 6 }}>
            {spec.status}
          </span>
          {spec.difficulty != null && spec.difficulty >= 4 && (
            <span className="badge" style={{ marginLeft: 6 }}>
              Hard · {spec.difficulty}/5
            </span>
          )}
        </div>
        <button className="pill pill-quiet" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="spec-detail-cols">
        <div className="spec-detail-visual">
          <h2>{spec.title}</h2>
          <div className="plandoc-body">
            <Markdown text={spec.content} />
          </div>

          {colors.length > 0 && (
            <>
              <h3 className="detail-section">Colors found in this spec</h3>
              <div className="swatch-grid">
                {colors.map((c) => (
                  <div key={c.hex} className="swatch">
                    <div className="chip" style={{ background: c.hex, color: textOn(c.hex) }}>
                      {c.hex}
                    </div>
                    <span className="sname">{c.name}</span>
                    {c.role && <span className="srole">{c.role}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {sizes.length > 0 && (
            <>
              <h3 className="detail-section">Sizes</h3>
              <div className="size-list">
                {sizes.map((s, i) => (
                  <div key={i} className="size-row">
                    <span className="spx">{s.px}</span>
                    <span className="slabel">{s.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {spec.acceptance && (
            <div className="acceptance-note" style={{ marginTop: 16 }}>
              <strong>How we’ll know it works:</strong> {spec.acceptance}
            </div>
          )}
          {spec.challengeNote && (
            <div className="challenge-note" style={{ marginTop: 10 }}>
              <strong>Challenged:</strong> {spec.challengeNote}
            </div>
          )}
        </div>

        <div className="spec-detail-source">
          <div className="source-bar">
            <span className="source-title">SPEC.md</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="pill pill-quiet source-btn"
                onClick={() => {
                  window.specdrive.copyToClipboard(md)
                  toast('Spec copied as markdown')
                }}
              >
                <CopyIcon /> Copy
              </button>
              <button className="pill pill-quiet source-btn" onClick={download}>
                ↓ .md
              </button>
            </div>
          </div>
          <pre className="source-body">{md}</pre>
        </div>
      </div>
    </div>
  )
}
