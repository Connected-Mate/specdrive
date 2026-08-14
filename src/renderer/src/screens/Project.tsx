import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectBundle, Spec, SpecCategory, Wireframe } from '@shared/types'
import { SPEC_CATEGORIES } from '@shared/types'
import { Markdown } from '@/lib/markdown'
import { TickIcon } from '@/components/Icons'
import { FlowMap, type FlowThumb } from '@/components/FlowMap'
import { KitWireframe } from '@/components/wireframe-kit/KitWireframe'
import type { PlanWireframeNode } from '@/components/wireframe-kit/types'
import { CursorScene } from '@/components/scene/CursorScene'
import { PlanDoc } from '@/components/PlanDoc'
import { SpecDetail } from '@/components/SpecDetail'
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

type Tab = 'board' | 'scenarios' | 'sketches' | 'blueprint' | 'plan' | 'activity'

const SCENARIO_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'To walk', cls: '' },
  walked: { label: 'Walks clean', cls: ' badge-blue' },
  gap_found: { label: 'Gap found', cls: ' badge-gap' }
}

function ScenariosTab({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  const { scenarios } = bundle
  if (!scenarios.length) {
    return (
      <div className="empty">
        <div className="art">No scenarios yet</div>
        During the “Challenge” step, your AI agent writes short stories of real people
        <br />
        using your product — then walks each one, step by step, to catch holes before code.
      </div>
    )
  }
  return (
    <div className="scenario-grid">
      {scenarios.map((sc, i) => (
        <div key={sc.id} className="scenario-card" style={{ '--i': i } as React.CSSProperties}>
          <div className="scenario-head">
            <div>
              <h4>{sc.title}</h4>
              <span className="actor">{sc.actor}</span>
            </div>
            <span className={`badge${SCENARIO_STATUS[sc.status]?.cls ?? ''}`}>
              {SCENARIO_STATUS[sc.status]?.label ?? sc.status}
            </span>
          </div>
          <div className="scenario-steps">
            {sc.steps.map((st, si) => (
              <div key={si} className="scenario-step" style={{ '--si': si } as React.CSSProperties}>
                <span className="step-no">{si + 1}</span>
                <div className="step-body">
                  <span className="step-action">
                    {st.action}
                    {st.screen && <span className="badge step-screen">{st.screen}</span>}
                  </span>
                  {st.expect && <span className="step-expect">→ {st.expect}</span>}
                </div>
              </div>
            ))}
          </div>
          {sc.gapNote && (
            <div className="scenario-gap">
              <strong>Gap:</strong> {sc.gapNote}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function BoardTab({
  specs,
  freshIds,
  projectName
}: {
  specs: Spec[]
  freshIds: Set<string>
  projectName: string
}): React.JSX.Element {
  const [openSpec, setOpenSpec] = useState<Spec | null>(null)
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

  if (openSpec) {
    const live = specs.find((x) => x.id === openSpec.id) ?? openSpec
    return <SpecDetail spec={live} onClose={() => setOpenSpec(null)} />
  }

  return (
    <div className="board">
      {[...groups.entries()].map(([cat, items]) => (
        <div className="board-group" key={cat}>
          <div className="board-group-head">
            <span className="label">{CATEGORY_LABEL[cat]}</span>
            <span className="rule" />
            <span className="n">{items.length}</span>
          </div>
          {items.map((s, i) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              className={`spec-card clickable${freshIds.has(s.id) ? ' fresh' : ''}`}
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => setOpenSpec(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setOpenSpec(s)
              }}
            >
              <h4>{s.title}</h4>
              <div className="content-md">
                <Markdown text={s.content} />
              </div>
              {s.acceptance && (
                <div className="acceptance-note">
                  <strong>How we’ll know it works:</strong> {s.acceptance}
                </div>
              )}
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

function TaskRow({
  task,
  index,
  sub,
  childCount,
  doneChildren,
  collapsed,
  onToggle
}: {
  task: ProjectBundle['tasks'][number]
  index: number
  sub?: boolean
  childCount?: number
  doneChildren?: number
  collapsed?: boolean
  onToggle?: () => void
}): React.JSX.Element {
  return (
    <div
      className={`task-row ${task.status.replace('_', '-')}${sub ? ' sub' : ''}`}
      style={{ '--i': index } as React.CSSProperties}
    >
      <span className={`task-check ${task.status.replace('_', '-')}`}>
        {task.status === 'done' && <TickIcon size={10} />}
      </span>
      <div className="body">
        <div className="title-line">
          <span className="title">{task.title}</span>
          {childCount ? (
            <button className="task-chevron" onClick={onToggle} aria-label="Toggle sub-steps">
              <span className="badge">
                {doneChildren}/{childCount}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                style={{
                  transform: collapsed ? 'rotate(-90deg)' : 'none',
                  transition: 'transform 0.2s ease'
                }}
              >
                <path
                  d="M4 6.5 8 10.5 12 6.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
        </div>
        {task.status !== 'done' && <div className="detail">{task.detail}</div>}
        {task.note && <div className="note">{task.note}</div>}
        {task.status === 'blocked' && (
          <span className="badge" style={{ marginTop: 5 }}>
            Blocked
          </span>
        )}
      </div>
    </div>
  )
}

function BlueprintTab({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  if (!bundle.planDoc) {
    return (
      <div className="empty">
        <div className="art">No blueprint yet</div>
        During the “Plan” step, your AI agent writes the blueprint here —<br />
        what we are building, the decisions taken, the risks accepted, and your open questions.
      </div>
    )
  }
  return <PlanDoc doc={bundle.planDoc} />
}

function PlanTab({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  const { tasks } = bundle
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  if (!tasks.length) {
    return (
      <div className="empty">
        <div className="art">No plan yet</div>
        The work list appears here once the “Plan” step runs —<br />
        small ordered steps, each checked off as your product gets built.
      </div>
    )
  }
  const done = tasks.filter((t) => t.status === 'done').length
  const roots = tasks.filter((t) => !t.parentId).sort((a, b) => a.order - b.order)
  const childrenOf = (id: string): typeof tasks =>
    tasks.filter((t) => t.parentId === id).sort((a, b) => a.order - b.order)
  const toggle = (id: string): void =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  let row = 0
  return (
    <>
      <div className="plan-wrap">
      <div className="progress-row">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${(done / tasks.length) * 100}%` }} />
        </div>
        <span className="pct">
          {done}/{tasks.length} · {Math.round((done / tasks.length) * 100)}%
        </span>
      </div>
      {roots.map((t) => {
        const kids = childrenOf(t.id)
        const isCollapsed = collapsed.has(t.id)
        const doneKids = kids.filter((k) => k.status === 'done').length
        return (
          <React.Fragment key={t.id}>
            <TaskRow
              task={t}
              index={row++}
              childCount={kids.length || undefined}
              doneChildren={doneKids}
              collapsed={isCollapsed}
              onToggle={() => toggle(t.id)}
            />
            {!isCollapsed && kids.map((k) => <TaskRow key={k.id} task={k} index={row++} sub />)}
          </React.Fragment>
        )
      })}
      </div>
    </>
  )
}

function SketchesTab({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  const [open, setOpen] = useState<Wireframe | null>(null)
  const [docs, setDocs] = useState<Record<string, string>>({})
  const sketchScreens = useMemo(
    () => new Set(bundle.wireframes.map((w) => w.screen.toLowerCase())),
    [bundle.wireframes]
  )

  const wfIds = bundle.wireframes.map((w) => w.id).join(',')
  useEffect(() => {
    for (const wf of bundle.wireframes) {
      if (!docs[wf.id]) {
        window.specdrive
          .readWireframe(bundle.project.id, wf.file)
          .then((html) => setDocs((d) => ({ ...d, [wf.id]: html })))
          .catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfIds])

  const dataUrls = useMemo(() => {
    const map: Record<string, string> = {}
    for (const [id, html] of Object.entries(docs)) {
      map[id] = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    }
    return map
  }, [docs])

  if (!bundle.wireframes.length && !bundle.flow) {
    return (
      <div className="empty">
        <div className="art">No visual plan yet</div>
        During the “Plan” step, your AI agent draws a map of your product’s screens —<br />
        and sketches each one in rough gray shapes, so you can react before anything is built.
      </div>
    )
  }

  const dataUrl = (id: string): string | undefined => dataUrls[id]

  const kitNodes = useMemo(() => {
    const map: Record<string, PlanWireframeNode[]> = {}
    for (const wf of bundle.wireframes) {
      if ((wf.kind === 'kit' || wf.file.endsWith('.json')) && docs[wf.id]) {
        try {
          map[wf.id] = JSON.parse(docs[wf.id]) as PlanWireframeNode[]
        } catch {
          // corrupt tree — skip
        }
      }
    }
    return map
  }, [bundle.wireframes, docs])

  const thumbs = useMemo(() => {
    const map: Record<string, FlowThumb> = {}
    for (const wf of bundle.wireframes) {
      const key = wf.screen.toLowerCase()
      if (kitNodes[wf.id]) map[key] = { kind: 'kit', nodes: kitNodes[wf.id] }
      else if (dataUrls[wf.id] && !wf.file.endsWith('.json'))
        map[key] = { kind: 'html', url: dataUrls[wf.id] }
    }
    return map
  }, [bundle.wireframes, kitNodes, dataUrls])

  return (
    <>
      {bundle.flow && bundle.flow.screens.length > 0 && (
        <>
          <FlowMap
            flow={bundle.flow}
            sketchScreens={sketchScreens}
            thumbs={thumbs}
            onOpenScreen={(name) => {
              const wf = bundle.wireframes.find(
                (w) => w.screen.toLowerCase() === name.toLowerCase()
              )
              if (wf) setOpen(wf)
            }}
          />
          <p className="flow-hint">
            The map of your product — each arrow is something the user does. Click a screen to see
            its sketch full size.
          </p>
        </>
      )}
      {!bundle.flow?.screens.length && (
        <div className="wireframe-grid">
          {bundle.wireframes.map((wf, i) =>
            kitNodes[wf.id] ? (
              <button
                key={wf.id}
                className="kit-artboard"
                style={{ '--i': i, textAlign: 'left', padding: 0 } as React.CSSProperties}
                onClick={() => setOpen(open?.id === wf.id ? null : wf)}
              >
                <div className="frame">
                  <KitWireframe nodes={kitNodes[wf.id]} density="compact" />
                </div>
                <div className="label">
                  <div className="screen">{wf.screen}</div>
                  <div className="title">{wf.title}</div>
                </div>
              </button>
            ) : (
              <button
                key={wf.id}
                className="wireframe-card"
                style={{ '--i': i } as React.CSSProperties}
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
            )
          )}
        </div>
      )}
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
          {kitNodes[open.id] ? (
            <div className="kit-expanded">
              <KitWireframe nodes={kitNodes[open.id]} />
            </div>
          ) : (
            <iframe sandbox="" title={open.title} src={dataUrl(open.id)} />
          )}
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
          <div key={i} className="activity-row" style={{ '--i': i } as React.CSSProperties}>
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

  // Automated visual checks can force a tab.
  useEffect(() => {
    const h = (e: Event): void => setTab((e as CustomEvent<Tab>).detail)
    window.addEventListener('specdrive:open-tab', h)
    return () => window.removeEventListener('specdrive:open-tab', h)
  }, [])

  // Auto-jump to the plan while building, board otherwise? Keep user control; just default once.
  const autoTabbed = useRef(false)
  useEffect(() => {
    if (!autoTabbed.current && project.phase === 'build' && tasks.length) {
      setTab('plan')
      autoTabbed.current = true
    }
  }, [project.phase, tasks.length])

  const tabs: { id: Tab; label: string; count: number; divider?: boolean }[] = [
    { id: 'board', label: 'Board', count: specs.length },
    { id: 'scenarios', label: 'Scenarios', count: bundle.scenarios.length },
    { id: 'sketches', label: 'Screens', count: wireframes.length },
    { id: 'blueprint', label: 'Blueprint', count: bundle.planDoc ? 1 : 0 },
    { id: 'plan', label: 'Plan', count: tasks.length, divider: true },
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
            <React.Fragment key={t.id}>
              {t.divider && <span className="tab-divider" />}
              <button
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.count > 0 && t.id !== 'blueprint' && <span className="count">{t.count}</span>}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="content-body">
        {tab === 'board' && (
          <BoardTab specs={specs} freshIds={freshIds} projectName={project.name} />
        )}
        {tab === 'scenarios' && <ScenariosTab bundle={bundle} />}
        {tab === 'blueprint' && <BlueprintTab bundle={bundle} />}
        {tab === 'plan' && <PlanTab bundle={bundle} />}
        {tab === 'sketches' && <SketchesTab bundle={bundle} />}
        {tab === 'activity' && <ActivityTab bundle={bundle} />}
      </div>
    </main>
  )
}
