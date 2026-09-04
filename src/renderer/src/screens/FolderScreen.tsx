import React, { useMemo, useState } from 'react'
import type { Folder, FolderRule, ProjectBundle } from '@shared/types'
import { FOLDER_PROMPT, FOLDER_REVIEW_PROMPT, fillFolderPrompt } from '@shared/prompts'
import { houseChain, rulesByHouse } from '@shared/house-chain.mjs'
import type { EffectiveRule } from '@shared/house-chain.mjs'
import { FolderEditor } from '@/components/FolderEditor'
import { CopyButton, PromptPeek } from '@/components/PromptCopy'
import { FolderIcon, PencilIcon } from '@/components/Icons'
import { PHASE_COLOR } from '@/lib/phaseColors'
import { ruleProvenance } from '@/lib/labels'
import { useFolders, useMcpInfo } from '@/lib/useLive'
import { useToast } from '@/components/Toast'

// A house has its own page, exactly like a project — because it IS the same
// job, one level up: the spec-driven work of a whole ecosystem instead of one
// product. A brand-new house is a prompt you hand to your agent (the same
// moment as a brand-new idea), never a form. An existing house is a BOARD: its
// rules as cards, what it inherits from the houses above it, and everything
// living inside it.

const PHASE_SHORT: Record<string, string> = {
  capture: 'Capturing idea',
  challenge: 'Challenging',
  research: 'Researching',
  risks: 'Hard parts',
  plan: 'Planning',
  build: 'Building',
  done: 'Built'
}

interface RuleDraft {
  title: string
  content: string
  appliesTo: string
}

/** One rule, read like a page of documentation and edited exactly where it is
 *  read. No form, no mode: click the card, fix the words, save. An inherited
 *  rule cannot be edited from here — it can only be OVERRIDDEN, which writes a
 *  rule of the same name into this house and says so. */
function RuleCard({
  rule,
  i,
  own,
  editing,
  draft,
  busy,
  onEdit,
  onOverride,
  onChange,
  onSave,
  onCancel,
  onDelete
}: {
  rule: EffectiveRule
  i: number
  own: boolean
  editing: boolean
  draft: RuleDraft
  busy: boolean
  onEdit: () => void
  onOverride: () => void
  onChange: (d: RuleDraft) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
}): React.JSX.Element {
  const prov = ruleProvenance(rule)
  const bodyRef = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [editing, draft.content])

  if (editing) {
    return (
      <article className="spec-card house-rule editing" style={{ '--i': i } as React.CSSProperties}>
        <input
          className="house-rule-title-input"
          value={draft.title}
          autoFocus
          maxLength={80}
          placeholder="Short name — “Data stays in the EU”"
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
        <textarea
          ref={bodyRef}
          className="house-rule-body-input"
          value={draft.content}
          maxLength={2000}
          placeholder="The rule itself — precise enough that anyone can tell whether it was followed."
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave()
          }}
        />
        <div className="house-rule-edit-foot">
          <label className="house-rule-scope">
            Only for
            <input
              value={draft.appliesTo}
              maxLength={200}
              placeholder="everything"
              onChange={(e) => onChange({ ...draft, appliesTo: e.target.value })}
            />
          </label>
          <button className="pill pill-primary" disabled={busy || !draft.title.trim()} onClick={onSave}>
            Save
          </button>
          <button className="pill pill-quiet" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="house-rule-delete" disabled={busy} onClick={onDelete}>
            Delete
          </button>
        </div>
      </article>
    )
  }

  return (
    <article
      className={`spec-card house-rule${rule.supersededBy ? ' replaced' : ''}${own ? ' editable' : ''}`}
      style={{ '--i': i } as React.CSSProperties}
      role={own ? 'button' : undefined}
      tabIndex={own ? 0 : undefined}
      onClick={own ? onEdit : undefined}
      onKeyDown={
        own
          ? (e) => {
              if (e.key === 'Enter') onEdit()
            }
          : undefined
      }
    >
      <h4>{rule.title}</h4>
      <div className="content-md">
        <p>{rule.content}</p>
      </div>
      <div className="foot">
        {rule.appliesTo && <span className="badge">only for {rule.appliesTo}</span>}
        {rule.supersededBy && <span className="badge">replaced in {rule.supersededByHouse}</span>}
        {prov && !rule.supersededBy && <span className="house-rule-prov">{prov}</span>}
        {own && <span className="house-rule-hint">Click to edit</span>}
        {!own && !rule.supersededBy && (
          <button
            className="house-rule-override"
            onClick={(e) => {
              e.stopPropagation()
              onOverride()
            }}
          >
            Change it for this house
          </button>
        )}
      </div>
      {rule.supersededBy && (
        <p className="house-rule-replaced">
          “{rule.supersededByHouse}” sets its own rule called “{rule.supersededByTitle}”, and that is
          the one your agents follow here.
        </p>
      )}
    </article>
  )
}

