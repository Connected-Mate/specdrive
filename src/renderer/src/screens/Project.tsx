import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectBundle, Spec, SpecCategory, Wireframe } from '@shared/types'
import { PHASES, SPEC_CATEGORIES } from '@shared/types'
import { DEEP_DIVE_PROMPT, PHASE_PROMPTS, fillPrompt } from '@shared/prompts'
import { PromptCard } from '@/components/PromptCard'
import { Markdown } from '@/lib/markdown'
import { TickIcon } from '@/components/Icons'
import { timeAgo } from '@/lib/useLive'
import { useToast } from '@/components/Toast'

const PHASE_LABEL: Record<string, string> = {
  capture: 'Idea',
  challenge: 'Challenge',
  research: 'Research',
  risks: 'Hard parts',
  plan: 'Plan',
  build: 'Build',
  done: 'Done'
}

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

function Stepper({ current }: { current: string }): React.JSX.Element {
  const visible = PHASES.filter((p) => p !== 'done')
  const currentIdx = PHASES.indexOf(current as (typeof PHASES)[number])
  return (
    <div className="stepper">
      {visible.map((p, i) => {
        const idx = PHASES.indexOf(p)
        const state = current === 'done' || idx < currentIdx ? 'done' : idx === currentIdx ? 'current' : ''
        return (
          <React.Fragment key={p}>
            {i > 0 && <span className="connector" />}
            <span className={`phase-pill ${state}`}>
              {state === 'done' && <TickIcon size={11} />}
              {PHASE_LABEL[p]}
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function SpecBoard({ specs, freshIds }: { specs: Spec[]; freshIds: Set<string> }): React.JSX.Element {
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
      <div className="empty card">
        <div className="art">The board is listening…</div>
        As you talk with your AI agent, everything it learns lands here — each card one piece of
        your project’s memory.
      </div>
    )
  }

  return (
    <div className="board">
      {[...groups.entries()].map(([cat, items]) => (
        <div className="board-group" key={cat}>
          <div className="board-group-head">
            <span className="label">{CATEGORY_LABEL[cat]}</span>
            <span className="badge">{items.length}</span>
          </div>
          {items.map((s) => (
            <div key={s.id} className={`spec-card${freshIds.has(s.id) ? ' fresh' : ''}`}>
              <h4>{s.title}</h4>
              <div className="content">
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

function Wireframes({ bundle }: { bundle: ProjectBundle }): React.JSX.Element | null {
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

  if (!bundle.wireframes.length) return null

  return (
    <section className="section">
      <div className="section-head">
        <h2>Screen sketches</h2>
        <span className="aside">Rough shapes, not final design</span>
      </div>
      <div className="wireframe-grid">
        {bundle.wireframes.map((wf) => (
          <button
            key={wf.id}
            className="wireframe-card"
            onClick={() => setOpen(open?.id === wf.id ? null : wf)}
          >
            <div className="wireframe-thumb">
              <iframe
                sandbox=""
                title={wf.title}
                src={docs[wf.id] ? `data:text/html;charset=utf-8,${encodeURIComponent(docs[wf.id])}` : undefined}
                tabIndex={-1}
              />
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
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>
              {open.screen} — {open.title}
            </span>
            <button className="pill pill-quiet" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
          <iframe
            sandbox=""
            title={open.title}
            src={docs[open.id] ? `data:text/html;charset=utf-8,${encodeURIComponent(docs[open.id])}` : undefined}
          />
        </div>
      )}
    </section>
  )
}

export function Project({
  bundle,
  onBack
}: {
  bundle: ProjectBundle
  onBack: () => void
}): React.JSX.Element {
  const toast = useToast()
  const { project, specs, tasks, activity } = bundle
  const phasePrompt = PHASE_PROMPTS.find((p) => p.phase === project.phase) ?? PHASE_PROMPTS[0]

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
        return () => clearTimeout(t)
      }
    }
    seen.current = ids
    return undefined
  }, [specs])
  useEffect(() => {
    seen.current = new Set(specs.map((s) => s.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doneTasks = tasks.filter((t) => t.status === 'done').length
  const ordered = [...tasks].sort((a, b) => a.order - b.order)
  const deepDives = specs.filter(
    (s) => s.category === 'risks' && (s.difficulty ?? 0) >= 4
  )

  return (
    <div className="page">
      <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <h1 style={{ fontSize: 48 }}>{project.name}</h1>
            <p style={{ color: 'var(--smoke)', marginTop: 10, maxWidth: '58ch' }}>{project.oneLiner}</p>
          </div>
        </div>
        <Stepper current={project.phase} />
      </div>

      <section className="section-tight">
        <PromptCard
          stepLabel={`Step ${Math.min(PHASES.indexOf(project.phase) + 1, 6)} of 6 — ${PHASE_LABEL[project.phase]}`}
          title={phasePrompt.title}
          forHumans={phasePrompt.forHumans}
          freshSession={phasePrompt.freshSession}
          prompt={fillPrompt(phasePrompt.prompt, project.name)}
        />
      </section>

      {deepDives.length > 0 && project.phase !== 'done' && (
        <section className="section-tight">
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24 }}>
            <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>
              Worth a dedicated session
            </span>
            <p style={{ fontSize: 13, color: 'var(--smoke)', lineHeight: 1.5 }}>
              These parts were flagged as genuinely hard. Launching a separate AI session on each one
              gives it full attention.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {deepDives.map((s) => (
                <button
                  key={s.id}
                  className="pill pill-ghost"
                  onClick={() => {
                    window.specdrive.copyToClipboard(
                      fillPrompt(DEEP_DIVE_PROMPT, project.name, s.title)
                    )
                    toast('Deep-dive prompt copied — paste it into a fresh agent session')
                  }}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {tasks.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Build plan</h2>
            <span className="aside">
              {doneTasks} of {tasks.length} steps done
            </span>
          </div>
          <div className="card" style={{ padding: '24px 24px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${tasks.length ? (doneTasks / tasks.length) * 100 : 0}%` }}
                />
              </div>
              <span style={{ fontSize: 12, color: 'var(--smoke)', flex: 'none' }}>
                {Math.round((doneTasks / Math.max(tasks.length, 1)) * 100)}%
              </span>
            </div>
            <div className="task-list">
              {ordered.map((t) => (
                <div key={t.id} className={`task-row ${t.status.replace('_', '-')}`}>
                  <span className={`task-check ${t.status.replace('_', '-')}`}>
                    {t.status === 'done' && <TickIcon size={11} />}
                  </span>
                  <div className="body">
                    <div className="title">{t.title}</div>
                    {t.status !== 'done' && <div className="detail">{t.detail}</div>}
                    {t.note && <div className="note">{t.note}</div>}
                    {t.status === 'blocked' && (
                      <span className="badge" style={{ marginTop: 6 }}>
                        Blocked
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>The spec board</h2>
          <span className="aside">
            {specs.length ? `${specs.length} cards — your project’s memory` : 'Waiting for your first chat'}
          </span>
        </div>
        <SpecBoard specs={specs} freshIds={freshIds} />
      </section>

      <Wireframes bundle={bundle} />

      {activity.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Activity</h2>
          </div>
          <div className="activity">
            {[...activity]
              .reverse()
              .slice(0, 30)
              .map((a, i) => (
                <div key={i} className="activity-row">
                  <span className="time">{timeAgo(a.ts)}</span>
                  <span className="what">{a.summary}</span>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  )
}
