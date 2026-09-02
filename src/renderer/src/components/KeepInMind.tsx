import React, { useEffect, useMemo, useState } from 'react'
import type { ProjectBundle, Spec } from '@shared/types'
import { SpecDetail } from './SpecDetail'
import { CATEGORY_LABEL, firstSentence, ruleProvenance } from '@/lib/labels'

// "Keep in mind" — the standing memory of THIS project: the rules that always
// apply, the papers the owner handed over, the decisions already taken, what
// nobody has answered yet, and what the AI found on its own. One place, so
// nothing important is ever three tabs away.

interface MemoGroup {
  key: string
  title: string
  intro: string
  specs?: Spec[]
  lines?: { title: string; body: string; scope?: string; meta?: string }[]
}

function isQuestion(s: Spec): boolean {
  return /^question\b/i.test(s.title.trim())
}

/** Everything worth remembering, grouped — also drives the tab's count. */
export function memoGroups(bundle: ProjectBundle): MemoGroup[] {
  const { specs, folder, project, planDoc } = bundle
  const groups: MemoGroup[] = []

  if (folder?.rules?.length) {
    groups.push({
      key: 'rules',
      title: 'House rules',
      intro: `Always apply — they come from the folder “${folder.name}”.`,
      lines: folder.rules.map((r) => ({
        title: r.title,
        body: r.content,
        scope: r.appliesTo,
        meta: ruleProvenance(r)
      }))
    })
  }

  const decisions = specs.filter((s) => s.category === 'decisions')
  const settled = decisions.filter((s) => !isQuestion(s))
  if (settled.length) {
    groups.push({
      key: 'decisions',
      title: 'Decisions taken',
      intro: 'Already settled — don’t reopen these without a reason.',
      specs: settled
    })
  }

  const openQuestions = decisions.filter(isQuestion)
  const planQuestions = (planDoc?.blocks ?? []).flatMap((b) =>
    b.type === 'questions' ? b.items : []
  )
  if (openQuestions.length || planQuestions.length) {
    groups.push({
      key: 'questions',
      title: 'Still waiting on you',
      intro: 'The AI cannot decide these alone — answer them in your next chat.',
      specs: openQuestions,
      lines: planQuestions.map((q) => ({
        title: q.q,
        body: q.suggestion ? `Suggested answer: ${q.suggestion}` : ''
      }))
    })
  }

  const waivers = specs.filter((s) => s.tags.includes('skip'))
  if (waivers.length) {
    groups.push({
      key: 'waivers',
      title: 'Checks we skipped',
      intro: 'Agreed shortcuts. Worth re-reading before you ship.',
      specs: waivers
    })
  }

  const gaps = specs.filter((s) => s.confidence === 'gap')
  if (project.mode === 'existing' && gaps.length) {
    groups.push({
      key: 'gaps',
      title: 'Nobody knows yet',
      intro: 'Parts of your existing app the AI could not verify in the code.',
      specs: gaps
    })
  }

  const discoveries = specs.filter((s) => s.tags.includes('discovery'))
  if (discoveries.length) {
    groups.push({
      key: 'discoveries',
      title: 'Found while building',
      intro: 'Things the AI learned on the way that the plan didn’t know about.',
      specs: discoveries
    })
  }

  if (bundle.documents.length) {
    groups.push({
      key: 'documents',
      title: 'Your documents',
      intro: 'Kept word for word, never summarised. The AI reads them as written.',
      lines: []
    })
  }

  return groups
}

export function keepInMindCount(bundle: ProjectBundle): number {
  return memoGroups(bundle).reduce(
    (n, g) =>
      n +
      (g.key === 'documents'
        ? bundle.documents.length
        : (g.specs?.length ?? 0) + (g.lines?.length ?? 0)),
    0
  )
}

function DocRow({
  doc,
  onOpen
}: {
  doc: ProjectBundle['documents'][number]
  onOpen: () => void
}): React.JSX.Element {
  return (
    <button className="memo-row" onClick={onOpen}>
      <span className="memo-row-title">
        {doc.kind === 'image' ? '🖼' : '▤'} {doc.title}
      </span>
      <span className="memo-row-body">
        {doc.kind} · {(doc.size / 1000).toFixed(1)}k characters
      </span>
      <span className="memo-row-go">Open</span>
    </button>
  )
}

/** The one project-level toggle in this panel: whether SpecDrive writes the
 *  generated, read-only AGENTS.md (plus a first-run CLAUDE.md stub) into the
 *  project's own code folder, for tools that don't speak the MCP directly. */
