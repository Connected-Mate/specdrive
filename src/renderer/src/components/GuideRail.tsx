import React, { useEffect, useState } from 'react'
import type { ActivityEntry, Folder, LiveSession, ProjectBundle } from '@shared/types'
import { PHASES } from '@shared/types'
import {
  ADOPT_PROMPT,
  AUTOBUILD_PROMPT,
  DEEP_DIVE_PROMPT,
  REFINE_SPECS_PROMPT,
  FOLDER_PROMPT,
  FOLDER_REVIEW_PROMPT,
  INTEGRATE_AGENT_PROMPT,
  PHASE_PROMPTS,
  START_PROMPT,
  fillFolderPrompt,
  fillPrompt,
  type McpInfo
} from '@shared/prompts'
import { GlitchBadge } from './glitch/GlitchBadge'
import { clientLabel, timeAgo, useLiveSessions } from '@/lib/useLive'
import { CopyIcon, TickIcon } from './Icons'
import { useToast } from './Toast'
import { CopyButton, PromptPeek } from './PromptCopy'
import { PHASE_COLOR } from '@/lib/phaseColors'
import { WORLD_LINE, WORLD_WORD, worldColor, worldOf } from '@/lib/mode'

const PHASE_LABEL: Record<string, string> = {
  capture: 'Idea',
  challenge: 'Challenge',
  research: 'Research',
  risks: 'Hard parts',
  plan: 'Plan',
  build: 'Build',
  done: 'Done'
}


function useMcpInfo(): McpInfo | undefined {
  const [info, setInfo] = useState<McpInfo>()
  useEffect(() => {
    window.specdrive.getMcpInfo().then(setInfo).catch(() => {})
  }, [])
  return info
}

/** Under "X is on it" — the last few real actions, plus an honest odometer.
 *  No percentage bars: only facts the owner can check against the Activity tab. */
