import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectBundle, Spec, SpecCategory } from '@shared/types'
import { SPEC_CATEGORIES } from '@shared/types'
import { Markdown } from '@/lib/markdown'
import { CATEGORY_LABEL, STATUS_LABEL, TAG_LABEL, firstSentence } from '@/lib/labels'
import { CursorScene } from '@/components/scene/CursorScene'
import { SpecDetail } from '@/components/SpecDetail'
import { OwnerNotes } from '@/components/OwnerNotes'
import { useToast } from '@/components/Toast'

// The board, read like a documentation: a table of contents on the left,
// sticky chapter heads, and cards that stay folded to one sentence until you
// open them. Built for boards that hold forty cards, not four.

type StatusFilter = 'all' | Spec['status']

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'Everything',
  confirmed: 'Confirmed',
  challenged: 'Stress-tested',
  draft: 'Draft'
}

function DocumentsStrip({
  bundle,
  onOpen
}: {
  bundle: ProjectBundle
  onOpen: (doc: ProjectBundle['documents'][number]) => void
}): React.JSX.Element | null {
  if (!bundle.documents.length) return null
  return (
    <div className="docs-strip">
      <span className="rail-mini-label">Your documents</span>
      <div className="docs-row">
        {bundle.documents.map((d, i) => (
          <button
            key={d.id}
            className="doc-chip"
            style={{ '--i': i } as React.CSSProperties}
            onClick={() => onOpen(d)}
          >
            <span className="doc-icon">{d.kind === 'image' ? '🖼' : '▤'}</span>
            <span className="doc-name">{d.title}</span>
            <span className="doc-meta">
              {d.kind} · {(d.size / 1000).toFixed(1)}k
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SpecArticle({
  spec,
  index,
  fresh,
  open,
  onToggle,
  onOpenFull,
  bundle
}: {
  spec: Spec
  index: number
  fresh: boolean
  open: boolean
  onToggle: () => void
  onOpenFull: () => void
  bundle: ProjectBundle
}): React.JSX.Element {
  const lede = useMemo(() => firstSentence(spec.content), [spec.content])
  return (
    <article
      className={`spec-card doc${fresh ? ' fresh' : ''}${open ? ' open' : ''}`}
      style={{ '--i': index } as React.CSSProperties}
    >
      <div
        className="spec-card-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <span className={`spec-caret${open ? ' open' : ''}`} aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4 10.5 8 6 12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="spec-card-headline">
          <h4>{spec.title}</h4>
          {!open && lede && <p className="spec-lede">{lede}</p>}
        </div>
        <button
          className="spec-open-full"
          onClick={(e) => {
            e.stopPropagation()
            onOpenFull()
          }}
        >
          Open
        </button>
      </div>
      {open && (
        <div className="spec-card-more">
          <div className="content-md">
            <Markdown text={spec.content} />
          </div>
          {spec.acceptance && (
            <div className="acceptance-note">
              <strong>How we’ll know it works:</strong> {spec.acceptance}
            </div>
          )}
          {spec.challengeNote && (
            <div className="challenge-note">
              <strong>Challenged:</strong> {spec.challengeNote}
            </div>
          )}
          <OwnerNotes
            projectId={bundle.project.id}
            target={{ kind: 'spec', id: spec.id }}
            comments={bundle.comments ?? []}
          />
        </div>
      )}
      <div className="foot">
        <span className={`badge${spec.status === 'confirmed' ? ' badge-blue' : ''}`}>
          {STATUS_LABEL[spec.status]}
        </span>
        {spec.difficulty != null && spec.difficulty >= 4 && (
          <span className="badge">Hard · {spec.difficulty}/5</span>
        )}
        {spec.confidence === 'gap' && <span className="badge badge-gap">Nobody knows yet</span>}
        {spec.tags.slice(0, 2).map((t) => (
          <span key={t} className="badge">
            {TAG_LABEL[t] ?? t}
          </span>
        ))}
      </div>
    </article>
  )
}

export function BoardDoc({
  bundle,
  specs,
  freshIds,
  projectName
}: {
  bundle: ProjectBundle
  specs: Spec[]
  freshIds: Set<string>
  projectName: string
}): React.JSX.Element {
  const projectId = bundle.project.id
  const [openSpec, setOpenSpec] = useState<Spec | null>(null)
  const [openDoc, setOpenDoc] = useState<ProjectBundle['documents'][number] | null>(null)
  const [docText, setDocText] = useState<string>('')
  const [imgSrc, setImgSrc] = useState<string>('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')

  // Reading state survives tab switches within the session, not across launches.
  const foldKey = `specdrive:board-folded:${projectId}`
  const openKey = `specdrive:board-open:${projectId}`
  const [folded, setFolded] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem(foldKey)
      if (saved) return saved === '1'
    } catch {
      // no session storage — fall through to the size heuristic
    }
    return specs.length >= 14
  })
  // Cards the reader has flipped away from the current default ("fold every
  // card" / "open every card") — so one click never rearranges the whole page.
  const [flipped, setFlipped] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(openKey) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(foldKey, folded ? '1' : '0')
      sessionStorage.setItem(openKey, JSON.stringify([...flipped]))
    } catch {
      // storage unavailable — reading state is a convenience, not data
    }
  }, [folded, flipped, foldKey, openKey])

  useEffect(() => {
    if (!openDoc) return
    if (openDoc.kind === 'image') {
      window.specdrive.readImage(projectId, openDoc.file).then(setImgSrc).catch(() => setImgSrc(''))
    } else {
      window.specdrive
        .readDocument(projectId, openDoc.file)
        .then(setDocText)
        .catch(() => setDocText('Document not found.'))
    }
  }, [openDoc, projectId])

  // Drop an image anywhere on the board → stored with the documents.
  const toast = useToast()
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    for (const f of Array.from(e.dataTransfer.files)) {
      if (!/image\/(png|jpe?g|gif|webp)/.test(f.type) && !/\.(png|jpe?g|gif|webp)$/i.test(f.name)) {
        toast(`"${f.name}" skipped — images only (png, jpg, gif, webp)`)
        continue
      }
      if (f.size > 8 * 1024 * 1024) {
        toast(`"${f.name}" is too large — 8 MB max`)
        continue
      }
      const buf = await f.arrayBuffer()
      let bin = ''
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      const err = await window.specdrive.addImage(projectId, f.name, btoa(bin))
      toast(err || `"${f.name}" added to the project`)
    }
  }

  const needle = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      specs.filter((s) => {
        if (filter !== 'all' && s.status !== filter) return false
        if (!needle) return true
        return `${s.title} ${s.content} ${s.tags.join(' ')}`.toLowerCase().includes(needle)
      }),
    [specs, filter, needle]
  )

  const groups = useMemo(() => {
    const byCat = new Map<SpecCategory, Spec[]>()
    for (const cat of SPEC_CATEGORIES) {
      const items = visible.filter((s) => s.category === cat)
      if (items.length) byCat.set(cat, items)
    }
    return byCat
  }, [visible])

  const counts = useMemo(
    () => ({
      all: specs.length,
      confirmed: specs.filter((s) => s.status === 'confirmed').length,
      challenged: specs.filter((s) => s.status === 'challenged').length,
      draft: specs.filter((s) => s.status === 'draft').length
    }),
    [specs]
  )

  const sectionRefs = useRef<Map<SpecCategory, HTMLElement>>(new Map())
  const jumpTo = (cat: SpecCategory): void => {
    sectionRefs.current.get(cat)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (!specs.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
        <CursorScene word={projectName} compact />
        <p className="empty" style={{ padding: '8px 24px' }}>
          The board is listening — as you talk with your AI agent,
          <br />
          everything it learns lands here, live.
        </p>
      </div>
    )
  }

  if (openDoc && openDoc.kind === 'image') {
    return (
      <div className="spec-detail">
        <div className="spec-detail-bar">
          <div>
            <span className="badge">Image</span>
            <span className="badge" style={{ marginLeft: 6 }}>
              {(openDoc.size / 1000).toFixed(0)} KB
            </span>
          </div>
          <button className="pill pill-quiet" onClick={() => setOpenDoc(null)}>
            Close
          </button>
        </div>
        <div className="image-viewer">
          <h2>{openDoc.title}</h2>
          {imgSrc ? <img src={imgSrc} alt={openDoc.title} /> : <p className="empty">Loading…</p>}
        </div>
      </div>
    )
  }

  if (openDoc) {
    return (
      <SpecDetail
        spec={{
          id: openDoc.id,
          category: 'design',
          title: openDoc.title,
          content: docText || 'Loading…',
          status: 'confirmed',
          tags: [openDoc.kind],
          createdAt: openDoc.createdAt,
          updatedAt: openDoc.createdAt
        }}
        onClose={() => setOpenDoc(null)}
      />
    )
  }

  if (openSpec) {
    const live = specs.find((x) => x.id === openSpec.id) ?? openSpec
    return <SpecDetail spec={live} onClose={() => setOpenSpec(null)} />
  }

  const toggle = (id: string): void =>
    setFlipped((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const isOpen = (id: string): boolean => (folded ? flipped.has(id) : !flipped.has(id))
  const setAll = (nextFolded: boolean): void => {
    setFolded(nextFolded)
    setFlipped(new Set())
  }

  let row = 0
  return (
    <div className="board-doc" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <nav className="board-toc" aria-label="Sections of the board">
        <span className="rail-mini-label">On this board</span>
        <ol>
          {[...groups.entries()].map(([cat, items]) => (
            <li key={cat}>
              <button onClick={() => jumpTo(cat)}>
                <span className="toc-name">{CATEGORY_LABEL[cat]}</span>
                <span className="toc-n">{items.length}</span>
              </button>
            </li>
          ))}
        </ol>
        {!groups.size && <p className="toc-empty">Nothing matches.</p>}
        <button className="toc-fold" onClick={() => setAll(!folded)}>
          {folded ? 'Open every card' : 'Fold every card'}
        </button>
      </nav>

      <div className="board-main">
        <DocumentsStrip bundle={bundle} onOpen={setOpenDoc} />
        <div className="board-controls">
          <input
            className="board-search"
            placeholder="Search this board…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search this board"
          />
          <div className="filter-chips" role="group" aria-label="Filter by state">
            {(['all', 'confirmed', 'challenged', 'draft'] as StatusFilter[]).map((f) => (
              <button
                key={f}
                className={`chip${filter === f ? ' on' : ''}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]}
                <span className="chip-n">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
        {!bundle.documents.length && (
          <p className="drop-hint">
            Tip — drop screenshots or reference images anywhere here to keep them with the project.
          </p>
        )}
        {!(bundle.comments ?? []).some((c) => c.status === 'open') && (
          <p className="drop-hint">Click “Open” on a card to leave a note — your agent reads it on its next pass.</p>
        )}

        {!groups.size && (
          <p className="empty" style={{ padding: 32 }}>
            Nothing here for “{query || FILTER_LABEL[filter]}”.
          </p>
        )}

        {[...groups.entries()].map(([cat, items]) => (
          <section
            className="board-section"
            key={cat}
            ref={(el) => {
              if (el) sectionRefs.current.set(cat, el)
            }}
          >
            <div className="board-section-head">
              <span className="label">{CATEGORY_LABEL[cat]}</span>
              <span className="rule" />
              <span className="n">{items.length}</span>
            </div>
            {items.map((s) => (
              <SpecArticle
                key={s.id}
                spec={s}
                index={row++}
                bundle={bundle}
                fresh={freshIds.has(s.id)}
                open={isOpen(s.id) || freshIds.has(s.id)}
                onToggle={() => toggle(s.id)}
                onOpenFull={() => setOpenSpec(s)}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
