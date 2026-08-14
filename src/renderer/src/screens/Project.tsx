import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectBundle, Spec, SpecCategory, Wireframe } from '@shared/types'
import { SPEC_CATEGORIES } from '@shared/types'
import { Markdown } from '@/lib/markdown'
import { TickIcon } from '@/components/Icons'
import { timeAgo } from '@/lib/useLive'

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

const STATUS_LABEL: Record<Spec['status'], string> = {
  draft: 'Draft',
  challenged: 'Challenged',
  confirmed: 'Confirmed'
}

type Tab = 'board' | 'plan' | 'sketches' | 'activity'

function BoardTab({ specs, freshIds }: { specs: Spec[]; freshIds: Set<string> }): React.JSX.Element {
  const groups = useMemo(() => {
    const byCat = new Map<SpecCategory, Spec[]>()
    for (const cat of SPEC_CATEGORIES) {
      const items = specs.filter((s) => s.category === cat)
      if (items.length) byCat.set(cat, items)
    }
    return byCat
  }, [specs])

  if (!specs.length) {
    return (
      <div className="empty">
        <div className="art">The board is listening…</div>
        As you talk with your AI agent, everything it learns lands here —<br />
        each card one piece of your project’s memory.
      </div>
    )
  }

  return (
    <div className="board">
      {[...groups.entries()].map(([cat, items]) => (
        <div className="board-group" key={cat}>
          <div className="board-group-head">
            <span className="label">{CATEGORY_LABEL[cat]}</span>
            <span className="n">{items.length}</span>
          </div>
          {items.map((s) => (
            <div key={s.id} className={`spec-card${freshIds.has(s.id) ? ' fresh' : ''}`}>
              <h4>{s.title}</h4>
              <div className="content-md">
                <Markdown text={s.content} />
              </div>
              {s.challengeNote && (
                <div className="challenge-note">
                  <strong>Challenged:</strong> {s.challengeNote}
                </div>
              )}
              <div className="foot">
                <span className={`badge${s.status === 'confirmed' ? ' badge-blue' : ''}`}>
                  {STATUS_LABEL[s.status]}
                </span>
                {s.difficulty != null && s.difficulty >= 4 && (
                  <span className="badge">Hard · {s.difficulty}/5</span>
                )}
                {s.tags.slice(0, 2).map((t) => (
                  <span key={t} className="badge">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function PlanTab({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  const { tasks } = bundle
  if (!tasks.length) {
    return (
      <div className="empty">
        <div className="art">No plan yet</div>
        The build plan appears here once the “Plan” step runs —<br />
        small ordered steps, each checked off as your product gets built.
      </div>
    )
  }
  const done = tasks.filter((t) => t.status === 'done').length
  const ordered = [...tasks].sort((a, b) => a.order - b.order)
  return (
    <div className="plan-wrap">
      <div className="progress-row">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${(done / tasks.length) * 100}%` }} />
        </div>
        <span className="pct">
          {done}/{tasks.length} · {Math.round((done / tasks.length) * 100)}%
        </span>
      </div>
      {ordered.map((t) => (
        <div key={t.id} className={`task-row ${t.status.replace('_', '-')}`}>
          <span className={`task-check ${t.status.replace('_', '-')}`}>
            {t.status === 'done' && <TickIcon size={10} />}
          </span>
          <div className="body">
            <div className="title">{t.title}</div>
            {t.status !== 'done' && <div className="detail">{t.detail}</div>}
            {t.note && <div className="note">{t.note}</div>}
            {t.status === 'blocked' && (
              <span className="badge" style={{ marginTop: 5 }}>
                Blocked
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function SketchesTab({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  const [open, setOpen] = useState<Wireframe | null>(null)
  const [docs, setDocs] = useState<Record<string, string>>({})

  useEffect(() => {
    for (const wf of bundle.wireframes) {
      if (!docs[wf.id]) {
        window.specdrive
          .readWireframe(bundle.project.id, wf.file)
          .then((html) => setDocs((d) => ({ ...d, [wf.id]: html })))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.wireframes.length])

  if (!bundle.wireframes.length) {
    return (
      <div className="empty">
        <div className="art">No sketches yet</div>
        During the “Plan” step, your AI agent sketches each screen of your product —<br />
        rough gray shapes, so you can react before anything is built.
      </div>
    )
  }

  const dataUrl = (id: string): string | undefined =>
    docs[id] ? `data:text/html;charset=utf-8,${encodeURIComponent(docs[id])}` : undefined

  return (
    <>
      <div className="wireframe-grid">
        {bundle.wireframes.map((wf) => (
          <button
            key={wf.id}
            className="wireframe-card"
            onClick={() => setOpen(open?.id === wf.id ? null : wf)}
          >
            <div className="wireframe-thumb">
              <iframe sandbox="" title={wf.title} src={dataUrl(wf.id)} tabIndex={-1} />
            </div>
            <div className="label">
              <div className="screen">{wf.screen}</div>
              <div className="title">{wf.title}</div>
            </div>
          </button>
        ))}
      </div>
      {open && (
        <div className="wireframe-expanded">
          <div className="bar">
            <span className="t">
              {open.screen} — {open.title}
            </span>
            <button className="pill pill-quiet" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
          <iframe sandbox="" title={open.title} src={dataUrl(open.id)} />
        </div>
      )}
    </>
  )
}

function ActivityTab({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  if (!bundle.activity.length) {
    return (
      <div className="empty">
        <div className="art">Nothing yet</div>
        Every move your AI agent makes on this project is logged here.
      </div>
    )
  }
  return (
    <div className="activity">
      {[...bundle.activity]
        .reverse()
        .slice(0, 60)
        .map((a, i) => (
          <div key={i} className="activity-row">
            <span className="time">{timeAgo(a.ts)}</span>
            <span className="what">{a.summary}</span>
          </div>
        ))}
    </div>
  )
}

export function Project({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  const { project, specs, tasks, wireframes, activity } = bundle
  const [tab, setTab] = useState<Tab>('board')

  // Highlight specs that appear while the screen is open — the live magic.
  const seen = useRef<Set<string> | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    const ids = new Set(specs.map((s) => s.id))
    if (seen.current) {
      const fresh = new Set([...ids].filter((id) => !seen.current!.has(id)))
      if (fresh.size) {
        setFreshIds(fresh)
        const t = setTimeout(() => setFreshIds(new Set()), 3500)
        seen.current = ids
        return () => clearTimeout(t)
      }
    }
    seen.current = ids
    return undefined
  }, [specs])

  // Auto-jump to the plan while building, board otherwise? Keep user control; just default once.
  const autoTabbed = useRef(false)
  useEffect(() => {
    if (!autoTabbed.current && project.phase === 'build' && tasks.length) {
      setTab('plan')
      autoTabbed.current = true
    }
  }, [project.phase, tasks.length])

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'board', label: 'Board', count: specs.length },
    { id: 'plan', label: 'Plan', count: tasks.length },
    { id: 'sketches', label: 'Sketches', count: wireframes.length },
    { id: 'activity', label: 'Activity', count: activity.length }
  ]

  return (
    <main className="content">
      <div className="content-head">
        <div className="content-title">
          <h1>{project.name}</h1>
          <span className="one-liner">{project.oneLiner}</span>
        </div>
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.count > 0 && <span className="count">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="content-body">
        {tab === 'board' && <BoardTab specs={specs} freshIds={freshIds} />}
        {tab === 'plan' && <PlanTab bundle={bundle} />}
        {tab === 'sketches' && <SketchesTab bundle={bundle} />}
        {tab === 'activity' && <ActivityTab bundle={bundle} />}
      </div>
    </main>
  )
}
