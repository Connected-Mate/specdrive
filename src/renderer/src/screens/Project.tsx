import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRun, ProjectBundle, Wireframe } from '@shared/types'
import type { EffectiveAgent } from '@shared/crew-chain.mjs'
import { promptNameFor, VERDICT_LABEL, SEVERITY_LABEL } from '@shared/crew-chain.mjs'
import { CopyButton } from '@/components/PromptCopy'
import { TickIcon } from '@/components/Icons'
import { FlowMap, type FlowThumb } from '@/components/FlowMap'
import { KitWireframe } from '@/components/wireframe-kit/KitWireframe'
import type { PlanWireframeNode } from '@/components/wireframe-kit/types'
import { CursorScene } from '@/components/scene/CursorScene'
import { useSceneAgents } from '@/components/scene/useSceneAgents'
import { PlanDoc } from '@/components/PlanDoc'
import { BoardDoc } from '@/components/BoardDoc'
import { BuildStrip } from '@/components/BuildStrip'
import { KeepInMind, keepInMindCount } from '@/components/KeepInMind'
import { OwnerNotes } from '@/components/OwnerNotes'
import { humanizeDuration } from '@/lib/labels'
import { WORLD_LINE, WORLD_WORD, worldColor, worldOf } from '@/lib/mode'
import { timeAgo } from '@/lib/useLive'

const LENS_LABEL: Record<string, string> = {
  adversarial: 'Looking for what breaks',
  'edge-cases': 'Edge cases',
  'verification-gap': 'What was never checked',
  'intent-alignment': 'Does it match what was asked'
}

const KIND_LABEL: Record<string, string> = {
  spike: 'Spike — prove it first',
  design: 'Design',
  chore: 'Housekeeping',
  test: 'Tests',
  security: 'Safety pass',
  review: 'Independent review',
  'safety-net': 'Safety net'
}

/** "1st", "2nd", "3rd", "4th"… */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

type Tab = 'board' | 'scenarios' | 'sketches' | 'blueprint' | 'plan' | 'activity' | 'memory'

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
            <div className={`scenario-gap${sc.status === 'walked' ? ' resolved' : ''}`}>
              <strong>{sc.status === 'walked' ? 'Was a gap, now settled:' : 'Gap:'}</strong> {sc.gapNote}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** "How we checked — <proof>" under a done task — the evidence, not just the checkmark. */
