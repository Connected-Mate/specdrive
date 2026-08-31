import React, { useEffect, useRef, useState } from 'react'
import type { LiveSession, ProjectBundle } from '@shared/types'
import { PHASES } from '@shared/types'
import { ADOPT_PROMPT, DEEP_DIVE_PROMPT, PHASE_PROMPTS, START_PROMPT, fillPrompt, type McpInfo } from '@shared/prompts'
import { GlitchBadge } from './glitch/GlitchBadge'
import { timeAgo } from '@/lib/useLive'
import { CopyIcon, TickIcon } from './Icons'
import { useToast } from './Toast'
import { PHASE_COLOR } from '@/lib/phaseColors'

const PHASE_LABEL: Record<string, string> = {
  capture: 'Idea',
  challenge: 'Challenge',
  research: 'Research',
  risks: 'Hard parts',
  plan: 'Plan',
  build: 'Build',
  done: 'Done'
}

/** Copy button with inline "Copied ✓" feedback. */
function CopyButton({ text, label }: { text: string; label: string }): React.JSX.Element {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  return (
    <button
      className={`pill pill-primary${copied ? ' copied' : ''}`}
      onClick={() => {
        window.specdrive.copyToClipboard(text)
        toast('Prompt copied — paste it into your AI agent')
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1600)
      }}
    >
      {copied ? (
        <>
          <TickIcon size={12} />
          Copied
        </>
      ) : (
        <>
          <CopyIcon />
          {label}
        </>
      )}
    </button>
  )
}

function useLiveSessions(): LiveSession[] {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  useEffect(() => {
    const refresh = (): void => {
      window.specdrive.listSessions().then(setSessions).catch(() => {})
    }
    refresh()
    const off = window.specdrive.onProjectsChanged(refresh)
    const t = setInterval(refresh, 20000) // expire stale sessions even when quiet
    return () => {
      off()
      clearInterval(t)
    }
  }, [])
  return sessions
}

function useMcpInfo(): McpInfo | undefined {
  const [info, setInfo] = useState<McpInfo>()
  useEffect(() => {
    window.specdrive.getMcpInfo().then(setInfo).catch(() => {})
  }, [])
  return info
}

const CLIENT_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  claude: 'Claude Code',
  cursor: 'Cursor',
  'cursor-vscode': 'Cursor',
  windsurf: 'Windsurf',
  'gemini-cli': 'Gemini',
  codex: 'Codex'
}

function clientLabel(raw: string): string {
  return CLIENT_LABEL[raw.toLowerCase()] ?? raw
}

/** "An agent is talking to the board right now" — the glitch badge design. */
function LiveSessionCard({ sessions }: { sessions: LiveSession[] }): React.JSX.Element | null {
  if (!sessions.length) return null
  const s = sessions[0]
  return (
    <div className="live-card">
      <div className="live-row">
        <GlitchBadge word={clientLabel(s.client)} />
        <span className="rail-mini-label" style={{ marginLeft: 'auto' }}>
          Live
        </span>
      </div>
      <p className="live-meta">
        {s.project ? (
          <>
            Working on <strong>{s.project}</strong>
          </>
        ) : (
          'Reading the board'
        )}
        {' · '}
        <strong>{s.lastTool}</strong> {timeAgo(s.lastToolAt)}
        {s.version ? ` · v${s.version}` : ''}
        {sessions.length > 1 ? ` · +${sessions.length - 1} more session${sessions.length > 2 ? 's' : ''}` : ''}
      </p>
    </div>
  )
}

