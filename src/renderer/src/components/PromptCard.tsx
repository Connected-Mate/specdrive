import React from 'react'
import { CopyIcon } from './Icons'
import { useToast } from './Toast'

interface Props {
  stepLabel: string
  title: string
  forHumans: string
  freshSession: boolean
  prompt: string
}

/** "Your next step" — the single blue action of the screen. */
export function PromptCard({ stepLabel, title, forHumans, freshSession, prompt }: Props): React.JSX.Element {
  const toast = useToast()
  return (
    <div className="prompt-card">
      <div>
        <span className="badge badge-blue">
          <span className="badge-dot" />
          {stepLabel}
        </span>
        <h3 style={{ marginTop: 14 }}>{title}</h3>
        <p className="how">{forHumans}</p>
        {freshSession && (
          <p className="fresh-note">
            Tip — open a brand-new chat with your AI agent for this step. A fresh pair of eyes gives
            better results.
          </p>
        )}
        <div className="prompt-preview">{prompt}</div>
      </div>
      <button
        className="pill pill-primary"
        onClick={() => {
          window.specdrive.copyToClipboard(prompt)
          toast('Prompt copied — paste it into your AI agent')
        }}
      >
        <CopyIcon />
        Copy the prompt
      </button>
    </div>
  )
}
