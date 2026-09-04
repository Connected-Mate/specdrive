import React, { useCallback, useEffect, useState } from 'react'
import type { WaitingItem } from '@shared/types'
import { useToast } from './Toast'
import { timeAgo } from '@/lib/useLive'

// The one place that says "these are yours". Everything else on the board is
// the agent's job; this is the short list only the owner can settle. Answering
// writes an owner note the agent reads on its next pass — the same channel it
// already knows, so nothing new has to be taught to it.

const KIND_LABEL: Record<WaitingItem['kind'], string> = {
  question: 'Question for you',
  blocked: 'Stuck',
  failed: 'Did not work',
  deferred: 'Set aside'
}

function Item({
  item,
  onOpenProject,
  onAnswered
}: {
  item: WaitingItem
  onOpenProject: (id: string) => void
  onAnswered: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const send = async (answer: string): Promise<void> => {
    if (!answer.trim()) return
    setBusy(true)
    try {
      const err = await window.specdrive.addComment(item.projectId, item.target, answer.trim())
      if (err) {
        toast(err)
        return
      }
      toast('Answer saved — your agent reads it on its next pass')
      setText('')
      setOpen(false)
      onAnswered()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`waiting-item ${item.kind}`}>
      <div className="waiting-head">
        <span className="waiting-kind">{KIND_LABEL[item.kind]}</span>
        <button className="waiting-project" onClick={() => onOpenProject(item.projectId)}>
          {item.projectName}
        </button>
        <span className="waiting-when">{timeAgo(item.since)}</span>
      </div>
      <p className="waiting-title">{item.title}</p>
      {item.detail && <p className="waiting-detail">{item.detail}</p>}
      {open ? (
        <div className="waiting-answer">
          <textarea
            className="waiting-input"
            autoFocus
            rows={2}
            placeholder="Answer in your own words…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(text)
            }}
          />
          <div className="waiting-actions">
            <button className="pill pill-primary" disabled={busy || !text.trim()} onClick={() => void send(text)}>
              Send to my agent
            </button>
            <button className="pill pill-quiet" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="waiting-actions">
          <button className="pill pill-white" onClick={() => setOpen(true)}>
            {item.kind === 'question' ? 'Answer' : 'Tell your agent what to do'}
          </button>
          {item.kind === 'question' && (
            <button
              className="waiting-defer"
              disabled={busy}
              onClick={() => void send('Je n’ai pas d’avis — garde ton choix et continue.')}
            >
              No opinion — keep your choice
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function WaitingOnYou({
  onOpenProject
}: {
  onOpenProject: (id: string) => void
}): React.JSX.Element | null {
  const [items, setItems] = useState<WaitingItem[]>([])
  const [all, setAll] = useState(false)
  const refresh = useCallback(() => {
    // Defensive: an app whose preload is older than its window must degrade to
    // "nothing waiting", never to a blank screen.
    const api = window.specdrive as Partial<typeof window.specdrive>
    if (typeof api.listWaiting !== 'function') return
    api
      .listWaiting()
      .then(setItems)
      .catch(() => setItems([]))
  }, [])
  useEffect(() => {
    refresh()
    return window.specdrive.onProjectsChanged(refresh)
  }, [refresh])

  if (!items.length) return null
  const shown = all ? items : items.slice(0, 3)
  return (
    <section className="waiting">
      <div className="waiting-bar">
        <h2>Waiting on you</h2>
        <span className="waiting-count">{items.length}</span>
      </div>
      <p className="waiting-lede">
        Your agents can do the rest on their own. These {items.length === 1 ? 'is the one thing' : 'are the things'} only
        you can settle.
      </p>
      {shown.map((it) => (
        <Item key={it.id} item={it} onOpenProject={onOpenProject} onAnswered={refresh} />
      ))}
      {items.length > 3 && (
        <button className="waiting-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show the ${items.length - 3} other${items.length - 3 > 1 ? 's' : ''}`}
        </button>
      )}
    </section>
  )
}
