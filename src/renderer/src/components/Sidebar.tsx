import React, { useEffect, useState } from 'react'
import type { DetectedAgent, ProjectBundle } from '@shared/types'
import { useToast } from './Toast'
import { PHASE_COLOR } from '@/lib/phaseColors'

const PHASE_SHORT: Record<string, string> = {
  capture: 'Capturing idea',
  challenge: 'Challenging',
  research: 'Researching',
  risks: 'Hard parts',
  plan: 'Planning',
  build: 'Building',
  done: 'Built'
}

export function Sidebar({
  projects,
  agents,
  openId,
  onSelect,
  connect,
  onEgg
}: {
  projects: ProjectBundle[]
  agents: DetectedAgent[]
  openId: string | null
  onSelect: (id: string | null) => void
  connect: (id: DetectedAgent['id']) => Promise<void>
  onEgg: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(null), 3500)
    return () => clearTimeout(t)
  }, [confirmDelete])
  const installed = agents.filter((a) => a.installed)

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <button className="sidebar-brand" onClick={() => onSelect(null)} onDoubleClick={onEgg}>
        <span className="brand-stamp">
          SpecDrive
          <span className="brand-cursor" aria-hidden>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path
                d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L5.94 2.47a.5.5 0 0 0-.44.74Z"
                fill="#7b7ed8"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <span className="brand-cursor-pill">agents</span>
          </span>
        </span>
      </button>

      <div className="sidebar-label">Projects</div>
      <div className="sidebar-projects">
        {projects.map((b, i) => {
          const done = b.tasks.filter((t) => t.status === 'done').length
          const confirming = confirmDelete === b.project.id
          return (
            <div
              key={b.project.id}
              role="button"
              tabIndex={0}
              className={`side-item${openId === b.project.id ? ' active' : ''}`}
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => onSelect(b.project.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(b.project.id)
              }}
            >
              <span className="name">{b.project.name}</span>
              <span className="sub">
                <span
                  className="phase-dot"
                  style={{ '--phase-color': PHASE_COLOR[b.project.phase] } as React.CSSProperties}
                />
                {PHASE_SHORT[b.project.phase]}
                {b.tasks.length > 0 && ` · ${done}/${b.tasks.length}`}
              </span>
              <button
                className={`side-delete${confirming ? ' confirming' : ''}`}
                aria-label={confirming ? `Really delete ${b.project.name}` : `Delete ${b.project.name}`}
                onClick={async (e) => {
                  e.stopPropagation()
                  if (!confirming) {
                    setConfirmDelete(b.project.id)
                    return
                  }
                  setConfirmDelete(null)
                  await window.specdrive.deleteProject(b.project.id)
                  if (openId === b.project.id) onSelect(null)
                  toast(`"${b.project.name}" moved to SpecDrive's trash`)
                }}
              >
                {confirming ? 'Sure?' : '✕'}
              </button>
            </div>
          )
        })}
        <button className="side-new" onClick={() => onSelect(null)}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> New project
        </button>
      </div>

      <div className="sidebar-agents">
        <div className="sidebar-label" style={{ padding: '4px 10px 6px' }}>
          Your AI agents
        </div>
        {installed.length === 0 && (
          <div style={{ padding: '2px 10px 6px', fontSize: 11.5, color: 'var(--smoke)', lineHeight: 1.45 }}>
            None found yet. Install Claude Code or Cursor, then relaunch SpecDrive.
          </div>
        )}
        {installed.map((a, i) => (
          <div key={a.id} className="agent-row" style={{ '--i': i } as React.CSSProperties}>
            <span className={`dot${a.connected ? ' on' : ''}`} />
            <span className="name">{a.name}</span>
            {!a.connected && (
              <button
                className="link"
                disabled={busy === a.id}
                onClick={async () => {
                  setBusy(a.id)
                  try {
                    await connect(a.id)
                    toast(`${a.name} is now connected`)
                  } catch {
                    toast(`Could not connect ${a.name}`)
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {busy === a.id ? '…' : 'Connect'}
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
