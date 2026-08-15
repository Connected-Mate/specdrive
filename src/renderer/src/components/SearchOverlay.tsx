import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectBundle } from '@shared/types'

// ⌘F — one field that searches every project: specs, scenarios, tasks,
// documents and plan blocks. Enter/click jumps to the project.

interface Hit {
  projectId: string
  projectName: string
  where: string
  title: string
  snippet: string
}

function findHits(projects: ProjectBundle[], q: string): Hit[] {
  const needle = q.toLowerCase()
  const hits: Hit[] = []
  const snip = (text: string): string => {
    const i = text.toLowerCase().indexOf(needle)
    if (i < 0) return text.slice(0, 90)
    return (i > 30 ? '…' : '') + text.slice(Math.max(0, i - 30), i + 60) + '…'
  }
  for (const b of projects) {
    const P = { projectId: b.project.id, projectName: b.project.name }
    for (const s of b.specs) {
      if (`${s.title} ${s.content}`.toLowerCase().includes(needle)) {
        hits.push({ ...P, where: 'Spec', title: s.title, snippet: snip(s.content) })
      }
    }
    for (const sc of b.scenarios) {
      const body = sc.steps.map((st) => `${st.action} ${st.expect ?? ''}`).join(' ')
      if (`${sc.title} ${sc.actor} ${body}`.toLowerCase().includes(needle)) {
        hits.push({ ...P, where: 'Scenario', title: sc.title, snippet: snip(body) })
      }
    }
    for (const t of b.tasks) {
      if (`${t.title} ${t.detail} ${t.note ?? ''}`.toLowerCase().includes(needle)) {
        hits.push({ ...P, where: 'Step', title: t.title, snippet: snip(t.detail) })
      }
    }
    for (const d of b.documents) {
      if (d.title.toLowerCase().includes(needle)) {
        hits.push({ ...P, where: 'Document', title: d.title, snippet: d.kind })
      }
    }
  }
  return hits.slice(0, 30)
}

export function SearchOverlay({
  projects,
  onClose,
  onJump
}: {
  projects: ProjectBundle[]
  onClose: () => void
  onJump: (projectId: string) => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => (q.trim().length >= 2 ? findHits(projects, q.trim()) : []), [projects, q])

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && hits[0]) onJump(hits[0].projectId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onJump, hits])

  return (
    <div className="search-overlay" onClick={onClose} role="presentation">
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search every project — specs, scenarios, steps, documents…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q.trim().length >= 2 && (
          <div className="search-results">
            {hits.length === 0 && <p className="empty" style={{ padding: 24 }}>Nothing found for “{q}”.</p>}
            {hits.map((h, i) => (
              <button key={i} className="search-hit" onClick={() => onJump(h.projectId)}>
                <span className="badge">{h.where}</span>
                <div className="hit-body">
                  <span className="hit-title">{h.title}</span>
                  <span className="hit-snippet">{h.snippet}</span>
                </div>
                <span className="hit-project">{h.projectName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
