import React from 'react'
import type { ProjectBundle, Task } from '@shared/types'
import { humanizeDuration } from '@/lib/labels'

// "Where we are" — the first thing to read on the build side. Plain counts,
// the step running right now, and the one that comes next. No percentages:
// a number of steps is something the owner can actually check.

function nextUp(tasks: Task[]): Task | undefined {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id))
  return [...tasks]
    .filter((t) => t.status === 'todo')
    .sort((a, b) => a.order - b.order)
    .find((t) => (t.dependsOn ?? []).every((id) => done.has(id)))
}

export function BuildStrip({
  bundle,
  onOpenPlan
}: {
  bundle: ProjectBundle
  onOpenPlan: () => void
}): React.JSX.Element {
  const { tasks } = bundle
  const done = tasks.filter((t) => t.status === 'done' && !t.stale).length
  const todo = tasks.filter((t) => t.status === 'todo' || t.status === 'blocked').length
  const recheck = tasks.filter((t) => t.status === 'done' && t.stale).length
  const failed = tasks.filter((t) => t.status === 'failed').length
  const started = tasks
    .filter((t) => t.status === 'in_progress')
    .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
  const running = started[started.length - 1]
  const next = nextUp(tasks)

  const stats: { n: number; label: string; tone?: string }[] = [
    { n: done, label: done === 1 ? 'step done' : 'steps done' },
    { n: started.length, label: 'under way' },
    { n: todo, label: 'to do' },
    { n: recheck, label: recheck === 1 ? 'needs a re-check' : 'need a re-check', tone: 'warn' },
    { n: failed, label: 'didn’t work', tone: 'warn' }
  ]

  return (
    <div className="build-strip">
      <div className="build-stats">
        {stats
          .filter((s, i) => i === 0 || i === 2 || s.n > 0)
          .map((s) => (
            <span key={s.label} className={`build-stat${s.tone ? ` ${s.tone}` : ''}`}>
              <span className="n">{s.n}</span>
              {s.label}
            </span>
          ))}
        <button className="build-plan-link" onClick={onOpenPlan}>
          Open the plan
        </button>
      </div>
      <div className="build-now">
        {running ? (
          <p className="build-line running">
            <span className="live-dot" aria-hidden="true" />
            <strong>Running now</strong> — {running.title}
            <span className="build-elapsed">
              {running.startedAt
                ? ` · ${humanizeDuration(Date.now() - new Date(running.startedAt).getTime())}`
                : ''}
              {running.claimedBy ? ' · an agent is on it' : ''}
              {started.length > 1
                ? ` · ${started.length - 1} other step${started.length > 2 ? 's' : ''} under way`
                : ''}
            </span>
          </p>
        ) : (
          <p className="build-line">
            <strong>Nothing running</strong> — copy the build prompt on the right to start the next
            step.
          </p>
        )}
        {next && (
          <p className="build-line next">
            <strong>Next</strong> — {next.title}
          </p>
        )}
        {!next && !running && todo === 0 && (
          <p className="build-line next">
            <strong>Next</strong> — every step is checked off.
          </p>
        )}
      </div>
    </div>
  )
}
