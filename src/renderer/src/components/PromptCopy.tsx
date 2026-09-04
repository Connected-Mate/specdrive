import React, { useRef, useState } from 'react'
import { useToast } from './Toast'
import { CopyIcon, TickIcon } from './Icons'

// The two halves of every "hand this to your agent" card: the copy button
// with inline "Copied" feedback, and the raw prompt kept behind a disclosure.
// Used by the guide rail (projects) and the folder editor (houses) alike.

/** Copy button with inline "Copied ✓" feedback. */
export function CopyButton({
  text,
  label,
  quiet
}: {
  text: string
  label: string
  /** Secondary look, for a card that is an alternative rather than the main path */
  quiet?: boolean
}): React.JSX.Element {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  return (
    <button
      className={`pill ${quiet ? 'pill-white' : 'pill-primary'}${copied ? ' copied' : ''}`}
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

/** The raw prompt text, collapsed behind a disclosure — closed by default so
 *  a non-technical owner isn't confronted with a wall of instructions. */
export function PromptPeek({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="disclosure" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide what gets pasted ▾' : 'See what gets pasted ▸'}
      </button>
      {open && <div className="prompt-peek">{text}</div>}
    </>
  )
}
