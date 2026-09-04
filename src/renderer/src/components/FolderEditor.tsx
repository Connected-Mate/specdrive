import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Folder, FolderRule, ProjectBundle } from '@shared/types'
import { PRESET_KEYS, PRESET_LABEL, RULE_PRESETS } from '@shared/folder-presets.mjs'
import type { PresetKey } from '@shared/folder-presets.mjs'
import { ruleProvenance } from '@/lib/labels'
import { chainLabel, houseChain, possibleParents } from '@shared/house-chain.mjs'
import { useFolders } from '@/lib/useLive'
import { useToast } from './Toast'

// The owner's side of what an agent does with create_folder / set_folder_rules.
// A folder is a house: the rules written here travel into every agent session
// working on any project inside it, so the editor says that in plain words and
// never lets a half-written rule through.

/** A rule while it is being edited — same shape, but everything is a string. */
interface DraftRule {
  key: string
  title: string
  content: string
  appliesTo: string
  /** Provenance carried over from the saved rule, shown but never edited */
  saved?: FolderRule
}

let seq = 0
const nextKey = (): string => `r${++seq}`

function toDraft(rules: FolderRule[]): DraftRule[] {
  return rules.map((r) => ({
    key: nextKey(),
    title: r.title,
    content: r.content,
    appliesTo: r.appliesTo ?? '',
    saved: r
  }))
}

function toRules(draft: DraftRule[]): FolderRule[] {
  return draft
    .filter((d) => d.title.trim() || d.content.trim())
    .map((d) => {
      const rule: FolderRule = { title: d.title.trim(), content: d.content.trim() }
      if (d.appliesTo.trim()) rule.appliesTo = d.appliesTo.trim()
      return rule
    })
}