function ProofLine({ proof }: { proof: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const long = proof.length > 120
  return (
    <div className="proof-line">
      <span className="proof-label">How we checked —</span>{' '}
      <span className={`proof-text${long && !expanded ? ' clamped' : ''}`}>{proof}</span>
      {long && (
        <button className="proof-toggle" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function TaskRow({
  task,
  index,
  sub,
  subLabel,
  childCount,
  doneChildren,
  collapsed,
  onToggle,
  waitsFor,
  projectId,
  comments
}: {
  task: ProjectBundle['tasks'][number]
  index: number
  sub?: boolean
  /** "3.2" — the sub-step's place in its block */
  subLabel?: string
  childCount?: number
  doneChildren?: number
  collapsed?: boolean
  onToggle?: () => void
  waitsFor?: number
  projectId: string
  comments: ProjectBundle['comments']
}): React.JSX.Element {
  const duration =
    task.status === 'done' && task.startedAt && task.doneAt
      ? humanizeDuration(new Date(task.doneAt).getTime() - new Date(task.startedAt).getTime())
      : task.status === 'in_progress' && task.startedAt
        ? `running for ${humanizeDuration(Date.now() - new Date(task.startedAt).getTime())}`
        : null

  const isStaleDone = task.status === 'done' && !!task.stale
  const lastAttempt = task.attempts && task.attempts.length ? task.attempts[task.attempts.length - 1] : undefined
  const failedLabel =
    (task.attempts?.length ?? 0) >= 2 ? 'Tried 2 ways — needs your call' : "Didn't work — trying differently"

  return (
    <div
      className={`task-row ${task.status.replace('_', '-')}${sub ? ' sub' : ''}${isStaleDone ? ' stale' : ''}`}
      style={{ '--i': index } as React.CSSProperties}
    >
      {isStaleDone ? (
        <span className="task-check-pill">Needs a quick re-check</span>
      ) : (
        <span className={`task-check ${task.status.replace('_', '-')}`}>
          {task.status === 'done' && <TickIcon size={10} />}
        </span>
      )}
      <div className="body">
        <div className="title-line">
          {subLabel && <span className="sub-label">{subLabel}</span>}
          <span className="title">{task.title}</span>
          {duration && (
            <span className={`task-duration${task.status === 'in_progress' ? ' running' : ''}`}>
              {duration}
            </span>
          )}
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
        {task.status !== 'done' && task.status !== 'failed' && <div className="detail">{task.detail}</div>}
        {task.status === 'failed' && (
          <div className="task-fail">
            <span className="badge badge-gap">{failedLabel}</span>
            {lastAttempt?.note && <div className="fail-note">{lastAttempt.note}</div>}
          </div>
        )}
        {task.status === 'deferred' && (
          <div className="task-fail">
            <span className="badge">Set aside for now</span>
            {lastAttempt?.note && <div className="fail-note">{lastAttempt.note}</div>}
          </div>
        )}
        {task.note && <div className="note">{task.note}</div>}
        {task.status === 'done' && task.proof && <ProofLine proof={task.proof} />}
        {task.proofRun && (
          <div className={`proof-run${task.proofRun.exitCode === 0 ? ' ok' : ' bad'}`}>
            <span className="proof-run-label">
              {task.proofRun.exitCode === 0 ? 'Check ran and passed' : task.proofRun.timedOut ? 'Check timed out' : 'Check ran and failed'}
              {' · '}
              {(task.proofRun.durationMs / 1000).toFixed(1)}s
            </span>
            <code className="proof-run-cmd">{task.proofRun.command}</code>
          </div>
        )}
        {task.status === 'done' && task.proofRunSkipped && (
          <div className="stale-reason">
            No automatic check for this step —{' '}
            {typeof task.proofRunSkipped === 'string' ? task.proofRunSkipped : task.proofRunSkipped.reason}
          </div>
        )}
        {task.status === 'done' && (task.changedFiles || task.acceptanceResults || (!task.proofRun && !task.proofRunSkipped)) && (
          <div className="evidence-row">
            {!task.proofRun && !task.proofRunSkipped && (
              <span className="evidence claim" title="No command ran and the board saw no file change — this step rests on the agent's word">
                Written claim only
              </span>
            )}
            {task.changedFiles && (
              <span className="evidence" title={task.changedFiles.files.join('\n')}>
                {task.changedFiles.total} file{task.changedFiles.total === 1 ? '' : 's'} changed
              </span>
            )}
            {task.acceptanceResults?.map((a) => (
              <span key={a.specId} className={`evidence acc-${a.result}`} title={`${a.title}\n${a.how}`}>
                {a.result === 'pass' ? '✓' : a.result === 'fail' ? '✗' : '?'} {a.title}
                {a.result === 'not_testable' ? ' — not testable' : ''}
              </span>
            ))}
            {task.doneBy && <span className="evidence faded">by {task.doneBy.client}</span>}
          </div>
        )}
        {isStaleDone && task.staleReason && <div className="stale-reason">{task.staleReason}</div>}
        <div className="task-badges">
          {task.status === 'blocked' && <span className="badge">Blocked</span>}
          {!!waitsFor && (
            <span className="badge waits-badge">
              Waits for {waitsFor} step{waitsFor > 1 ? 's' : ''}
            </span>
          )}
          {task.status === 'done' && (task.attempts?.length ?? 0) > 0 && (
            <span className="badge">Worked on the {ordinal((task.attempts?.length ?? 0) + 1)} try</span>
          )}
          {!!task.reopenCount && task.reopenCount > 0 && (
            <span className={`badge${task.reopenCount > 2 ? ' badge-gap' : ''}`}>
              {task.reopenCount > 2 ? `Reopened ${task.reopenCount}× — waiting for you` : `Reopened ${task.reopenCount}×`}
            </span>
          )}
          {task.kind && <span className="badge">{KIND_LABEL[task.kind] ?? task.kind}</span>}
          {task.lens && <span className="badge">{LENS_LABEL[task.lens] ?? task.lens}</span>}
        </div>
        <OwnerNotes projectId={projectId} target={{ kind: 'task', id: task.id }} comments={comments ?? []} />
      </div>
    </div>
  )
}

function BlueprintTab({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  if (!bundle.planDoc) {
    return (
      <div className="plan-empty">
        <span className="rail-mini-label">Nothing written yet</span>
        <h2>Your plan gets written here</h2>
        <p>
          When you reach the “Plan” step, your AI agent writes this page for you — in plain words,
          like an article you can read end to end.
        </p>
        <ul className="plan-empty-list">
          <li>
            <span className="k">Chapters</span>
            What you are building, and how it holds together.
          </li>
          <li>
            <span className="k">Decisions</span>
            Every choice made, and the reason behind it.
          </li>
          <li>
            <span className="k">Risks</span>
            The parts we know are fragile, named out loud.
          </li>
          <li>
            <span className="k">Questions</span>
            The few things only you can answer.
          </li>
        </ul>
        <p className="plan-empty-foot">
          Copy the “Plan” prompt from the guide on the right to get it started.
        </p>
      </div>
    )
  }
  return <PlanDoc doc={bundle.planDoc} />
}

function PlanTab({
  bundle,
  onOpenPlan
}: {
  bundle: ProjectBundle
  onOpenPlan: () => void
}): React.JSX.Element {
  const { tasks } = bundle
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Keep "running for X min" ticking on in-progress steps even with no new events.
  const [, forceTick] = useState(0)
  const hasRunning = tasks.some((t) => t.status === 'in_progress')
  useEffect(() => {
    if (!hasRunning) return undefined
    const t = setInterval(() => forceTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [hasRunning])

  const staleCount = tasks.filter((t) => t.status === 'done' && t.stale).length
  const failedCount = tasks.filter((t) => t.status === 'failed').length
  const [explainerSeen] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem('specdrive:recheck-explainer-seen')
    } catch {
      return true
    }
  })
  useEffect(() => {
    if ((staleCount > 0 || failedCount > 0) && !explainerSeen) {
      try {
        localStorage.setItem('specdrive:recheck-explainer-seen', '1')
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleCount, failedCount])

  if (!tasks.length) {
    return (
      <div className="empty">
        <div className="art">No plan yet</div>
        The work list appears here once the “Plan” step runs —<br />
        small ordered steps, each checked off as your product gets built.
      </div>
    )
  }
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
  const waitsFor = (t: ProjectBundle['tasks'][number]): number =>
    (t.dependsOn ?? []).filter((id) => tasks.find((x) => x.id === id)?.status !== 'done').length

  let row = 0
  const noOpenComments = !(bundle.comments ?? []).some((c) => c.status === 'open')
  return (
    <>
      <BuildStrip bundle={bundle} onOpenPlan={onOpenPlan} />
      <div className="plan-wrap">
      {bundle.drift?.moved && (
        <div className="plandoc-callout tone-risk drift-banner">
          <span className="tone-badge">Heads up</span>
          <p className="drift-text">
            The code has changed {bundle.drift.commits} time{bundle.drift.commits === 1 ? '' : 's'} since
            the last verified step. Ask your agent to re-check before trusting the green marks.
          </p>
        </div>
      )}
      {noOpenComments && (
        <p className="drop-hint">Click a step to leave a note — your agent reads it on its next pass.</p>
      )}
      {(staleCount > 0 || failedCount > 0) && (
        <div className="recheck-summary">
          <p className="recheck-line">
            {[
              staleCount > 0 ? `${staleCount} step${staleCount > 1 ? 's' : ''} need a quick re-check` : null,
              failedCount > 0 ? `${failedCount} didn’t work yet` : null
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {!explainerSeen && (
            <p className="recheck-explainer">
              Later steps sometimes change what earlier steps relied on — the AI re-checks those before moving
              on.
            </p>
          )}
        </div>
      )}
      {roots.map((t, rootIdx) => {
        const kids = childrenOf(t.id)
        const isCollapsed = collapsed.has(t.id)
        const doneKids = kids.filter((k) => k.status === 'done').length
        // A step with sub-steps is a BLOCK: it is finished only when its parts
        // are, so it carries its own count and its parts sit inside it.
        return (
          <div
            className={`step-block${kids.length ? ' has-kids' : ''}${t.status === 'in_progress' ? ' running' : ''}${t.status === 'done' && !t.stale ? ' done' : ''}`}
            key={t.id}
          >
            <div className="step-number" aria-hidden>
              {rootIdx + 1}
            </div>
            <div className="step-block-body">
              <TaskRow
                task={t}
                index={row++}
                childCount={kids.length || undefined}
                doneChildren={doneKids}
                collapsed={isCollapsed}
                onToggle={() => toggle(t.id)}
                waitsFor={waitsFor(t)}
                projectId={bundle.project.id}
                comments={bundle.comments}
              />
              {kids.length > 0 && (
                <div className="step-block-progress" aria-hidden>
                  <span style={{ width: `${Math.round((doneKids / kids.length) * 100)}%` }} />
                </div>
              )}
              {!isCollapsed &&
                kids.map((k, ki) => (
                  <TaskRow
                    key={k.id}
                    task={k}
                    index={row++}
                    sub
                    subLabel={`${rootIdx + 1}.${ki + 1}`}
                    waitsFor={waitsFor(k)}
                    projectId={bundle.project.id}
                    comments={bundle.comments}
                  />
                ))}
            </div>
          </div>
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

  // A sheet over the map closes the way every sheet does.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

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
        <div className={`flowmap-pane${open ? ' with-open' : ''}`}>
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
            caption="The map of your product — each arrow is something the user does. Click a screen to see its sketch full size."
          />
        </div>
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
        <div
          className="wireframe-overlay"
          role="presentation"
          onClick={() => setOpen(null)}
        >
        <div
          className="wireframe-expanded"
          role="dialog"
          aria-modal="true"
          aria-label={`${open.screen} — ${open.title}`}
          onClick={(e) => e.stopPropagation()}
        >
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

/** "Agents you can run here" — the effective crew for this project, each with
 *  its slash command and a one-click copy of the ready-to-paste brief. */
function CrewStrip({ bundle }: { bundle: ProjectBundle }): React.JSX.Element | null {
  const active = useMemo(
    () => (bundle.agents ?? []).filter((a) => !a.disabled && !a.supersededBy),
    [bundle.agents]
  )
  const [briefs, setBriefs] = useState<Record<string, string>>({})
  const ids = active.map((a) => a.id).join(',')
  useEffect(() => {
    let cancelled = false
    for (const a of active) {
      window.specdrive
        .agentBrief(a.id, bundle.project.id)
        .then((b) => {
          if (!cancelled) setBriefs((m) => ({ ...m, [a.id]: b }))
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, bundle.project.id])

  if (!active.length) return null
  return (
    <div className="crew-strip">
      <span className="crew-strip-label">Agents you can run here</span>
      <div className="crew-strip-chips">
        {active.map((a) => (
          <div key={a.id} className="crew-chip">
            <span aria-hidden>{a.emoji}</span>
            <span className="crew-chip-name">{a.name}</span>
            <code className="crew-chip-slash">/mcp__specdrive__{promptNameFor(a.slug)}</code>
            <CopyButton text={briefs[a.id] ?? ''} label="Copy prompt" quiet />
          </div>
        ))}
      </div>
    </div>
  )
}

/** One report, read like a spec card — the same entrance the board's specs
 *  get, so a report an agent just posted back is just as unmissable. */
function AgentReportCard({
  run,
  agent,
  i
}: {
  run: AgentRun
  agent: EffectiveAgent
  i: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <article className="spec-card crew-run-card" style={{ '--i': i } as React.CSSProperties}>
      <div className="crew-run-head">
        <span aria-hidden>{agent.emoji}</span>
        <h4 style={{ marginRight: 'auto' }}>{agent.name}</h4>
        <span className={`verdict-pill verdict-${run.verdict}`}>{VERDICT_LABEL[run.verdict]}</span>
        <span className="crew-run-when">{timeAgo(run.at)}</span>
      </div>
      <p className="crew-run-summary">{run.summary}</p>
      {run.findings.length > 0 && (
        <>
          <button className="disclosure" onClick={() => setOpen((o) => !o)}>
            {open
              ? 'Hide findings ▾'
              : `See ${run.findings.length} finding${run.findings.length > 1 ? 's' : ''} ▸`}
          </button>
          {open && (
            <div className="crew-findings">
              {run.findings.map((f, fi) => (
                <div key={fi} className="crew-finding">
                  <span className={`severity-tag severity-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
                  <div className="crew-finding-body">
                    <span className="crew-finding-title">{f.title}</span>
                    {f.detail && <span className="crew-finding-detail">{f.detail}</span>}
                    {f.where && <span className="crew-finding-where">{f.where}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </article>
  )
}

/** Every report posted back on this project, newest first — the crew's side
 *  of the diary. */
function AgentReports({ bundle }: { bundle: ProjectBundle }): React.JSX.Element | null {
  const rows = useMemo(() => {
    const out: { run: AgentRun; agent: EffectiveAgent }[] = []
    for (const agent of bundle.agents ?? []) {
      for (const run of agent.runs ?? []) {
        if (run.projectId === bundle.project.id) out.push({ run, agent })
      }
    }
    return out.sort((a, b) => (a.run.at < b.run.at ? 1 : -1))
  }, [bundle.agents, bundle.project.id])

  if (!rows.length) return null
  return (
    <section className="crew-reports">
      <h3>Agent reports</h3>
      <div className="crew-runs">
        {rows.map((r, i) => (
          <AgentReportCard key={r.run.id} run={r.run} agent={r.agent} i={i} />
        ))}
      </div>
    </section>
  )
}

export function Project({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  const { project, specs, tasks, wireframes, activity } = bundle
  const [tab, setTab] = useState<Tab>('board')
  const { agents: crew, spotlight } = useSceneAgents(bundle)

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

  // Automated visual checks can force a tab. It wins over the auto-jump below,
  // which would otherwise pull the screenshot back to the build steps.
  useEffect(() => {
    const h = (e: Event): void => {
      autoTabbed.current = true
      setTab((e as CustomEvent<Tab>).detail)
    }
    window.addEventListener('specdrive:open-tab', h)
    return () => window.removeEventListener('specdrive:open-tab', h)
  }, [])

  useEffect(() => {
    if (!autoTabbed.current && project.phase === 'build' && tasks.length) {
      setTab('plan')
      autoTabbed.current = true
    }
  }, [project.phase, tasks.length])

  const world = worldOf(project.phase)
  const accent = worldColor(project.phase)
  // The spec cluster keeps a dusk hue even while building, so the two sides
  // stay told apart by colour and not only by position.
  const specAccent = world === 'spec' ? accent : '#d98d63'
  const memoCount = keepInMindCount(bundle)

  const specTabs: { id: Tab; label: string; count: number }[] = [
    { id: 'board', label: 'Board', count: specs.length },
    { id: 'scenarios', label: 'Scenarios', count: bundle.scenarios.length },
    { id: 'sketches', label: 'Screens', count: wireframes.length },
    { id: 'blueprint', label: 'The plan', count: bundle.planDoc ? 1 : 0 }
  ]
  const buildTabs: { id: Tab; label: string; count: number }[] = [
    { id: 'plan', label: 'Build steps', count: tasks.length }
  ]
  // The diary and the memory sit apart on the right: neither is a mode of
  // work, both are things you glance at.
  const asideTabs: { id: Tab; label: string; count: number }[] = [
    { id: 'activity', label: 'Activity', count: activity.length }
  ]

  const renderTab = (t: { id: Tab; label: string; count: number }): React.JSX.Element => (
    <button
      key={t.id}
      role="tab"
      aria-selected={tab === t.id}
      className={`tab${tab === t.id ? ' active' : ''}`}
      onClick={() => setTab(t.id)}
    >
      {t.label}
      {t.count > 0 && (t.id === 'board' || t.id === 'plan') && (
        <span className="count">{t.count}</span>
      )}
    </button>
  )

  // One plain sentence under the tabs so nobody gets lost between them.
  const TAB_HINT: Record<Tab, string> = {
    board: 'Everything we know and decided about your product — its memory, filled live by the AI.',
    scenarios: 'Short stories of someone using your product, walked step by step to find holes before code.',
    sketches: 'Rough sketches of each screen, and the map of how they link together.',
    blueprint: 'The plan, readable like a magazine page: what we build, how, the decisions and the risks.',
    plan: 'The ordered to-do list the AI follows while building — each step verified before it turns green.',
    activity: 'The diary: every change the AI made to this project, most recent first.',
    memory: 'The things this project must never forget — rules, papers, decisions, open questions.'
  }

  return (
    <main
      className={`content world-${world}`}
      style={{ '--world-color': accent } as React.CSSProperties}
    >
      <CursorScene
        variant="header"
        word={project.name}
        caption={
          <>
            <span className="scene-mode">{WORLD_WORD[world]}</span>
            {project.oneLiner || WORLD_LINE[world]}
          </>
        }
        agents={crew}
        spotlight={spotlight}
        awake={specs.length === 0}
      />
      <div className="tab-bar" role="tablist" aria-label="Project sections">
        <div
          className={`tab-cluster${world === 'spec' ? ' current' : ''}`}
          style={
            { '--cluster-color': specAccent, '--cluster-soft': `${specAccent}1f` } as React.CSSProperties
          }
        >
          <span className="cluster-label">Spec</span>
          <div className="tabs">{specTabs.map(renderTab)}</div>
        </div>
        <div
          className={`tab-cluster${world === 'build' ? ' current' : ''}`}
          style={
            {
              '--cluster-color': worldColor('build'),
              '--cluster-soft': `${worldColor('build')}1f`
            } as React.CSSProperties
          }
        >
          <span className="cluster-label">Build</span>
          <div className="tabs">{buildTabs.map(renderTab)}</div>
        </div>
        <div className="tab-cluster keep">
          <div className="tabs">
            {asideTabs.map(renderTab)}
            <button
              role="tab"
              aria-selected={tab === 'memory'}
              className={`tab${tab === 'memory' ? ' active' : ''}`}
              onClick={() => setTab('memory')}
            >
              Keep in mind
              {memoCount > 0 && <span className="count">{memoCount}</span>}
            </button>
          </div>
        </div>
      </div>
      <p className="tab-hint">{TAB_HINT[tab]}</p>
      <div className="content-body">
        {tab === 'board' && (
          <>
            <CrewStrip bundle={bundle} />
            <BoardDoc bundle={bundle} specs={specs} freshIds={freshIds} projectName={project.name} />
            <AgentReports bundle={bundle} />
          </>
        )}
        {tab === 'scenarios' && <ScenariosTab bundle={bundle} />}
        {tab === 'blueprint' && <BlueprintTab bundle={bundle} />}
        {tab === 'plan' && <PlanTab bundle={bundle} onOpenPlan={() => setTab('blueprint')} />}
        {tab === 'sketches' && <SketchesTab bundle={bundle} />}
        {tab === 'activity' && <ActivityTab bundle={bundle} />}
        {tab === 'memory' && <KeepInMind bundle={bundle} />}
      </div>
    </main>
  )
}
