import React, { useEffect, useState } from 'react'
import type { AgentVerification, DetectedAgent } from '@shared/types'
import { useToast } from './Toast'

// The one implementation of "which AI tools are on this Mac, are they linked,
// and does the link really answer". It lives in the sidebar (compact) and on
// the Settings screen (roomier) — same detect/connect/verify logic, one copy.

/** Config path + launch command — technical detail, collapsed behind a disclosure
 *  so the plain-words status line and Test now button stay the focus. */
function AdvancedMeta({
  configPath,
  command,
  args
}: {
  configPath?: string
  command?: string
  args?: string[]
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!configPath && !command) return null
  return (
    <>
      <button className="disclosure" onClick={() => setOpen((o) => !o)}>
        {open ? 'Advanced ▾' : 'Advanced ▸'}
      </button>
      {open && (
        <>
          {configPath && (
            <p className="ad-meta">
              Config: <code>{configPath.replace(/^\/Users\/[^/]+/, '~')}</code>
            </p>
          )}
          {command && (
            <p className="ad-meta">
              Launches: <code>{command} {(args ?? []).join(' ')}</code>
            </p>
          )}
        </>
      )}
    </>
  )
}

export function AgentsPanel({
  agents,
  connect,
  variant = 'sidebar'
}: {
  agents: DetectedAgent[]
  connect: (id: DetectedAgent['id']) => Promise<void>
  variant?: 'sidebar' | 'settings'
}): React.JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [openAgent, setOpenAgent] = useState<DetectedAgent['id'] | 'other' | null>(null)
  const [checks, setChecks] = useState<Record<string, AgentVerification | 'checking'>>({})
  const [mcp, setMcp] = useState<{ serverPath: string; nodeBin: string }>()

  useEffect(() => {
    window.specdrive.getMcpInfo().then(setMcp).catch(() => {})
  }, [])

  const copyGenericConfig = (): void => {
    const snippet = JSON.stringify(
      {
        mcpServers: {
          specdrive: {
            command: mcp?.nodeBin ?? 'node',
            args: [mcp?.serverPath ?? '~/.specdrive/mcp/server.mjs']
          }
        }
      },
      null,
      2
    )
    window.specdrive.copyToClipboard(snippet)
    toast('Setup copied — paste it into your AI tool’s settings')
  }

  const runCheck = async (id: DetectedAgent['id']): Promise<void> => {
    setChecks((c) => ({ ...c, [id]: 'checking' }))
    try {
      const v = await window.specdrive.verifyAgent(id)
      setChecks((c) => ({ ...c, [id]: v }))
    } catch {
      setChecks((c) => ({
        ...c,
        [id]: { ok: false, detail: 'Check failed to run.', checkedAt: new Date().toISOString() }
      }))
    }
  }

  const installed = agents.filter((a) => a.installed)

  return (
    <div className={`agents-panel agents-${variant}`}>
      {installed.length === 0 && (
        <p className="agents-none">
          None found on this Mac yet. Install one (Claude Code, Cursor…) and relaunch SpecDrive — or
          connect any other AI agent below.
        </p>
      )}
      {installed.map((a, i) => (
        <div key={a.id}>
          <div
            className="agent-row clickable"
            style={{ '--i': i } as React.CSSProperties}
            role="button"
            tabIndex={0}
            onClick={() => {
              const next = openAgent === a.id ? null : a.id
              setOpenAgent(next)
              if (next && a.connected && !checks[a.id]) runCheck(a.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setOpenAgent(openAgent === a.id ? null : a.id)
            }}
          >
            <span className={`dot${a.connected ? ' on' : ''}`} />
            <span className="name">{a.name}</span>
            {variant === 'settings' && (
              <span className="agent-state">{a.connected ? 'Linked' : 'Not linked'}</span>
            )}
            {!a.connected && (
              <button
                className="link"
                disabled={busy === a.id}
                onClick={async (e) => {
                  e.stopPropagation()
                  setBusy(a.id)
                  try {
                    await connect(a.id)
                    // Never claim success without proof: run the real handshake.
                    const v = await window.specdrive.verifyAgent(a.id)
                    setChecks((c) => ({ ...c, [a.id]: v }))
                    setOpenAgent(a.id)
                    toast(
                      v.ok
                        ? `${a.name} linked — server verified for real`
                        : `${a.name}: config written but the link does NOT respond`
                    )
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
          {openAgent === a.id && (
            <div className="agent-detail">
              {a.connected ? (
                <>
                  {checks[a.id] === 'checking' && <p className="ad-line">Testing the real link…</p>}
                  {checks[a.id] && checks[a.id] !== 'checking' && (
                    <p className={`ad-line ${(checks[a.id] as AgentVerification).ok ? 'ok' : 'bad'}`}>
                      {(checks[a.id] as AgentVerification).ok ? '✓ Really works — ' : '✗ NOT working — '}
                      {(checks[a.id] as AgentVerification).detail}
                    </p>
                  )}
                  {!checks[a.id] && <p className="ad-line">Click “Test now” to prove the link.</p>}
                </>
              ) : (
                <p className="ad-line">Not connected yet — no “specdrive” entry in its config.</p>
              )}
              <AdvancedMeta configPath={a.configPath} command={a.command} args={a.args} />
              <p className="ad-meta faded">
                SpecDrive can see whether this link truly answers — not the agent’s account or plan.
              </p>
              {a.connected && (
                <button className="pill pill-quiet" style={{ marginTop: 6 }} onClick={() => runCheck(a.id)}>
                  Test now
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <div
        className="agent-row clickable"
        role="button"
        tabIndex={0}
        onClick={() => setOpenAgent(openAgent === 'other' ? null : 'other')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setOpenAgent(openAgent === 'other' ? null : 'other')
        }}
      >
        <span className="dot" />
        <span className="name" style={{ color: 'var(--smoke)' }}>
          Another agent?
        </span>
      </div>
      {openAgent === 'other' && (
        <div className="agent-detail">
          <p className="ad-line">
            Your board can talk to any AI tool that understands the shared standard — not just the
            ones listed here.
          </p>
          <p className="ad-meta faded">
            Copy this and paste it into your AI tool’s settings (an entry named “specdrive”).
          </p>
          <button className="pill pill-quiet" style={{ marginTop: 6 }} onClick={copyGenericConfig}>
            Copy the setup
          </button>
        </div>
      )}
    </div>
  )
}
