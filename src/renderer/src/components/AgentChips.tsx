import React, { useState } from 'react'
import type { DetectedAgent } from '@shared/types'
import { TickIcon } from './Icons'
import { useToast } from './Toast'

export function AgentChips({
  agents,
  connect
}: {
  agents: DetectedAgent[]
  connect: (id: DetectedAgent['id']) => Promise<void>
}): React.JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const installed = agents.filter((a) => a.installed)

  if (!installed.length) {
    return (
      <div className="card">
        <p style={{ fontSize: 14, color: 'var(--smoke)', lineHeight: 1.5 }}>
          No AI coding agent found on this Mac yet. Install{' '}
          <a
            href="https://claude.com/claude-code"
            onClick={(e) => {
              e.preventDefault()
              window.specdrive.openExternal('https://claude.com/claude-code')
            }}
          >
            Claude Code
          </a>{' '}
          or Cursor, then come back — SpecDrive will spot it automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="agents-row">
      {installed.map((a) => (
        <div key={a.id} className="agent-chip">
          <span>{a.name}</span>
          {a.connected ? (
            <span className="badge badge-blue">
              <TickIcon size={10} />
              Connected
            </span>
          ) : a.install === 'auto' ? (
            <button
              className="pill pill-primary"
              disabled={busy === a.id}
              onClick={async () => {
                setBusy(a.id)
                try {
                  await connect(a.id)
                  toast(`${a.name} is now connected to SpecDrive`)
                } catch {
                  toast(`Could not connect ${a.name} automatically`)
                } finally {
                  setBusy(null)
                }
              }}
            >
              {busy === a.id ? 'Connecting…' : 'Connect'}
            </button>
          ) : (
            <button
              className="pill pill-quiet"
              onClick={() => {
                window.specdrive.copyToClipboard(a.manualCommand ?? '')
                toast('Setup instructions copied')
              }}
            >
              Copy setup
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