function MilestoneFeed({
  activity,
  session
}: {
  activity: ActivityEntry[]
  session: LiveSession
}): React.JSX.Element | null {
  if (!activity.length) return null
  const recent = [...activity].reverse().slice(0, 3)
  const since = new Date(session.startedAt).getTime()
  const inSession = activity.filter((a) => new Date(a.ts).getTime() >= since).length
  const startedLabel = new Date(session.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
  return (
    <div className="milestone-feed">
      {recent.map((a, i) => (
        <div key={i} className="milestone-row">
          <span className="milestone-check">
            <TickIcon size={9} />
          </span>
          <span className="milestone-what">{a.summary}</span>
          <span className="milestone-time">{timeAgo(a.ts)}</span>
        </div>
      ))}
      <div className="odometer">
        {inSession} action{inSession === 1 ? '' : 's'} · started {startedLabel}
      </div>
    </div>
  )
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


/** The build, seen from the rail: how far the ordered list has got, the step
 *  running now, and the handful that come next — with their sub-steps counted,
 *  because a block is done only when its parts are. */
function BuildLadder({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  const roots = bundle.tasks.filter((t) => !t.parentId).sort((a, b) => a.order - b.order)
  const kidsOf = (id: string): ProjectBundle['tasks'] => bundle.tasks.filter((t) => t.parentId === id)
  const stateOf = (t: ProjectBundle['tasks'][number]): string => {
    if (t.status === 'done') return t.stale ? 'recheck' : 'done'
    if (t.status === 'in_progress') return 'current'
    if (t.status === 'failed' || t.status === 'blocked') return 'stuck'
    if (t.status === 'deferred') return 'parked'
    return ''
  }
  const doneCount = roots.filter((t) => t.status === 'done' && !t.stale).length
  const runningIdx = roots.findIndex((t) => t.status === 'in_progress')
  const nextIdx = roots.findIndex((t) => t.status === 'todo')
  const focus = runningIdx >= 0 ? runningIdx : nextIdx >= 0 ? nextIdx : roots.length - 1
  // A window around where we are: enough to see the road, never the whole list.
  const from = Math.max(0, Math.min(focus - 2, roots.length - 6))
  const shown = roots.slice(from, from + 6)

  return (
    <div className="build-ladder">
      <div className="ladder-head">
        <span className="rail-mini-label">The build, step by step</span>
        <span className="ladder-count">
          {doneCount} of {roots.length} done
        </span>
      </div>
      {from > 0 && <p className="ladder-more">{from} step{from > 1 ? 's' : ''} before this</p>}
      <ol className="ladder">
        {shown.map((t) => {
          const kids = kidsOf(t.id)
          const doneKids = kids.filter((k) => k.status === 'done').length
          const st = stateOf(t)
          return (
            <li key={t.id} className={`ladder-step ${st}`}>
              <span className="ladder-bullet">{st === 'done' && <TickIcon size={9} />}</span>
              <span className="ladder-body">
                <span className="ladder-title">
                  {roots.indexOf(t) + 1}. {t.title}
                </span>
                {kids.length > 0 && (
                  <span className="ladder-sub">
                    {doneKids} of {kids.length} sub-step{kids.length > 1 ? 's' : ''} done
                  </span>
                )}
                {st === 'current' && <span className="ladder-sub running">running now</span>}
                {st === 'stuck' && <span className="ladder-sub warn">needs you</span>}
                {st === 'recheck' && <span className="ladder-sub warn">needs a re-check</span>}
                {st === 'parked' && <span className="ladder-sub warn">set aside</span>}
              </span>
            </li>
          )
        })}
      </ol>
      {from + 6 < roots.length && (
        <p className="ladder-more">{roots.length - from - 6} more after that</p>
      )}
    </div>
  )
}

/** Right rail: always-visible guidance — where you are, what to do next. */
/** What the rail shows when a HOUSE (folder) is open instead of a project. */
export type FolderView = { kind: 'new' } | { kind: 'existing'; folder: Folder }

export function GuideRail({
  bundle,
  folderView = null,
  crewView = false
}: {
  bundle: ProjectBundle | null
  /** A folder screen is open — the rail hands over the folder prompt instead */
  folderView?: FolderView | null
  /** The Agents screen is open — the rail hands over the agent prompt instead */
  crewView?: boolean
}): React.JSX.Element {
  const toast = useToast()
  const sessions = useLiveSessions()
  const mcp = useMcpInfo()
  const [startMode, setStartMode] = useState<'new' | 'existing'>('new')

  // The Agents screen has its own next step: an agent is written by TALKING,
  // never by filling a form, so the rail hands over that prompt — offering
  // "tell your idea" here would send the owner to the wrong place entirely.
  if (crewView) {
    const text = fillPrompt(INTEGRATE_AGENT_PROMPT, '', undefined, mcp)
    return (
      <aside className="rail">
        <div className="rail-drag" />
        <div className="rail-body">
          <LiveSessionCard sessions={sessions} />
          <div className="next-step">
            <span className="rail-mini-label">Your agents</span>
            <h2>Create one by talking</h2>
            <p className="how">
              Copy this prompt, paste it into a connected AI agent, and say what you want your agent
              to do for you. It asks four simple questions, writes the brief for you, and saves it
              here. Or start from a ready-made one on the left and change what you like.
            </p>
            <CopyButton text={text} label="Copy the prompt" />
            <PromptPeek text={text} />
            <p className="how faded" style={{ marginTop: 14 }}>
              An agent you save once is available in every project: type its command in your AI
              agent and it runs with all its rules. Whatever it finds comes back here as a report.
            </p>
          </div>
        </div>
      </aside>
    )
  }

  if (folderView) {
    const isNew = folderView.kind === 'new'
    const text = isNew
      ? fillFolderPrompt(FOLDER_PROMPT, '', mcp)
      : fillFolderPrompt(FOLDER_REVIEW_PROMPT, folderView.folder.name, mcp)
    return (
      <aside className="rail">
        <div className="rail-drag" />
        <div className="rail-body">
          <LiveSessionCard sessions={sessions} />
          <div className="next-step">
            <span className="rail-mini-label">{isNew ? 'A new house' : 'House rules'}</span>
            <h2>{isNew ? 'Set it up with your agent' : 'Go through the rules with your agent'}</h2>
            <p className="how">
              {isNew
                ? 'Copy this prompt, paste it into a connected AI agent, and just talk about the company, client or team: it proposes the rules, creates the folder and places your projects in it. You can also write the rules yourself on the left.'
                : 'Copy this prompt and paste it into your agent: it walks every rule with you, tightens the wording, adds what this house is missing, and saves it here. Or edit the rules directly on the left.'}
            </p>
            <CopyButton text={text} label={isNew ? 'Copy the set-up prompt' : 'Copy the review prompt'} />
            <PromptPeek text={text} />
            <p className="how faded" style={{ marginTop: 14 }}>
              Every project inside a house follows its rules in every step. Houses can live inside
              other houses — a company, then its teams — and the rules stack down the line. Drag a
              project, or a whole house, onto another house in the sidebar to move it in.
            </p>
          </div>
        </div>
      </aside>
    )
  }

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
            <PromptPeek text={fillPrompt(starter, '', undefined, mcp)} />
          </div>
        </div>
      </aside>
    )
  }

  const { project, specs, activity } = bundle
  const projectSessions = sessions.filter(
    (x) =>
      x.project === bundle.project.id ||
      (x.project ?? '').toLowerCase() === bundle.project.name.toLowerCase()
  )
  const liveHere = projectSessions.length > 0
  const phasePrompt = PHASE_PROMPTS.find((p) => p.phase === project.phase) ?? PHASE_PROMPTS[0]
  const currentIdx = PHASES.indexOf(project.phase)
  const deepDives = specs.filter((s) => s.category === 'risks' && (s.difficulty ?? 0) >= 4)
  const world = worldOf(project.phase)
  const phaseColor = worldColor(project.phase)

  return (
    <aside
      className={`rail world-${world}`}
      style={{ '--phase-color': phaseColor } as React.CSSProperties}
    >
      <div className="rail-drag" />
      <div className="rail-body">
        <LiveSessionCard sessions={projectSessions} />
        <div className="rail-world">
          <span className="rail-world-word">{WORLD_WORD[world]}</span>
          <span className="rail-world-line">{WORLD_LINE[world]}</span>
        </div>
        <div className="step-figure">
          <span className="mini" style={{ color: phaseColor }}>
            Step {Math.min(currentIdx + 1, 6)} of 6
          </span>
          <span className="big">{PHASE_LABEL[project.phase]}</span>
        </div>

        {/* Once the build starts, the six phases stop being the story: what
            matters is the ordered list of steps and where it stands. */}
        {world === 'build' && bundle.tasks.length > 0 ? (
          <BuildLadder bundle={bundle} />
        ) : (
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
        )}

        <div className="rail-divider" />

        <div className="next-step">
          <span className="rail-mini-label">{liveHere ? 'In progress' : 'Your next step'}</span>
          <h2>{liveHere ? `${clientLabel(projectSessions[0].client)} is on it` : phasePrompt.title}</h2>
          {liveHere && <MilestoneFeed activity={activity} session={projectSessions[0]} />}
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
          <PromptPeek text={fillPrompt(phasePrompt.prompt, project.name, undefined, mcp)} />
        </div>

        {/* The specs are never closed: whatever the phase, the owner can pick
            them back up and have the agent propose improvements. */}
        <div className="rail-divider" />
        <div className="next-step quiet">
          <span className="rail-mini-label">Any time</span>
          <h2>Come back to the specs</h2>
          <p className="how">
            Your agent re-reads the whole board, catches you up, then proposes what to add or fix — no
            questionnaire, and nothing gets built.
          </p>
          <CopyButton
            text={fillPrompt(REFINE_SPECS_PROMPT, project.name, undefined, mcp)}
            label="Copy the specs prompt"
            quiet
          />
          <PromptPeek text={fillPrompt(REFINE_SPECS_PROMPT, project.name, undefined, mcp)} />
        </div>

        {project.phase === 'build' && (
          <>
            <div className="rail-divider" />
            <div className="next-step">
              <span className="rail-mini-label">Or let it run alone</span>
              <h2 style={{ fontSize: 22 }}>Autonomous build</h2>
              <p className="how">
                Paste this and walk away: the AI builds step by step on its own, saving each
                finished step with its proof. It stops cleanly by itself — and if your AI plan
                hits its limit, nothing is lost: a fresh chat resumes at the exact next step.
              </p>
              <CopyButton
                text={fillPrompt(AUTOBUILD_PROMPT, project.name, undefined, mcp)}
                label="Copy the autonomous build prompt"
              />
              <PromptPeek text={fillPrompt(AUTOBUILD_PROMPT, project.name, undefined, mcp)} />
            </div>
          </>
        )}

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