export function FolderEditor({
  folder,
  projects,
  identityOnly = false,
  onDone,
  onCancel
}: {
  /** Rules are edited on their own cards now; this panel is then just the
   *  house's name, its one-line description and where it lives. */
  identityOnly?: boolean
  /** null = a brand-new folder */
  folder: Folder | null
  projects: ProjectBundle[]
  onDone: (folderId: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [name, setName] = useState(folder?.name ?? '')
  const [description, setDescription] = useState(folder?.description ?? '')
  const [rules, setRules] = useState<DraftRule[]>(() => toDraft(folder?.rules ?? []))
  // Which house this one lives inside ('' = on its own, at the top).
  const [parentId, setParentId] = useState(folder?.parentId ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setName(folder?.name ?? '')
    setDescription(folder?.description ?? '')
    setRules(toDraft(folder?.rules ?? []))
    setParentId(folder?.parentId ?? '')
    setError('')
    setConfirmDelete(false)
  }, [folder])

  // Houses nest: this one can move into any house that is not itself and does
  // not already live inside it.
  const { folders } = useFolders()
  const readFolder = useCallback(
    (id: string) => folders.find((f) => f.id === id) ?? null,
    [folders]
  )
  const parentChoices = useMemo(
    () => possibleParents(folder?.id ?? null, folders, readFolder),
    [folder, folders, readFolder]
  )
  const parentPath = useMemo(
    () => (parentId ? chainLabel(houseChain(parentId, readFolder)) : ''),
    [parentId, readFolder]
  )
  const subHouses = useMemo(
    () => (folder ? folders.filter((f) => f.parentId === folder.id) : []),
    [folder, folders]
  )

  const inside = useMemo(
    () => (folder ? projects.filter((p) => p.project.folderId === folder.id) : []),
    [projects, folder]
  )
  const outside = useMemo(
    () => (folder ? projects.filter((p) => p.project.folderId !== folder.id) : []),
    [projects, folder]
  )

  const titles = useMemo(
    () => new Set(rules.map((r) => r.title.trim().toLowerCase()).filter(Boolean)),
    [rules]
  )

  const addPreset = (key: PresetKey): void => {
    const fresh = RULE_PRESETS[key]
      .filter((r) => !titles.has(r.title.toLowerCase()))
      .map((r) => ({ key: nextKey(), title: r.title, content: r.content, appliesTo: '' }))
    if (!fresh.length) {
      toast(`Those ${PRESET_LABEL[key].toLowerCase()} rules are already in this folder`)
      return
    }
    setRules((r) => [...r, ...fresh])
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const clean = toRules(rules)
      if (folder) {
        const nameErr = await window.specdrive.updateFolder(folder.id, {
          name,
          description,
          parentId: parentId || null
        })
        if (nameErr) {
          setError(nameErr)
          return
        }
        const ruleErr = await window.specdrive.setFolderRules(folder.id, clean)
        if (ruleErr) {
          setError(ruleErr)
          return
        }
        toast(`“${name.trim()}” saved — every project inside follows these rules`)
        onDone(folder.id)
      } else {
        const res = await window.specdrive.createFolder(
          name,
          description,
          clean,
          [],
          parentId || null
        )
        if (res.error) {
          setError(res.error)
          return
        }
        toast(`Folder “${name.trim()}” created`)
        onDone(res.id)
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!folder) return
    setBusy(true)
    try {
      const err = await window.specdrive.deleteFolder(folder.id)
      if (err) {
        setError(err)
        return
      }
      const up = folder.parentId ? `“${chainLabel(houseChain(folder.parentId, readFolder))}”` : 'the top level'
      const moved = [
        inside.length ? `${inside.length} project${inside.length > 1 ? 's' : ''}` : '',
        subHouses.length ? `${subHouses.length} house${subHouses.length > 1 ? 's' : ''}` : ''
      ].filter(Boolean)
      toast(
        moved.length
          ? `“${folder.name}” deleted — ${moved.join(' and ')} moved up to ${up}`
          : `“${folder.name}” deleted`
      )
      onCancel()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="folder-editor">
      <div className="fe-identity">
        <label className="fe-field">
          <span className="fe-label">Folder name</span>
          <input
            className="fe-input"
            value={name}
            maxLength={60}
            placeholder="Acme internal tools"
            onChange={(e) => setName(e.target.value)}
            autoFocus={!folder}
          />
        </label>
        <label className="fe-field">
          <span className="fe-label">What lives here</span>
          <input
            className="fe-input"
            value={description}
            maxLength={200}
            placeholder="Everything we build for the sales team"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="fe-field fe-parent">
          <span className="fe-label">Lives inside</span>
          <select className="fe-input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Nothing — it stands on its own</option>
            {parentChoices.map((f) => (
              <option key={f.id} value={f.id}>
                {chainLabel(houseChain(f.id, readFolder), ' › ')}
              </option>
            ))}
          </select>
          <span className="fe-hint">
            {parentId
              ? `Everything in ${parentPath} applies here too. A rule with the same name as one up there replaces it.`
              : 'Put it inside a bigger house to inherit its rules — a company, then its teams.'}
          </span>
        </label>
      </div>

      {!identityOnly && (
        <>
      <div className="fe-rules-head">
        <h3>House rules</h3>
        <p>
          Every project in this folder follows them, in every step, without being reminded. Keep them
          few and sharp — a handful of precise rules works far better than a long list.
        </p>
        <div className="fe-presets">
          <span className="fe-presets-label">Start from a ready-made set</span>
          {PRESET_KEYS.map((k) => (
            <button key={k} className="fe-chip" onClick={() => addPreset(k)}>
              + {PRESET_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {rules.length === 0 && (
        <p className="fe-empty">
          No rules yet. Add one below, or pick a ready-made set — you can edit every word afterwards.
        </p>
      )}

      <div className="fe-rules">
        {rules.map((r, i) => {
          const prov = r.saved ? ruleProvenance(r.saved) : ''
          return (
            <div key={r.key} className="fe-rule" style={{ '--i': i } as React.CSSProperties}>
              <div className="fe-rule-top">
                <input
                  className="fe-rule-title"
                  value={r.title}
                  maxLength={80}
                  placeholder="Short name, e.g. “Data stays in the EU”"
                  onChange={(e) =>
                    setRules((all) => all.map((x) => (x.key === r.key ? { ...x, title: e.target.value } : x)))
                  }
                />
                <button
                  className="fe-rule-remove"
                  aria-label={`Remove the rule ${r.title || 'without a name'}`}
                  onClick={() => setRules((all) => all.filter((x) => x.key !== r.key))}
                >
                  ✕
                </button>
              </div>
              <textarea
                className="fe-rule-content"
                value={r.content}
                maxLength={2000}
                rows={2}
                placeholder="The rule itself — precise enough that anyone can tell whether it was followed."
                onChange={(e) =>
                  setRules((all) => all.map((x) => (x.key === r.key ? { ...x, content: e.target.value } : x)))
                }
              />
              <div className="fe-rule-foot">
                <label className="fe-scope">
                  Only for
                  <input
                    className="fe-scope-input"
                    value={r.appliesTo}
                    maxLength={200}
                    placeholder="everything (leave empty)"
                    onChange={(e) =>
                      setRules((all) =>
                        all.map((x) => (x.key === r.key ? { ...x, appliesTo: e.target.value } : x))
                      )
                    }
                  />
                </label>
                {prov && <span className="fe-provenance">{prov}</span>}
              </div>
            </div>
          )
        })}
      </div>

      <button
        className="fe-add"
        onClick={() =>
          setRules((all) => [...all, { key: nextKey(), title: '', content: '', appliesTo: '' }])
        }
      >
        + Add a rule
      </button>

        </>
      )}
      {folder && (
        <div className="fe-projects">
          <h3>Projects in this folder</h3>
          {inside.length === 0 && <p className="fe-empty">Nothing in here yet.</p>}
          {inside.map((p) => (
            <div key={p.project.id} className="fe-project-row">
              <span className="fe-project-name">{p.project.name}</span>
              <button
                className="pill pill-quiet"
                onClick={async () => {
                  const err = await window.specdrive.assignProjectFolder(p.project.id, null)
                  if (err) toast(err)
                  else toast(`“${p.project.name}” taken out of ${folder.name}`)
                }}
              >
                Take out
              </button>
            </div>
          ))}
          {outside.length > 0 && (
            <label className="fe-field fe-add-project">
              <span className="fe-label">Put another project in here</span>
              <select
                className="fe-input"
                value=""
                onChange={async (e) => {
                  const id = e.target.value
                  if (!id) return
                  const err = await window.specdrive.assignProjectFolder(id, folder.id)
                  if (err) toast(err)
                  else toast(`Moved into ${folder.name} — its rules now apply`)
                }}
              >
                <option value="">Choose a project…</option>
                {outside.map((p) => (
                  <option key={p.project.id} value={p.project.id}>
                    {p.project.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {error && <p className="fe-error">{error}</p>}

      <div className="fe-actions">
        <button className="pill pill-primary" disabled={busy} onClick={save}>
          {folder ? 'Save the rules' : 'Create the folder'}
        </button>
        <button className="pill pill-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {folder && (
          <button
            className={`fe-delete${confirmDelete ? ' confirming' : ''}`}
            disabled={busy}
            onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}
          >
            {confirmDelete
              ? inside.length || subHouses.length
                ? `Really delete? ${[
                    inside.length ? `${inside.length} project${inside.length > 1 ? 's' : ''}` : '',
                    subHouses.length ? `${subHouses.length} house${subHouses.length > 1 ? 's' : ''} inside` : ''
                  ]
                    .filter(Boolean)
                    .join(' and ')} move up to ${folder.parentId ? `“${chainLabel(houseChain(folder.parentId, readFolder))}”` : 'the top level'}`
                : 'Really delete this folder?'
              : 'Delete this folder'}
          </button>
        )}
      </div>
    </div>
  )
}
