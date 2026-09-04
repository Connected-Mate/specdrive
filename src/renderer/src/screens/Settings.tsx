import React, { useEffect, useState } from 'react'
import type { AboutInfo, AppSettings, DetectedAgent } from '@shared/types'
import { AgentsPanel } from '@/components/AgentsPanel'
import { useToast } from '@/components/Toast'

// Settings is a sheet over the board — like ⌘, in any Mac app — not another
// screen with its own menus. Three tabs, one calm paper panel, Escape closes.

type Tab = 'general' | 'agents'

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'AI agents' }
]

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

function Switch({
  checked,
  label,
  hint,
  onChange
}: {
  checked: boolean
  label: string
  hint: string
  onChange: (next: boolean) => void
}): React.JSX.Element {
  return (
    <label className="set-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="set-switch-body">
        <span className="set-switch-label">{label}</span>
        <span className="set-switch-hint">{hint}</span>
      </span>
    </label>
  )
}

function Group({
  title,
  intro,
  children
}: {
  title: string
  intro?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="set-group">
      <h3>{title}</h3>
      {intro && <p className="set-intro">{intro}</p>}
      {children}
    </section>
  )
}

export function Settings({
  agents,
  connect,
  closing = false,
  onClose
}: {
  agents: DetectedAgent[]
  connect: (id: DetectedAgent['id']) => Promise<void>
  /** The sheet is on its way out — play the exit, the parent unmounts after */
  closing?: boolean
  onClose: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('general')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateNote, setUpdateNote] = useState('')

  useEffect(() => {
    window.specdrive.getSettings().then(setSettings).catch(() => {})
    window.specdrive.getAbout().then(setAbout).catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = async (next: Partial<AppSettings>): Promise<void> => {
    setSettings((s) => (s ? { ...s, ...next } : s))
    const saved = await window.specdrive.setSettings(next)
    setSettings(saved)
  }

  return (
    <div className={`settings-overlay${closing ? ' closing' : ''}`} onClick={onClose} role="presentation">
      <div
        className={`settings-panel${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-head">
          <h1>Settings</h1>
          <div className="tabs" role="tablist" aria-label="Settings sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button className="settings-close" aria-label="Close settings (Esc)" title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="settings-body">
          {tab === 'general' && (
            <>
              <Group title="What SpecDrive does on its own" intro="Two small habits you can turn off at any time.">
                {settings && (
                  <>
                    <Switch
                      checked={settings.agentsMdForNewProjects}
                      label="Write the house rules into the code folder"
                      hint="New projects get an AGENTS.md next to their code, so tools that don’t talk to SpecDrive still read the rules. Each project can override this in “Keep in mind”."
                      onChange={(v) => patch({ agentsMdForNewProjects: v })}
                    />
                    <Switch
                      checked={settings.notifications}
                      label="Tell me when something important happens"
                      hint="A Mac notification when a step gets blocked, a project moves on, or your agent answers a note — only while SpecDrive is in the background."
                      onChange={(v) => patch({ notifications: v })}
                    />
                  </>
                )}
              </Group>

              <Group title="Version" intro="SpecDrive updates itself in the background. You can also ask now.">
                <div className="set-row">
                  <span className="set-row-key">Running</span>
                  <span className="set-row-value">SpecDrive {about?.version ?? '…'}</span>
                  <button
                    className="pill pill-white"
                    disabled={checking}
                    onClick={async () => {
                      setChecking(true)
                      setUpdateNote('')
                      try {
                        setUpdateNote(await window.specdrive.checkForUpdates())
                      } catch {
                        setUpdateNote('The check could not run just now.')
                      } finally {
                        setChecking(false)
                      }
                    }}
                  >
                    {checking ? 'Checking…' : 'Check for updates'}
                  </button>
                </div>
                {updateNote && <p className="set-note">{updateNote}</p>}
              </Group>

              <Group
                title="Where your things live"
                intro="Everything is plain files on this Mac. Nothing leaves it unless you send it somewhere yourself."
              >
                <div className="set-row">
                  <span className="set-row-key">Your projects</span>
                  <code className="set-row-value">{about ? shortPath(about.dataDir) : '…'}</code>
                  <button className="pill pill-quiet" onClick={() => window.specdrive.revealInFinder('data')}>
                    Show in Finder
                  </button>
                </div>
                <div className="set-row">
                  <span className="set-row-key">The link agents use</span>
                  <code className="set-row-value">{about ? shortPath(about.serverPath) : '…'}</code>
                  <button
                    className="pill pill-quiet"
                    onClick={() => {
                      if (about) {
                        window.specdrive.copyToClipboard(about.serverPath)
                        toast('Path copied')
                      }
                    }}
                  >
                    Copy
                  </button>
                  <button className="pill pill-quiet" onClick={() => window.specdrive.revealInFinder('server')}>
                    Show in Finder
                  </button>
                </div>
              </Group>
            </>
          )}

          {tab === 'agents' && (
            <Group
              title="Your AI agents"
              intro="The coding tools on this Mac. A linked one can read this board and fill it in as you talk to it."
            >
              <AgentsPanel agents={agents} connect={connect} variant="settings" />
            </Group>
          )}

        </div>
      </div>
    </div>
  )
}
