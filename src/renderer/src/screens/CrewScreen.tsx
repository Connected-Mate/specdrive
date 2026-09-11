import React, { useEffect, useMemo, useState } from 'react'
import type { AgentDef, AgentRun, AgentScope, ProjectBundle } from '@shared/types'
import { INTEGRATE_AGENT_PROMPT, fillPrompt } from '@shared/prompts'
import { promptNameFor, VERDICT_LABEL, SEVERITY_LABEL } from '@shared/crew-chain.mjs'
import { AGENT_PRESET_KEYS, AGENT_PRESET_LABEL } from '@shared/crew-presets.mjs'
import type { AgentPresetKey } from '@shared/crew-presets.mjs'
import { chainLabel, houseChain } from '@shared/house-chain.mjs'
import { CopyButton, PromptPeek } from '@/components/PromptCopy'
import { PencilIcon } from '@/components/Icons'
import { useCrew, useFolders, useMcpInfo, timeAgo } from '@/lib/useLive'
import { useToast } from '@/components/Toast'

// The Agents screen: the owner's own reusable crew, saved once and run in any
// project. Created by talking to an agent (Integrate prompt) or from a
// ready-made preset — never a blank form first. Everything about a saved
// agent is then edited right here, in place.

interface AgentDraft {
  name: string
  emoji: string
  role: string
  mission: string
  rules: string[]
  method: string[]
  deliverable: string
  tools: string[]
  modelHint: string
  scope: AgentScope
  folderId: string
}

function toDraft(a: AgentDef): AgentDraft {
  return {
    name: a.name,
    emoji: a.emoji,
    role: a.role,
    mission: a.mission,
    rules: a.rules.length ? [...a.rules] : [''],
    method: a.method.length ? [...a.method] : [''],
    deliverable: a.deliverable,
    tools: a.tools.length ? [...a.tools] : [''],
    modelHint: a.modelHint ?? '',
    scope: a.scope,
    folderId: a.folderId ?? ''
  }
}

/** A single-value list (rules, method steps, tools) edited in place — one row
 *  per item in the same "ash card" the house rules editor uses, so the whole
 *  app edits a list the same way. */
