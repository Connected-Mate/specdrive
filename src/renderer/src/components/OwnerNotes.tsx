import React, { useState } from 'react'
import type { OwnerComment } from '@shared/types'
import { timeAgo } from '@/lib/useLive'
import { useToast } from './Toast'

/** Small comment affordance on a spec/task card — the owner leaves a note,
 *  the agent reads it through MCP on its next pass and resolves it. */
export function OwnerNotes({
  projectId,
  target,
  comments
}: {
  projectId: string
  target: OwnerComment['target']
  comments: OwnerComment[]
}): React.JSX.Element {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const mine = comments.filter((c) => c.target.kind === target.kind && c.target.id === target.id)
  const openCount = mine.filter((c) => c.status === 'open').length

  const save = async (): Promise<void> => {
    const clean = text.trim()
    if (!clean) return
    setSaving(true)
    const err = await window.specdrive.addComment(projectId, target, clean)
    setSaving(false)
    if (err) {
      toast(err)
      return
    }
    setText('')
    toast('Note saved — your agent reads it on its next pass')
  }

  return (
    <div className="owner-notes" onClick={(e) => e.stopPropagation()}>
      <button
        className={`note-toggle${openCount ? ' has-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        ✎ {mine.length ? mine.length : 'Note'}
      </button>
      {open && (
        <div className="owner-note-panel">
          {mine.map((c) => (
            <div key={c.id} className={`owner-note${c.status === 'resolved' ? ' resolved' : ''}`}>
              <p className="owner-note-text">{c.text}</p>
              {c.status === 'resolved' && c.resolution && (
                <p className="owner-note-resolution">
                  <strong>Agent:</strong> {c.resolution}
                </p>
              )}
              <span className="owner-note-meta">
                {c.status === 'resolved' ? 'Resolved' : 'Open'} · {timeAgo(c.createdAt)}
              </span>
            </div>
          ))}
          <textarea
            className="owner-note-input"
            placeholder="Leave a note for your agent…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            className="pill pill-quiet"
            disabled={!text.trim() || saving}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      )}
    </div>
  )
}