/** The brand-new-house moment: hand the prompt to your agent, exactly like a
 *  brand-new idea. Writing the rules by hand is the quiet second path. */
function NewHouse({
  projects,
  onCreated,
  onGone
}: {
  projects: ProjectBundle[]
  onCreated: (id: string) => void
  onGone: () => void
}): React.JSX.Element {
  const mcp = useMcpInfo()
  const [byHand, setByHand] = useState(false)
  const prompt = fillFolderPrompt(FOLDER_PROMPT, '', mcp)
  return (
    <div className="house-new">
      <div className="house-hero">
        <span className="rail-mini-label">A new house</span>
        <h2>Let your agent set it up</h2>
        <p className="house-hero-line">
          Paste this into your agent and talk about the company, client or team. It asks what must
          always be true, writes the rules, and the house appears here — with every project you put
          inside following it.
        </p>
        <div className="house-hero-do">
          <CopyButton text={prompt} label="Copy the set-up prompt" />
          <PromptPeek text={prompt} />
        </div>
      </div>

      <div className="house-alt">
        {byHand ? (
          <>
            <div className="house-alt-head">
              <span className="rail-mini-label">Writing it yourself</span>
              <button className="pill pill-quiet" onClick={() => setByHand(false)}>
                Hide the form
              </button>
            </div>
            <FolderEditor
              folder={null}
              projects={projects}
              onDone={(id) => onCreated(id)}
              onCancel={onGone}
            />
          </>
        ) : (
          <button className="house-alt-open" onClick={() => setByHand(true)}>
            <span className="house-alt-title">Or write it yourself</span>
            <span className="house-alt-hint">
              Name it, say what lives there, and type the rules — you can hand it to an agent later
              all the same.
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

export function FolderScreen({
  folder,
  projects,
  onCreated,
  onGone,
  onOpenFolder,
  onOpenProject
}: {
  /** null = a brand-new house */
  folder: Folder | null
  projects: ProjectBundle[]
  /** A new house was created — open it */
  onCreated: (folderId: string) => void
  /** Cancelled or deleted — back to the welcome screen */
  onGone: () => void
  /** Jump to another house (a sub-house, or one above this one) */
  onOpenFolder?: (id: string) => void
  /** Jump to a project living in this house */
  onOpenProject?: (id: string) => void
}): React.JSX.Element {
  const { folders } = useFolders()
  const mcp = useMcpInfo()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toast = useToast()
  // Which of THIS house's rules is open for editing, by title. 'new' writes a
  // fresh one. Editing happens on the card, never in a separate form.
  const [openRule, setOpenRule] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<RuleDraft>({ title: '', content: '', appliesTo: '' })
  const [savingRule, setSavingRule] = useState(false)
  const readFolder = React.useCallback(
    (id: string) => folders.find((f) => f.id === id) ?? null,
    [folders]
  )

  const chain = useMemo(
    () => (folder ? houseChain(folder.id, readFolder) : []),
    [folder, readFolder]
  )
  // Own rules first — this house is what the owner came to read — then what it
  // inherits, nearest house first.
  const groups = useMemo(() => {
    if (!folder) return []
    const all = rulesByHouse(folder.id, readFolder)
    const own = all.filter((g) => g.folder.id === folder.id)
    const above = all.filter((g) => g.folder.id !== folder.id).reverse()
    return [...own, ...above]
  }, [folder, readFolder])
  const inForce = useMemo(
    () => groups.reduce((n, g) => n + g.rules.filter((r) => !r.supersededBy).length, 0),
    [groups]
  )
  const inside = useMemo(
    () => (folder ? projects.filter((p) => p.project.folderId === folder.id) : []),
    [projects, folder]
  )
  const subHouses = useMemo(
    () => (folder ? folders.filter((f) => f.parentId === folder.id) : []),
    [folder, folders]
  )

  /** Write this house's own rules back, keeping every other one untouched. */
  const saveRules = async (next: FolderRule[], done: string): Promise<void> => {
    if (!folder) return
    setSavingRule(true)
    try {
      const err = await window.specdrive.setFolderRules(folder.id, next)
      if (err) {
        toast(err)
        return
      }
      setOpenRule(null)
      toast(done)
    } finally {
      setSavingRule(false)
    }
  }

  const ownRules = folder?.rules ?? []

  const commitDraft = async (): Promise<void> => {
    const title = draft.title.trim()
    if (!folder || !title) return
    const rule: FolderRule = { title, content: draft.content.trim() }
    if (draft.appliesTo.trim()) rule.appliesTo = draft.appliesTo.trim()
    const next =
      openRule === 'new'
        ? [...ownRules, rule]
        : ownRules.map((r) => (r.title === openRule ? { ...r, ...rule } : r))
    await saveRules(next, openRule === 'new' ? `Rule “${title}” added` : `Rule “${title}” saved`)
  }

  const deleteRule = async (): Promise<void> => {
    if (!folder || openRule === 'new' || !openRule) {
      setOpenRule(null)
      return
    }
    await saveRules(
      ownRules.filter((r) => r.title !== openRule),
      `Rule “${openRule}” removed`
    )
  }

  const startEdit = (r: EffectiveRule): void => {
    setDraft({ title: r.title, content: r.content, appliesTo: r.appliesTo ?? '' })
    setOpenRule(r.title)
  }

  const startOverride = (r: EffectiveRule): void => {
    setDraft({ title: r.title, content: r.content, appliesTo: r.appliesTo ?? '' })
    setOpenRule('new')
  }

  const startNew = (): void => {
    setDraft({ title: '', content: '', appliesTo: '' })
    setOpenRule('new')
  }

  if (!folder) {
    return (
      <main className="content">
        <div className="content-head">
          <div className="content-title">
            <h1>A new house</h1>
            <span className="one-liner">
              Standing rules every project inside will follow — and every house inside it too
            </span>
          </div>
        </div>
        <div className="content-body">
          <NewHouse projects={projects} onCreated={onCreated} onGone={onGone} />
        </div>
      </main>
    )
  }

  const reviewPrompt = fillFolderPrompt(FOLDER_REVIEW_PROMPT, folder.name, mcp)
  const ownCount = folder.rules.length
  const counts = [
    `${inForce} rule${inForce === 1 ? '' : 's'} in force`,
    inForce !== ownCount ? `${ownCount} written here` : '',
    `${inside.length} project${inside.length === 1 ? '' : 's'}`,
    subHouses.length ? `${subHouses.length} house${subHouses.length === 1 ? '' : 's'} inside` : ''
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <main className="content">
      <div className="content-head">
        <div className="content-title">
          <h1>{folder.name}</h1>
          <span className="one-liner">{folder.description || counts}</span>
        </div>
      </div>
      <div className="content-body">
        <div className="house-page">
          <div className="house-bar">
            {chain.length > 1 && (
              <nav className="house-crumbs" aria-label="Where this house lives">
                {chain.map((f, i) => (
                  <React.Fragment key={f.id}>
                    {i > 0 && <span className="house-crumb-sep">›</span>}
                    {f.id === folder.id ? (
                      <span className="house-crumb current">{f.name}</span>
                    ) : (
                      <button className="house-crumb" onClick={() => onOpenFolder?.(f.id)}>
                        {f.name}
                      </button>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            )}
            <span className="house-counts">{folder.description ? counts : ''}</span>
            <button
              className={`pill ${editing ? 'pill-primary' : 'pill-white'} house-edit`}
              onClick={() => setEditing((e) => !e)}
            >
              <PencilIcon />
              {editing ? 'Done' : 'Rename or move'}
            </button>
            <button
              className={`house-delete${confirmDelete ? ' confirming' : ''}`}
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true)
                  return
                }
                setConfirmDelete(false)
                const err = await window.specdrive.deleteFolder(folder.id)
                if (err) {
                  toast(err)
                  return
                }
                const moved = [
                  inside.length ? `${inside.length} project${inside.length > 1 ? 's' : ''}` : '',
                  subHouses.length ? `${subHouses.length} house${subHouses.length > 1 ? 's' : ''}` : ''
                ].filter(Boolean)
                toast(
                  moved.length
                    ? `“${folder.name}” deleted — ${moved.join(' and ')} moved up, nothing is lost`
                    : `“${folder.name}” deleted`
                )
                onGone()
              }}
            >
              {confirmDelete
                ? inside.length || subHouses.length
                  ? 'Really delete? What is inside moves up'
                  : 'Really delete this house?'
                : 'Delete'}
            </button>
          </div>

          {editing ? (
            <FolderEditor
              key={folder.id}
              folder={folder}
              identityOnly
              projects={projects}
              onDone={() => setEditing(false)}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              {!groups.some((g) => g.folder.id === folder.id) && (
                <section className="house-group">
                  <div className="house-group-head">
                    <h3>The rules of this house</h3>
                    <span className="house-group-note">
                      Nothing written here yet. Copy the prompt on the right and tell your agent what must
                      always be true — or write the first rule yourself.
                    </span>
                  </div>
                  <div className="house-rules">
                    {openRule === 'new' ? (
                      <RuleCard
                        rule={{ title: draft.title, content: draft.content } as EffectiveRule}
                        i={0}
                        own
                        editing
                        draft={draft}
                        busy={savingRule}
                        onEdit={() => undefined}
                        onOverride={() => undefined}
                        onChange={setDraft}
                        onSave={() => void commitDraft()}
                        onCancel={() => setOpenRule(null)}
                        onDelete={() => setOpenRule(null)}
                      />
                    ) : (
                      <button className="house-rule-add" onClick={startNew}>
                        <span className="house-rule-add-plus">+</span>
                        Write a rule
                      </button>
                    )}
                  </div>
                </section>
              )}
              {groups.map((g) => {
                const own = g.folder.id === folder.id
                return (
                  <section className="house-group" key={g.folder.id}>
                    <div className="house-group-head">
                      <h3>{own ? 'The rules of this house' : `Inherited from ${g.folder.name}`}</h3>
                      <span className="house-group-note">
                        {own
                          ? 'Every project inside follows these in every step, without being reminded.'
                          : `${g.path} — they apply here too. A rule written here with the same name replaces the one above.`}
                      </span>
                    </div>
                    <div className="house-rules">
                      {g.rules.map((r, i) => (
                        <RuleCard
                          key={`${g.folder.id}-${r.title}`}
                          rule={r}
                          i={i}
                          own={own}
                          editing={own && openRule === r.title}
                          draft={draft}
                          busy={savingRule}
                          onEdit={() => startEdit(r)}
                          onOverride={() => startOverride(r)}
                          onChange={setDraft}
                          onSave={() => void commitDraft()}
                          onCancel={() => setOpenRule(null)}
                          onDelete={() => void deleteRule()}
                        />
                      ))}
                      {own && openRule === 'new' && (
                        <RuleCard
                          key="new-rule"
                          rule={{ title: draft.title, content: draft.content } as EffectiveRule}
                          i={g.rules.length}
                          own
                          editing
                          draft={draft}
                          busy={savingRule}
                          onEdit={() => undefined}
                          onOverride={() => undefined}
                          onChange={setDraft}
                          onSave={() => void commitDraft()}
                          onCancel={() => setOpenRule(null)}
                          onDelete={() => setOpenRule(null)}
                        />
                      )}
                      {own && openRule !== 'new' && (
                        <button className="house-rule-add" onClick={startNew}>
                          <span className="house-rule-add-plus">+</span>
                          Write a rule
                        </button>
                      )}
                    </div>
                  </section>
                )
              })}

              <section className="house-group">
                <div className="house-group-head">
                  <h3>In this house</h3>
                  <span className="house-group-note">
                    {inside.length || subHouses.length
                      ? 'Drag a project onto this house in the sidebar to move it in.'
                      : 'Nothing here yet — drag a project onto this house in the sidebar to move it in.'}
                  </span>
                </div>
                <div className="house-inside">
                  {subHouses.map((f) => {
                    const n = projects.filter((p) => p.project.folderId === f.id).length
                    return (
                      <button
                        key={f.id}
                        className="house-inside-row is-house"
                        onClick={() => onOpenFolder?.(f.id)}
                      >
                        <span className="house-inside-icon">
                          <FolderIcon size={12} />
                        </span>
                        <span className="house-inside-name">{f.name}</span>
                        <span className="house-inside-meta">
                          {f.rules.length === 0
                            ? 'no rules of its own'
                            : `${f.rules.length} rule${f.rules.length > 1 ? 's' : ''}`}
                          {` · ${n} project${n === 1 ? '' : 's'}`}
                        </span>
                      </button>
                    )
                  })}
                  {inside.map((b) => (
                    <button
                      key={b.project.id}
                      className="house-inside-row"
                      onClick={() => onOpenProject?.(b.project.id)}
                    >
                      <span
                        className="phase-dot"
                        style={{ '--phase-color': PHASE_COLOR[b.project.phase] } as React.CSSProperties}
                      />
                      <span className="house-inside-name">{b.project.name}</span>
                      <span className="house-inside-meta">
                        {PHASE_SHORT[b.project.phase]}
                        {b.tasks.length > 0 &&
                          ` · ${b.tasks.filter((t) => t.status === 'done').length}/${b.tasks.length} steps`}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="house-group house-hand-off">
                <div className="house-group-head">
                  <h3>Go through it with your agent</h3>
                  <span className="house-group-note">
                    It walks every rule with you, tightens the wording, adds what is missing, and
                    saves it straight back here.
                  </span>
                </div>
                <div className="house-hero-do">
                  <CopyButton text={reviewPrompt} label="Copy the review prompt" quiet />
                  <PromptPeek text={reviewPrompt} />
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