function ListEditor({
  label,
  items,
  onChange,
  placeholder,
  itemMax,
  addLabel,
  multiline
}: {
  label: string
  items: string[]
  onChange: (next: string[]) => void
  placeholder: string
  itemMax: number
  addLabel: string
  multiline?: boolean
}): React.JSX.Element {
  return (
    <div className="fe-field">
      <span className="fe-label">{label}</span>
      <div className="fe-rules">
        {items.map((v, i) => (
          <div key={i} className="fe-rule" style={{ '--i': i } as React.CSSProperties}>
            <div className="fe-rule-top">
              {multiline ? (
                <textarea
                  className="fe-rule-content"
                  rows={2}
                  maxLength={itemMax}
                  value={v}
                  placeholder={placeholder}
                  onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                />
              ) : (
                <input
                  className="fe-rule-title"
                  maxLength={itemMax}
                  value={v}
                  placeholder={placeholder}
                  onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                />
              )}
              <button
                className="fe-rule-remove"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="fe-add" onClick={() => onChange([...items, ''])}>
        + {addLabel}
      </button>
    </div>
  )
}

/** One report the crew card's run history: verdict, when, project, summary —
 *  and the findings behind it, expandable. */
function RunCard({ run }: { run: AgentRun }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <article className="crew-run-card">
      <div className="crew-run-head">
        <span className={`verdict-pill verdict-${run.verdict}`}>{VERDICT_LABEL[run.verdict]}</span>
        <span className="crew-run-when">{timeAgo(run.at)}</span>
        {run.projectName && <span className="badge">{run.projectName}</span>}
        {run.by && <span className="evidence faded">by {run.by}</span>}
      </div>
      <p className="crew-run-summary">{run.summary}</p>
      {run.findings.length > 0 && (
        <>
          <button className="disclosure" onClick={() => setOpen((o) => !o)}>
            {open
              ? 'Hide findings ▾'
              : `See ${run.findings.length} finding${run.findings.length > 1 ? 's' : ''} ▸`}
          </button>
          {open && (
            <div className="crew-findings">
              {run.findings.map((f, i) => (
                <div key={i} className="crew-finding">
                  <span className={`severity-tag severity-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
                  <div className="crew-finding-body">
                    <span className="crew-finding-title">{f.title}</span>
                    {f.detail && <span className="crew-finding-detail">{f.detail}</span>}
                    {f.where && <span className="crew-finding-where">{f.where}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </article>
  )
}

export function CrewScreen({
  projects,
  openId,
  onSelect
}: {
  projects: ProjectBundle[]
  /** The agent currently open in the detail pane */
  openId: string | null
  onSelect: (id: string | null) => void
}): React.JSX.Element {
  const { crew } = useCrew()
  const { folders } = useFolders()
  const mcp = useMcpInfo()
  const toast = useToast()
  const readFolder = React.useCallback((id: string) => folders.find((f) => f.id === id) ?? null, [folders])

  const selected = openId ? (crew.find((a) => a.id === openId) ?? null) : null

  // Land on a real agent whenever one exists and nothing (or a deleted one) is
  // open — the same "always show something" rule the project list follows.
  useEffect(() => {
    if (!crew.length) return
    if (!openId || !crew.some((a) => a.id === openId)) onSelect(crew[0].id)
  }, [crew, openId, onSelect])

  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [runProjectId, setRunProjectId] = useState('')
  const [brief, setBrief] = useState('')
  const [briefLoading, setBriefLoading] = useState(false)
  // The research behind a brief is the long read: available, never in the way.
  const [researchOpen, setResearchOpen] = useState(false)

  useEffect(() => {
    setEditing(false)
    setDraft(null)
    setConfirmDelete(false)
    setRunProjectId('')
    setResearchOpen(false)
  }, [selected?.id])

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3500)
    return () => clearTimeout(t)
  }, [confirmDelete])

  useEffect(() => {
    if (!selected || !runProjectId) {
      setBrief('')
      return
    }
    let cancelled = false
    setBriefLoading(true)
    window.specdrive
      .agentBrief(selected.id, runProjectId)
      .then((b) => {
        if (!cancelled) setBrief(b)
      })
      .catch(() => {
        if (!cancelled) toast('Could not put that prompt together — try again')
      })
      .finally(() => {
        if (!cancelled) setBriefLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, runProjectId])

  const integratePrompt = useMemo(() => fillPrompt(INTEGRATE_AGENT_PROMPT, '', undefined, mcp), [mcp])

  const addPreset = async (key: AgentPresetKey): Promise<void> => {
    const res = await window.specdrive.createAgent({ preset: key })
    if (res.error) {
      toast(res.error)
      return
    }
    toast(`“${AGENT_PRESET_LABEL[key]}” added — edit anything before you run it`)
    setAddOpen(false)
    onSelect(res.id)
  }

  const startEdit = (): void => {
    if (!selected) return
    setDraft(toDraft(selected))
    setEditing(true)
  }

  const saveEdits = async (): Promise<void> => {
    if (!selected || !draft) return
    const name = draft.name.trim()
    if (!name) {
      toast('Give your agent a name.')
      return
    }
    if (draft.scope === 'house' && !draft.folderId) {
      toast('Pick the house this agent belongs to, or make it available everywhere.')
      return
    }
    setBusy(true)
    try {
      const err = await window.specdrive.updateAgent(selected.id, {
        name,
        emoji: draft.emoji.trim() || '🤖',
        role: draft.role.trim(),
        mission: draft.mission.trim(),
        rules: draft.rules.map((r) => r.trim()).filter(Boolean),
        method: draft.method.map((m) => m.trim()).filter(Boolean),
        deliverable: draft.deliverable.trim(),
        tools: draft.tools.map((t) => t.trim()).filter(Boolean),
        modelHint: draft.modelHint.trim() || undefined
      })
      if (err) {
        toast(err)
        return
      }
      const scopeChanged =
        draft.scope !== selected.scope || (draft.scope === 'house' && draft.folderId !== (selected.folderId ?? ''))
      if (scopeChanged) {
        const scopeErr = await window.specdrive.setAgentScope(
          selected.id,
          draft.scope,
          draft.scope === 'house' ? draft.folderId : null
        )
        if (scopeErr) {
          toast(scopeErr)
          return
        }
      }
      toast(`“${name}” saved`)
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  const duplicate = async (): Promise<void> => {
    if (!selected) return
    const res = await window.specdrive.duplicateAgent(selected.id)
    if (res.error) {
      toast(res.error)
      return
    }
    toast(`“${selected.name}” duplicated`)
    onSelect(res.id)
  }

  const doDelete = async (): Promise<void> => {
    if (!selected) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setConfirmDelete(false)
    const name = selected.name
    const err = await window.specdrive.deleteAgent(selected.id)
    if (err) {
      toast(err)
      return
    }
    toast(`“${name}” deleted`)
    onSelect(null)
  }

  if (crew.length === 0) {
    return (
      <main className="content">
        <div className="content-head">
          <div className="content-title">
            <h1>Agents</h1>
            <span className="one-liner">Your own team, saved once, ready in every project</span>
          </div>
        </div>
        <div className="content-body">
          <div className="house-new">
            <div className="house-hero">
              <span className="rail-mini-label">Your agents</span>
              <h2>Your agents, saved once, ready in every project</h2>
              <p className="house-hero-line">
                Paste this into your agent and talk about who you need: a tester who tries the app like
                a real person, someone who checks the specs were honored, a security reviewer. It asks a
                few plain questions, saves the agent, and it appears here — ready to run in any project.
              </p>
              <div className="house-hero-do">
                <CopyButton text={integratePrompt} label="Copy the integrate prompt" />
                <PromptPeek text={integratePrompt} />
              </div>
            </div>
            <div className="house-alt">
              <div className="fe-presets crew-presets">
                <span className="fe-presets-label">Add ready-made:</span>
                {AGENT_PRESET_KEYS.map((k) => (
                  <button key={k} className="fe-chip" onClick={() => void addPreset(k)}>
                    + {AGENT_PRESET_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="content">
      <div className="content-head">
        <div className="content-title">
          <h1>Agents</h1>
          <span className="one-liner">Your own team, saved once, ready in every project</span>
        </div>
      </div>
      <div className="content-body">
        <div className="crew-page">
          <div className="crew-list">
            <div className="crew-list-head">
              <span className="rail-mini-label">
                {crew.length} agent{crew.length === 1 ? '' : 's'}
              </span>
              <button className="pill pill-white" onClick={() => setAddOpen((v) => !v)}>
                {addOpen ? 'Close' : '+ Add'}
              </button>
            </div>
            {addOpen && (
              <div className="crew-add-drawer">
                <div className="fe-presets">
                  <span className="fe-presets-label">Ready-made</span>
                  {AGENT_PRESET_KEYS.map((k) => (
                    <button key={k} className="fe-chip" onClick={() => void addPreset(k)}>
                      + {AGENT_PRESET_LABEL[k]}
                    </button>
                  ))}
                </div>
                <div className="house-hero-do">
                  <CopyButton text={integratePrompt} label="Copy the integrate prompt" quiet />
                  <PromptPeek text={integratePrompt} />
                </div>
              </div>
            )}
            <div className="crew-cards">
              {crew.map((a, i) => {
                const house = a.scope === 'house' ? readFolder(a.folderId ?? '') : null
                const scopeLabel = a.scope === 'global' ? 'Everywhere' : (house?.name ?? 'a house')
                const last = a.runs[0]
                return (
                  <button
                    key={a.id}
                    className={`crew-card${selected?.id === a.id ? ' active' : ''}`}
                    style={{ '--i': i } as React.CSSProperties}
                    onClick={() => onSelect(a.id)}
                  >
                    <span className="crew-card-emoji">{a.emoji}</span>
                    <span className="crew-card-body">
                      <span className="crew-card-name">{a.name}</span>
                      <span className="crew-card-role">{a.role}</span>
                      <span className="crew-card-meta">
                        <span className="badge">{scopeLabel}</span>
                        <span className="badge">
                          {a.runs.length} run{a.runs.length === 1 ? '' : 's'}
                        </span>
                        {a.sources && a.sources.length > 0 && (
                          <span className="badge crew-sourced" title="Built after reading published agents — see “Built from”">
                            sourced
                          </span>
                        )}
                        {last && (
                          <span className={`verdict-pill verdict-${last.verdict}`}>
                            {VERDICT_LABEL[last.verdict]}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {selected && (
            <div className="crew-detail">
              {editing && draft ? (
                <div className="folder-editor crew-editor">
                  <div className="fe-identity crew-fe-identity">
                    <label className="fe-field" style={{ maxWidth: 90 }}>
                      <span className="fe-label">Emoji</span>
                      <input
                        className="fe-input"
                        value={draft.emoji}
                        maxLength={8}
                        onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
                      />
                    </label>
                    <label className="fe-field">
                      <span className="fe-label">Name</span>
                      <input
                        className="fe-input"
                        value={draft.name}
                        maxLength={60}
                        autoFocus
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="fe-field">
                    <span className="fe-label">What it does — one line</span>
                    <input
                      className="fe-input"
                      value={draft.role}
                      maxLength={140}
                      placeholder="Tests the running product like a real person would"
                      onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                    />
                  </label>
                  <label className="fe-field">
                    <span className="fe-label">Its mission</span>
                    <textarea
                      className="fe-rule-content"
                      rows={3}
                      maxLength={4000}
                      value={draft.mission}
                      onChange={(e) => setDraft({ ...draft, mission: e.target.value })}
                    />
                  </label>

                  <ListEditor
                    label="Its rules — binding, every time"
                    items={draft.rules}
                    onChange={(rules) => setDraft({ ...draft, rules })}
                    placeholder="Never fix anything — finding and reporting is the whole job"
                    itemMax={400}
                    addLabel="Add a rule"
                    multiline
                  />
                  <ListEditor
                    label="How it works, in order"
                    items={draft.method}
                    onChange={(method) => setDraft({ ...draft, method })}
                    placeholder="Walk every scenario end to end, exactly as written"
                    itemMax={400}
                    addLabel="Add a step"
                    multiline
                  />

                  <label className="fe-field">
                    <span className="fe-label">What it hands back</span>
                    <textarea
                      className="fe-rule-content"
                      rows={2}
                      maxLength={1500}
                      value={draft.deliverable}
                      onChange={(e) => setDraft({ ...draft, deliverable: e.target.value })}
                    />
                  </label>

                  <ListEditor
                    label="Suggested tools"
                    items={draft.tools}
                    onChange={(tools) => setDraft({ ...draft, tools })}
                    placeholder="The running product itself"
                    itemMax={40}
                    addLabel="Add a tool"
                  />

                  <label className="fe-field" style={{ maxWidth: 220 }}>
                    <span className="fe-label">Suggested model (a hint only)</span>
                    <input
                      className="fe-input"
                      value={draft.modelHint}
                      maxLength={40}
                      placeholder="sonnet"
                      onChange={(e) => setDraft({ ...draft, modelHint: e.target.value })}
                    />
                  </label>

                  <div className="fe-field">
                    <span className="fe-label">Where it&rsquo;s available</span>
                    <div className="tabs crew-scope-tabs">
                      <button
                        className={`tab${draft.scope === 'global' ? ' active' : ''}`}
                        onClick={() => setDraft({ ...draft, scope: 'global' })}
                      >
                        Everywhere
                      </button>
                      <button
                        className={`tab${draft.scope === 'house' ? ' active' : ''}`}
                        onClick={() =>
                          setDraft({ ...draft, scope: 'house', folderId: draft.folderId || folders[0]?.id || '' })
                        }
                      >
                        One house
                      </button>
                    </div>
                    {draft.scope === 'house' && (
                      <select
                        className="fe-input"
                        value={draft.folderId}
                        onChange={(e) => setDraft({ ...draft, folderId: e.target.value })}
                      >
                        <option value="">Choose a house…</option>
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {chainLabel(houseChain(f.id, readFolder), ' › ')}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="fe-actions">
                    <button className="pill pill-primary" disabled={busy} onClick={() => void saveEdits()}>
                      Save
                    </button>
                    <button className="pill pill-quiet" disabled={busy} onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="crew-detail-head">
                    <span className="crew-detail-emoji">{selected.emoji}</span>
                    <div className="crew-detail-title">
                      <h2>{selected.name}</h2>
                      <p className="crew-detail-role">{selected.role}</p>
                    </div>
                    <div className="crew-detail-actions">
                      <span className="badge">
                        {selected.scope === 'global'
                          ? 'Everywhere'
                          : (readFolder(selected.folderId ?? '')?.name ?? 'a house')}
                      </span>
                      <button className="pill pill-white" onClick={startEdit}>
                        <PencilIcon />
                        Edit
                      </button>
                      <button className="pill pill-quiet" onClick={() => void duplicate()}>
                        Duplicate
                      </button>
                      <button
                        className={`house-delete${confirmDelete ? ' confirming' : ''}`}
                        onClick={() => void doDelete()}
                      >
                        {confirmDelete ? 'Really delete?' : 'Delete'}
                      </button>
                    </div>
                  </div>

                  {selected.description && (
                    <section className="crew-section">
                      <h3>When to use it</h3>
                      <p className="crew-body-text">{selected.description}</p>
                    </section>
                  )}

                  <section className="crew-section">
                    <h3>Mission</h3>
                    <p className="crew-body-text">{selected.mission}</p>
                  </section>

                  {selected.rules.length > 0 && (
                    <section className="crew-section">
                      <h3>Its rules</h3>
                      <ul className="crew-list-plain">
                        {selected.rules.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {selected.method.length > 0 && (
                    <section className="crew-section">
                      <h3>How it works</h3>
                      <ol className="crew-list-plain">
                        {selected.method.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ol>
                    </section>
                  )}

                  {selected.deliverable && (
                    <section className="crew-section">
                      <h3>What it hands back</h3>
                      <p className="crew-body-text">{selected.deliverable}</p>
                    </section>
                  )}

                  {(selected.tools.length > 0 || selected.modelHint) && (
                    <section className="crew-section">
                      <h3>Tools & model</h3>
                      <div className="crew-card-meta">
                        {selected.tools.map((t, i) => (
                          <span className="badge" key={i}>
                            {t}
                          </span>
                        ))}
                        {selected.modelHint && <span className="badge">Suggested: {selected.modelHint}</span>}
                      </div>
                      {selected.allowedTools && selected.allowedTools.length > 0 && (
                        <p className="crew-body-text crew-allowlist">
                          In your code folder it is allowed only: {selected.allowedTools.join(', ')}.
                          {selected.allowedTools.every((t) => t !== 'Edit' && t !== 'Write')
                            ? ' It cannot change anything.'
                            : ''}
                        </p>
                      )}
                    </section>
                  )}

                  {selected.sources && selected.sources.length > 0 && (
                    <section className="crew-section">
                      <h3>Built from</h3>
                      <p className="crew-body-text crew-built-lede">
                        What was read before this brief was written, and what each one gave it.
                      </p>
                      <ul className="crew-sources">
                        {selected.sources.map((s, i) => (
                          <li key={i}>
                            <a
                              href={s.url}
                              onClick={(e) => {
                                e.preventDefault()
                                window.specdrive.openExternal(s.url)
                              }}
                            >
                              {s.title || s.url}
                            </a>
                            {s.license && <span className="badge crew-license">{s.license}</span>}
                            <span className="crew-source-what">{s.what}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {selected.research && (
                    <section className="crew-section">
                      <button
                        className="disclosure"
                        onClick={() => setResearchOpen((o) => !o)}
                        aria-expanded={researchOpen}
                      >
                        {researchOpen ? 'Hide the research notes ▾' : 'Read the research notes ▸'}
                      </button>
                      {researchOpen && <p className="crew-body-text">{selected.research}</p>}
                    </section>
                  )}

                  <section className="crew-section crew-run">
                    <h3>Run on a project</h3>
                    <select
                      className="fe-input crew-run-picker"
                      value={runProjectId}
                      onChange={(e) => setRunProjectId(e.target.value)}
                    >
                      <option value="">Choose a project…</option>
                      {projects.map((p) => (
                        <option key={p.project.id} value={p.project.id}>
                          {p.project.name}
                        </option>
                      ))}
                    </select>
                    {runProjectId && (
                      <div className="crew-run-slot">
                        <div className="crew-slash">
                          <code>/mcp__specdrive__{promptNameFor(selected.slug)}</code>
                          <CopyButton text={`/mcp__specdrive__${promptNameFor(selected.slug)}`} label="Copy" quiet />
                        </div>
                        {briefLoading ? (
                          <p className="crew-body-text">Putting the prompt together…</p>
                        ) : (
                          brief && (
                            <>
                              <CopyButton text={brief} label="Copy the prompt" quiet />
                              <PromptPeek text={brief} />
                            </>
                          )
                        )}
                      </div>
                    )}
                  </section>

                  <section className="crew-section">
                    <h3>Run history</h3>
                    {selected.runs.length === 0 ? (
                      <p className="fe-empty">No runs yet — copy the slash command above into a project.</p>
                    ) : (
                      <div className="crew-runs">
                        {selected.runs.map((r) => (
                          <RunCard key={r.id} run={r} />
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
