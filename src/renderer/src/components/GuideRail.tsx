import React from 'react'
import type { ProjectBundle } from '@shared/types'
import { PHASES } from '@shared/types'
import { DEEP_DIVE_PROMPT, PHASE_PROMPTS, START_PROMPT, fillPrompt } from '@shared/prompts'
import { CopyIcon, TickIcon } from './Icons'
import { useToast } from './Toast'

const PHASE_LABEL: Record<string, string> = {
  capture: 'Idea',
  challenge: 'Challenge',
  research: 'Research',
  risks: 'Hard parts',
  plan: 'Plan',
  build: 'Build',
  done: 'Done'
}

/** Right rail: always-visible guidance — where you are, what to do next. */
export function GuideRail({ bundle }: { bundle: ProjectBundle | null }): React.JSX.Element {
  const toast = useToast()

  if (!bundle) {
    return (
      <aside className="rail">
        <div className="rail-drag">
          <span className="rail-mini-label">Start here</span>
        </div>
        <div className="rail-body">
          <div className="next-step">
            <h2>Tell your idea</h2>
            <p className="how">
              Copy this prompt, paste it into a connected AI agent (Claude Code, Cursor…), and
              describe what you want to build — in your own words. Your project will appear here on
              its own.
            </p>
            <button
              className="pill pill-primary"
              onClick={() => {
                window.specdrive.copyToClipboard(START_PROMPT)
                toast('Prompt copied — paste it into your AI agent')
              }}
            >
              <CopyIcon />
              Copy the starter prompt
            </button>
            <div className="prompt-peek">{START_PROMPT}</div>
          </div>
        </div>
      </aside>
    )
  }

  const { project, specs } = bundle
  const phasePrompt = PHASE_PROMPTS.find((p) => p.phase === project.phase) ?? PHASE_PROMPTS[0]
  const currentIdx = PHASES.indexOf(project.phase)
  const deepDives = specs.filter((s) => s.category === 'risks' && (s.difficulty ?? 0) >= 4)

  return (
    <aside className="rail">
      <div className="rail-drag">
        <span className="rail-mini-label">
          Step {Math.min(currentIdx + 1, 6)} of 6
        </span>
      </div>
      <div className="rail-body">
        <div className="vstepper">
          {PHASES.filter((p) => p !== 'done').map((p) => {
            const idx = PHASES.indexOf(p)
            const state =
              project.phase === 'done' || idx < currentIdx ? 'done' : idx === currentIdx ? 'current' : ''
            return (
              <div key={p} className={`vstep ${state}`}>
                <span className="bullet">{state === 'done' && <TickIcon size={10} />}</span>
                {PHASE_LABEL[p]}
              </div>
            )
          })}
        </div>

        <div className="rail-divider" />

        <div className="next-step">
          <span className="rail-mini-label">Your next step</span>
          <h2>{phasePrompt.title}</h2>
          <p className="how">{phasePrompt.forHumans}</p>
          {phasePrompt.freshSession && (
            <p className="fresh-note">
              Tip — open a brand-new chat for this step. A fresh pair of eyes gives better results.
            </p>
          )}
          <button
            className="pill pill-primary"
            onClick={() => {
              window.specdrive.copyToClipboard(fillPrompt(phasePrompt.prompt, project.name))
              toast('Prompt copied — paste it into your AI agent')
            }}
          >
            <CopyIcon />
            Copy the prompt
          </button>
          <div className="prompt-peek">{fillPrompt(phasePrompt.prompt, project.name)}</div>
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
                    window.specdrive.copyToClipboard(fillPrompt(DEEP_DIVE_PROMPT, project.name, s.title))
                    toast('Deep-dive prompt copied')
                  }}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