/** Right rail: always-visible guidance — where you are, what to do next. */
export function GuideRail({ bundle }: { bundle: ProjectBundle | null }): React.JSX.Element {
  const toast = useToast()
  const sessions = useLiveSessions()
  const mcp = useMcpInfo()
  const [startMode, setStartMode] = useState<'new' | 'existing'>('new')

  if (!bundle) {
    const starter = startMode === 'new' ? START_PROMPT : ADOPT_PROMPT
    return (
      <aside className="rail">
        <div className="rail-drag" />
        <div className="rail-body">
          <LiveSessionCard sessions={sessions} />
          <div className="next-step">
            <span className="rail-mini-label">{sessions.length ? 'In session' : 'Start here'}</span>
            <h2>
              {sessions.length
                ? `${clientLabel(sessions[0].client)} is on it`
                : startMode === 'new'
                  ? 'Tell your idea'
                  : 'Improve an existing app'}
            </h2>
            <div className="start-mode-toggle" role="tablist" aria-label="What are you starting from?">
              <button
                role="tab"
                aria-selected={startMode === 'new'}
                className={`pill${startMode === 'new' ? ' pill-primary' : ''}`}
                onClick={() => setStartMode('new')}
              >
                New idea
              </button>
              <button
                role="tab"
                aria-selected={startMode === 'existing'}
                className={`pill${startMode === 'existing' ? ' pill-primary' : ''}`}
                onClick={() => setStartMode('existing')}
              >
                I already have an app
              </button>
            </div>
            <p className="how">
              {sessions.length
                ? 'An agent is already talking to the board — keep the conversation going in its chat. Starting a separate, brand-new chat? Paste the starter prompt there.'
                : startMode === 'new'
                  ? 'Copy this prompt, paste it into a connected AI agent (Claude Code, Cursor…), and describe what you want to build — in your own words. Your project will appear here on its own.'
                  : 'Your app already exists? Copy this prompt instead — the agent studies your real code and documents first, then plans your changes without breaking what works.'}
            </p>
            <CopyButton text={fillPrompt(starter, '', undefined, mcp)} label="Copy the starter prompt" />
            <div className="prompt-peek">{fillPrompt(starter, '', undefined, mcp)}</div>
          </div>
        </div>
      </aside>
    )
  }

  const { project, specs } = bundle
  const projectSessions = sessions.filter(
    (x) =>
      x.project === bundle.project.id ||
      (x.project ?? '').toLowerCase() === bundle.project.name.toLowerCase()
  )
  const liveHere = projectSessions.length > 0
  const phasePrompt = PHASE_PROMPTS.find((p) => p.phase === project.phase) ?? PHASE_PROMPTS[0]
  const currentIdx = PHASES.indexOf(project.phase)
  const deepDives = specs.filter((s) => s.category === 'risks' && (s.difficulty ?? 0) >= 4)
  const phaseColor = PHASE_COLOR[project.phase]

  return (
    <aside className="rail" style={{ '--phase-color': phaseColor } as React.CSSProperties}>
      <div className="rail-drag" />
      <div className="rail-body">
        <LiveSessionCard sessions={projectSessions} />
        <div className="step-figure">
          <span className="mini" style={{ color: phaseColor }}>
            Step {Math.min(currentIdx + 1, 6)} of 6
          </span>
          <span className="big">{PHASE_LABEL[project.phase]}</span>
        </div>

        <div className="vstepper">
          {PHASES.filter((p) => p !== 'done').map((p, i, arr) => {
            const idx = PHASES.indexOf(p)
            const state =
              project.phase === 'done' || idx < currentIdx ? 'done' : idx === currentIdx ? 'current' : ''
            const next = arr[i + 1]
            return (
              <div
                key={p}
                className={`vstep ${state}`}
                style={
                  {
                    '--phase-color': PHASE_COLOR[p],
                    '--phase-next': next ? PHASE_COLOR[next] : PHASE_COLOR[p]
                  } as React.CSSProperties
                }
              >
                <span className="bullet">{state === 'done' && <TickIcon size={10} />}</span>
                {PHASE_LABEL[p]}
              </div>
            )
          })}
        </div>

        <div className="rail-divider" />

        <div className="next-step">
          <span className="rail-mini-label">{liveHere ? 'In progress' : 'Your next step'}</span>
          <h2>{liveHere ? `${clientLabel(projectSessions[0].client)} is on it` : phasePrompt.title}</h2>
          <p className="how">
            {liveHere
              ? 'The agent is filling this board right now — keep talking to it in its chat. The prompt below is only for starting a separate, fresh chat on the next step.'
              : phasePrompt.forHumans}
          </p>
          {!liveHere && phasePrompt.freshSession && (
            <p className="fresh-note">
              Tip — open a brand-new chat for this step. A fresh pair of eyes gives better results.
            </p>
          )}
          <CopyButton text={fillPrompt(phasePrompt.prompt, project.name, undefined, mcp)} label="Copy the prompt" />
          <div className="prompt-peek">{fillPrompt(phasePrompt.prompt, project.name, undefined, mcp)}</div>
        </div>

        {deepDives.length > 0 && project.phase !== 'done' && (
          <>
            <div className="rail-divider" />
            <div>
              <span className="rail-mini-label">Worth a dedicated session</span>
              <p style={{ fontSize: 11.5, color: 'var(--smoke)', lineHeight: 1.45, marginTop: 6 }}>
                Genuinely hard parts — give each one its own fresh agent session.
              </p>
              {deepDives.map((s) => (
                <button
                  key={s.id}
                  className="deep-dive-btn"
                  onClick={() => {
                    window.specdrive.copyToClipboard(fillPrompt(DEEP_DIVE_PROMPT, project.name, s.title, mcp))
                    toast('Deep-dive prompt copied')
                  }}
                >
                  <span className="deep-dive-title">{s.title}</span>
                  <span className="deep-dive-hint">
                    <CopyIcon />
                    Copy the deep-dive prompt
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