function AgentsMdToggle({
  projectId,
  codebasePath,
  syncOn
}: {
  projectId: string
  codebasePath: string
  syncOn: boolean
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [localOn, setLocalOn] = useState(syncOn)
  useEffect(() => setLocalOn(syncOn), [syncOn])
  const shortPath = codebasePath.replace(/^\/Users\/[^/]+/, '~')
  return (
    <div className="agentsmd-toggle">
      <label className="agentsmd-toggle-row">
        <input
          type="checkbox"
          checked={localOn}
          disabled={busy}
          onChange={async (e) => {
            const next = e.target.checked
            setLocalOn(next)
            setBusy(true)
            try {
              await window.specdrive.setSyncAgentsMd(projectId, next)
            } finally {
              setBusy(false)
            }
          }}
        />
        Write the house rules into the code folder (AGENTS.md)
      </label>
      <p className="agentsmd-toggle-path">
        {localOn ? 'Kept up to date at ' : 'Off — nothing written to '}
        <code>{shortPath}/AGENTS.md</code>
      </p>
    </div>
  )
}

export function KeepInMind({ bundle }: { bundle: ProjectBundle }): React.JSX.Element {
  const [openSpec, setOpenSpec] = useState<Spec | null>(null)
  const [openDoc, setOpenDoc] = useState<ProjectBundle['documents'][number] | null>(null)
  const [docText, setDocText] = useState('')
  const [imgSrc, setImgSrc] = useState('')
  const groups = useMemo(() => memoGroups(bundle), [bundle])
  const projectId = bundle.project.id

  useEffect(() => {
    if (!openDoc) return
    if (openDoc.kind === 'image') {
      window.specdrive.readImage(projectId, openDoc.file).then(setImgSrc).catch(() => setImgSrc(''))
    } else {
      window.specdrive
        .readDocument(projectId, openDoc.file)
        .then(setDocText)
        .catch(() => setDocText('Document not found.'))
    }
  }, [openDoc, projectId])

  if (openSpec) {
    const live = bundle.specs.find((x) => x.id === openSpec.id) ?? openSpec
    return <SpecDetail spec={live} onClose={() => setOpenSpec(null)} />
  }

  if (openDoc && openDoc.kind === 'image') {
    return (
      <div className="spec-detail">
        <div className="spec-detail-bar">
          <span className="badge">Image</span>
          <button className="pill pill-quiet" onClick={() => setOpenDoc(null)}>
            Close
          </button>
        </div>
        <div className="image-viewer">
          <h2>{openDoc.title}</h2>
          {imgSrc ? <img src={imgSrc} alt={openDoc.title} /> : <p className="empty">Loading…</p>}
        </div>
      </div>
    )
  }

  if (openDoc) {
    return (
      <SpecDetail
        spec={{
          id: openDoc.id,
          category: 'design',
          title: openDoc.title,
          content: docText || 'Loading…',
          status: 'confirmed',
          tags: [openDoc.kind],
          createdAt: openDoc.createdAt,
          updatedAt: openDoc.createdAt
        }}
        onClose={() => setOpenDoc(null)}
      />
    )
  }

  const codebasePath = bundle.project.codebasePath
  const houseSync = codebasePath ? (
    <AgentsMdToggle
      projectId={projectId}
      codebasePath={codebasePath}
      syncOn={bundle.project.syncAgentsMd !== false}
    />
  ) : null

  if (!groups.length) {
    return (
      <div className="memo">
        {houseSync}
        <div className="empty">
          <div className="art">Nothing to remember yet</div>
          House rules, your documents, the decisions taken and the open questions
          <br />
          gather here — so the important things never get lost in the board.
        </div>
      </div>
    )
  }

  return (
    <div className="memo">
      {houseSync}
      {groups.map((g) => (
        <section className="memo-group" key={g.key}>
          <div className="memo-head">
            <h3>{g.title}</h3>
            <span className="memo-n">
              {g.key === 'documents'
                ? bundle.documents.length
                : (g.specs?.length ?? 0) + (g.lines?.length ?? 0)}
            </span>
          </div>
          <p className="memo-intro">{g.intro}</p>
          {g.key === 'documents'
            ? bundle.documents.map((d) => <DocRow key={d.id} doc={d} onOpen={() => setOpenDoc(d)} />)
            : null}
          {g.lines?.map((l, i) => (
            <div className={`memo-row static${g.key === 'questions' ? ' asking' : ''}`} key={`l${i}`}>
              <span className="memo-row-title">
                {l.title}
                {l.scope && <span className="rule-scope"> only for {l.scope}</span>}
              </span>
              {l.body && <span className="memo-row-body">{l.body}</span>}
              {l.meta && <span className="memo-row-meta">{l.meta}</span>}
            </div>
          ))}
          {g.specs?.map((s) => (
            <button
              key={s.id}
              className={`memo-row${g.key === 'questions' ? ' asking' : ''}`}
              onClick={() => setOpenSpec(s)}
            >
              <span className="memo-row-title">{s.title}</span>
              <span className="memo-row-body">{firstSentence(s.content, 190)}</span>
              <span className="memo-row-go">{CATEGORY_LABEL[s.category]}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
