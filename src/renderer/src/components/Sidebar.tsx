import React, { useState } from 'react'
import type { DetectedAgent, ProjectBundle } from '@shared/types'
import { PlaneIcon } from './Icons'
import { useToast } from './Toast'

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
  connect
}: {
  projects: ProjectBundle[]
  agents: DetectedAgent[]
  openId: string | null
  onSelect: (id: string | null) => void
  connect: (id: DetectedAgent['id']) => Promise<void>
}): React.JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const installed = agents.filter((a) => a.installed)

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <button className="sidebar-brand" onClick={() => onSelect(null)}>
        <span className="brand-orb">
          <PlaneIcon />
        </span>
        SpecDrive
      </button>

      <div className="sidebar-label">Projects</div>
      <div className="sidebar-projects">
        {projects.map((b) => {
          const done = b.tasks.filter((t) => t.status === 'done').length
          return (
            <button
              key={b.project.id}
              className={`side-item${openId === b.project.id ? ' active' : ''}`}
              onClick={() => onSelect(b.project.id)}
            >
              <span className="name">{b.project.name}</span>
              <span className="sub">
                <span className="phase-dot" />
                {PHASE_SHORT[b.project.phase]}
                {b.tasks.length > 0 && ` · ${done}/${b.tasks.length}`}
              </span>
            </button>
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
        {installed.map((a) => (
          <div key={a.id} className="agent-row">
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
