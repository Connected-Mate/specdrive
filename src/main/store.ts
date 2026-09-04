// Read-side of the ~/.specdrive store (the MCP server owns the write side).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import type {
  ActivityEntry,
  Folder,
  FolderRule,
  OwnerComment,
  ProjectBundle,
  Project,
  Task
} from '../shared/types'
import { RULE_PRESETS, type PresetKey } from '../shared/folder-presets.mjs'
// Houses nest — the same inheritance logic the MCP server uses, so the app and
// an agent can never disagree about which rules reach a project.
import { MAX_HOUSE_DEPTH, canParent, chainLabel, houseChain } from '../shared/house-chain.mjs'

export const DATA_DIR = path.join(os.homedir(), '.specdrive')
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects')
export const FOLDERS_DIR = path.join(DATA_DIR, 'folders')

export function ensureDataDirs(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true })
  fs.mkdirSync(FOLDERS_DIR, { recursive: true })
  fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true })
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function readActivity(dir: string): ActivityEntry[] {
  let raw: string
  try {
    raw = fs.readFileSync(path.join(dir, 'activity.jsonl'), 'utf8')
  } catch {
    return []
  }
  const out: ActivityEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line) as ActivityEntry)
    } catch {
      // one bad line must not erase the feed
    }
  }
  return out.slice(-200)
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

function safeId(id: string): string | null {
  const base = path.basename(id)
  return SAFE_ID.test(base) ? base : null
}

/** Has the codebase moved while nobody was working on the board? Same rule as
 *  the MCP server (baseline = last seen ref, only after a 10-min idle gap), so
 *  the app never shows a drift badge during normal mark-done-then-commit work.
 *  Cheap and cached per HEAD: git runs once per project per new commit, with a
 *  timeout, never on every file-change tick. */
const DRIFT_IDLE_MS = 10 * 60 * 1000
const driftCache = new Map<string, { at: number; value: ProjectBundle['drift'] }>()

function computeDrift(project: Project, tasks: Task[]): ProjectBundle['drift'] {
  if (!project.codebasePath) return null
  const cached = driftCache.get(project.id)
  if (cached && Date.now() - cached.at < 30_000) return cached.value
  let value: ProjectBundle['drift'] = null
  try {
    const git = (args: string[]): string =>
      execFileSync('git', args, {
        cwd: project.codebasePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000
      }).trim()
    const head = git(['rev-parse', 'HEAD'])
    const lastTaskRef = tasks
      .filter((t) => t.status === 'done' && t.gitRef)
      .sort((a, b) => ((a.doneAt ?? '') < (b.doneAt ?? '') ? 1 : -1))[0]?.gitRef
    const baseRef = (project as { lastSeenRef?: string }).lastSeenRef ?? lastTaskRef
    if (!baseRef || baseRef === head) value = { moved: false, commits: 0 }
    else {
      const idle = Date.now() - new Date(project.updatedAt).getTime() > DRIFT_IDLE_MS
      let commits = 0
      try {
        commits = parseInt(git(['rev-list', '--count', `${baseRef}..${head}`]), 10) || 0
      } catch {
        commits = 0
      }
      value = { moved: idle, commits }
    }
  } catch {
    value = null
  }
  driftCache.set(project.id, { at: Date.now(), value })
  return value
}

export function loadBundle(id: string): ProjectBundle | null {
  const dir = path.join(PROJECTS_DIR, id)
  const project = readJson(path.join(dir, 'project.json'), null)
  if (!project) return null
  const tasks = readJson<Task[]>(path.join(dir, 'tasks.json'), [])
  return {
    project,
    specs: readJson(path.join(dir, 'specs.json'), []),
    tasks,
    wireframes: readJson(path.join(dir, 'wireframes.json'), []),
    flow: readJson(path.join(dir, 'flow.json'), null),
    scenarios: readJson(path.join(dir, 'scenarios.json'), []),
    planDoc: readJson(path.join(dir, 'plan-doc.json'), null),
    documents: readJson(path.join(dir, 'documents.json'), []),
    activity: readActivity(dir),
    comments: readJson(path.join(dir, 'comments.json'), []),
    folder: (project as { folderId?: string }).folderId
      ? readJson(path.join(DATA_DIR, 'folders', `${(project as { folderId?: string }).folderId}.json`), null)
      : null,
    // The whole line of houses above the project, outermost first — a house
    // can live inside another one, and the rules stack all the way down.
    houseChain: houseChain((project as { folderId?: string }).folderId, readFolder),
    drift: computeDrift(project as Project, tasks)
  } as ProjectBundle
}

export function listBundles(): ProjectBundle[] {
  ensureDataDirs()
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadBundle(d.name))
    .filter((b): b is ProjectBundle => b !== null)
    .sort((a, b) => (a.project.updatedAt < b.project.updatedAt ? 1 : -1))
}

export function readWireframe(projectId: string, file: string): string {
  // Defensive: never allow escaping the wireframes dir.
  const pid = safeId(projectId)
  const safe = path.basename(file)
  if (!pid || !/^[a-z0-9]+\.(html|json)$/.test(safe)) return '<p>Wireframe not found.</p>'
  try {
    return fs.readFileSync(path.join(PROJECTS_DIR, pid, 'wireframes', safe), 'utf8')
  } catch {
    return '<p>Wireframe not found.</p>'
  }
}

export function readDocument(projectId: string, file: string): string {
  const pid = safeId(projectId)
  const safe = path.basename(file)
  if (!pid || !/^[a-z0-9]+\.md$/.test(safe)) return 'Document not found.'
  try {
    return fs.readFileSync(path.join(PROJECTS_DIR, pid, 'documents', safe), 'utf8')
  } catch {
    return 'Document not found.'
  }
}

const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i

export function readImage(projectId: string, file: string): string {
  const pid = safeId(projectId)
  const safe = path.basename(file)
  if (!pid || !IMG_EXT.test(safe) || safe.includes('..')) return ''
  try {
    const buf = fs.readFileSync(path.join(PROJECTS_DIR, pid, 'documents', safe))
    const ext = safe.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg')
    return `data:image/${ext};base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

/** Same pid-stamped lock protocol as the MCP server: steal only a DEAD
 *  process's lock (a live holder just gets more time), and the ownership stamp
 *  inside the lock dir makes a non-owner's rmdir fail harmlessly. */
export function withFileLock<T>(metaFile: string, fn: () => T): T {
  const lock = metaFile + '.lock'
  const mine = path.join(lock, `owner-${process.pid}`)
  let deadline = Date.now() + 3000
  for (;;) {
    try {
      fs.mkdirSync(lock)
      fs.writeFileSync(mine, '')
      break
    } catch {
      if (Date.now() > deadline) {
        try {
          const owner = fs.readdirSync(lock).find((f) => f.startsWith('owner-'))
          const ownerPid = owner ? Number(owner.slice('owner-'.length)) : null
          let alive = false
          if (ownerPid) {
            try {
              process.kill(ownerPid, 0)
              alive = true
            } catch {
              // dead
            }
          }
          if (!alive) {
            if (owner) fs.unlinkSync(path.join(lock, owner))
            fs.rmdirSync(lock)
          } else {
            deadline = Date.now() + 3000
          }
        } catch {
          // lock vanished between checks — loop retries
        }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15) // real sleep, no CPU spin
    }
  }
  try {
    return fn()
  } finally {
    try {
      fs.unlinkSync(mine)
    } catch {
      // already stolen
    }
    try {
      fs.rmdirSync(lock)
    } catch {
      // someone else's stamp inside — their lock survives
    }
  }
}

export function addImage(projectId: string, name: string, dataBase64: string): string {
  const pid = safeId(projectId)
  if (!pid) return 'Unknown project.'
  const clean = path.basename(name)
  const m = IMG_EXT.exec(clean)
  if (!m) return 'Only png, jpg, gif or webp images.'
  const buf = Buffer.from(dataBase64, 'base64')
  if (buf.length > 8 * 1024 * 1024) return 'Image too large — 8 MB max.'
  const id = crypto.randomBytes(5).toString('hex')
  const file = `${id}${m[0].toLowerCase()}`
  const dir = path.join(PROJECTS_DIR, pid)
  fs.mkdirSync(path.join(dir, 'documents'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'documents', file), buf)
  const metaFile = path.join(dir, 'documents.json')
  // Same lock + atomic-write protocol as the MCP server — a concurrent
  // add_document must never tear this file.
  withFileLock(metaFile, () => {
    let docs: unknown[] = []
    try {
      docs = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    } catch {}
    docs.push({
      id,
      title: clean.replace(IMG_EXT, ''),
      kind: 'image',
      file,
      size: buf.length,
      createdAt: new Date().toISOString()
    })
    const tmp = `${metaFile}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(docs, null, 2))
    fs.renameSync(tmp, metaFile)
  })
  try {
    fs.appendFileSync(
      path.join(dir, 'activity.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), actor: 'app', action: 'add_image', summary: `Image added: "${clean}"` }) + '\n'
    )
  } catch {}
  return ''
}

/** The owner leaves a note on a spec/task/project card; the agent reads it
 *  through MCP on its next pass. Same lock + atomic-write protocol as
 *  addImage — a concurrent MCP write must never tear comments.json. */
export function addComment(projectId: string, target: OwnerComment['target'], text: string): string {
  const pid = safeId(projectId)
  if (!pid) return 'Unknown project.'
  const clean = text.trim()
  if (!clean) return 'Note is empty.'
  if (clean.length > 4000) return 'Note is too long — 4000 characters max.'
  const dir = path.join(PROJECTS_DIR, pid)
  fs.mkdirSync(dir, { recursive: true })
  const metaFile = path.join(dir, 'comments.json')
  withFileLock(metaFile, () => {
    let comments: OwnerComment[] = []
    try {
      comments = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    } catch {}
    comments.push({
      id: crypto.randomBytes(5).toString('hex'),
      target,
      text: clean,
      status: 'open',
      createdAt: new Date().toISOString()
    })
    const tmp = `${metaFile}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(comments, null, 2))
    fs.renameSync(tmp, metaFile)
  })
  try {
    fs.appendFileSync(
      path.join(dir, 'activity.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        actor: 'app',
        action: 'add_comment',
        summary: `Note left on a ${target.kind}`
      }) + '\n'
    )
  } catch {}
  return ''
}

/** Owner flips the "write AGENTS.md into the code folder" toggle. Same lock +
 *  atomic-write protocol as the MCP server's own project.json writes (withLock
 *  in mcp/server.mjs) — safe to touch from the app side alongside it. */
export function setSyncAgentsMd(projectId: string, on: boolean): void {
  const pid = safeId(projectId)
  if (!pid) return
  const metaFile = path.join(PROJECTS_DIR, pid, 'project.json')
  withFileLock(metaFile, () => {
    let project: Record<string, unknown>
    try {
      project = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    } catch {
      return
    }
    project.syncAgentsMd = on
    project.updatedAt = new Date().toISOString()
    const tmp = `${metaFile}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(project, null, 2))
    fs.renameSync(tmp, metaFile)
  })
}

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')
const SESSION_FRESH_MS = 75_000

export function listSessions(): import('../shared/types').LiveSession[] {
  let files: string[]
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: import('../shared/types').LiveSession[] = []
  for (const f of files) {
    const p = path.join(SESSIONS_DIR, f)
    try {
      const s = JSON.parse(fs.readFileSync(p, 'utf8'))
      const beat = s.heartbeatAt ?? s.lastToolAt
      if (Date.now() - new Date(beat).getTime() < SESSION_FRESH_MS) out.push(s)
      else fs.unlinkSync(p)
    } catch {
      try {
        fs.unlinkSync(p)
      } catch {}
    }
  }
  return out.sort((a, b) => (a.lastToolAt < b.lastToolAt ? 1 : -1))
}

export function deleteProject(id: string): void {
  const pid = safeId(id)
  if (!pid) return
  const dir = path.join(PROJECTS_DIR, pid)
  // Move to a trash dir instead of destroying data.
  const trash = path.join(DATA_DIR, 'trash')
  fs.mkdirSync(trash, { recursive: true })
  if (fs.existsSync(dir)) fs.renameSync(dir, path.join(trash, `${pid}-${Date.now()}`))
}

// ---------- folders: the owner's write side of the house rules ----------
// The MCP server can create folders and set rules on behalf of an agent; this
// is the same job done by the owner in the app. Validation, the lock protocol
// and the folders/<id>.log audit trail mirror mcp/server.mjs exactly, so a
// folder written here is indistinguishable from one an agent wrote.

const MAX_RULES = 30

/** Same slug rule as the MCP server's slugify() — ids must match across both. */
function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'folder'
  )
}

function folderFile(id: string): string {
  return path.join(FOLDERS_DIR, `${id}.json`)
}

/** Every rule change steers every future agent session — it goes in the folder's
 *  own log AND in the activity feed of every project inside it. Never silent. */
function logFolderChange(folderId: string, summary: string): void {
  try {
    fs.mkdirSync(FOLDERS_DIR, { recursive: true })
    fs.appendFileSync(path.join(FOLDERS_DIR, `${folderId}.log`), `${new Date().toISOString()} ${summary}\n`)
  } catch {
    // the log is an audit convenience, never a blocker
  }
  for (const b of listBundles()) {
    if (b.project.folderId === folderId) logProjectActivity(b.project.id, 'folder_rules', summary)
  }
}

function logProjectActivity(projectId: string, action: string, summary: string): void {
  const pid = safeId(projectId)
  if (!pid) return
  try {
    fs.appendFileSync(
      path.join(PROJECTS_DIR, pid, 'activity.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), actor: 'app', action, summary }) + '\n'
    )
  } catch {
    // a missing project dir must never break the folder write
  }
}

/** Trim, cap and de-duplicate what the editor sent. Returns an error string on
 *  anything the MCP server would also refuse, so both doors enforce one rule. */
function cleanRules(rules: FolderRule[]): { rules: FolderRule[]; error: string } {
  if (!Array.isArray(rules)) return { rules: [], error: 'No rules given.' }
  if (rules.length > MAX_RULES)
    return { rules: [], error: `That is too many rules — ${MAX_RULES} at most. A short, sharp list works far better.` }
  const out: FolderRule[] = []
  const seen = new Set<string>()
  for (const r of rules) {
    const title = String(r?.title ?? '').trim()
    const content = String(r?.content ?? '').trim()
    if (!title || !content) return { rules: [], error: 'Every rule needs a name and the rule itself.' }
    if (title.length > 80) return { rules: [], error: `“${title.slice(0, 30)}…” — the rule name is too long (80 characters max).` }
    if (content.length > 2000) return { rules: [], error: `“${title}” — the rule itself is too long (2000 characters max).` }
    const key = title.toLowerCase()
    if (seen.has(key)) continue // same rule twice is one rule
    seen.add(key)
    const appliesTo = String(r?.appliesTo ?? '').trim()
    if (appliesTo.length > 200) return { rules: [], error: `“${title}” — the “only for” pattern is too long.` }
    // A scope is a path glob, never a shell command or a path escape.
    if (appliesTo && (/\.\./.test(appliesTo) || /[\s;&|`$<>()]/.test(appliesTo)))
      return { rules: [], error: `“${title}” — “only for” must be a simple folder pattern like ios/** or src/api/*.ts` }
    const rule: FolderRule = { title, content }
    if (appliesTo) rule.appliesTo = appliesTo
    const supersedes = String(r?.supersedes ?? '').trim()
    if (supersedes) rule.supersedes = supersedes.slice(0, 80)
    out.push(rule)
  }
  return { rules: out, error: '' }
}

/** The owner wrote them, in the app: provenance is stamped here, never sent in.
 *  A rule the owner typed is approved by definition. */
function stampOwner(rules: FolderRule[], previous: FolderRule[]): FolderRule[] {
  const setAt = new Date().toISOString()
  const prevByTitle = new Map(previous.map((r) => [r.title, r]))
  return rules.map((r) => {
    const prev = prevByTitle.get(r.title)
    // An untouched rule keeps its original provenance — re-saving the list is
    // not re-authoring it (same rule as the MCP server's set_folder_rules).
    if (prev && prev.content === r.content && (prev.appliesTo ?? '') === (r.appliesTo ?? '')) {
      return { ...r, setBy: prev.setBy, setAt: prev.setAt, confirmedByOwner: true }
    }
    return { ...r, setBy: 'owner' as const, setAt, confirmedByOwner: true }
  })
}

export function listFolders(): Folder[] {
  fs.mkdirSync(FOLDERS_DIR, { recursive: true })
  return fs
    .readdirSync(FOLDERS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson<Folder | null>(path.join(FOLDERS_DIR, f), null))
    .filter((f): f is Folder => Boolean(f && f.id && f.name))
    .map((f) => ({ ...f, rules: Array.isArray(f.rules) ? f.rules : [] }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function readFolder(id: string): Folder | null {
  const fid = safeId(id)
  if (!fid) return null
  const f = readJson<Folder | null>(folderFile(fid), null)
  return f ? { ...f, rules: Array.isArray(f.rules) ? f.rules : [] } : null
}

function writeFolder(folder: Folder): void {
  const file = folderFile(folder.id)
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(folder, null, 2))
  fs.renameSync(tmp, file)
}

export function createFolder(
  name: string,
  description: string,
  rules: FolderRule[],
  presets: PresetKey[],
  parentId?: string | null
): { id: string; error: string } {
  const clean = name.trim()
  if (!clean) return { id: '', error: 'Give the folder a name.' }
  if (clean.length > 60) return { id: '', error: 'That name is too long — 60 characters max.' }
  const desc = description.trim().slice(0, 200)
  const presetRules = (presets ?? []).flatMap((p) => RULE_PRESETS[p] ?? [])
  const merged = cleanRules([...presetRules, ...(rules ?? [])].slice(0, MAX_RULES))
  if (merged.error) return { id: '', error: merged.error }
  // A brand-new house can be born inside another one — same depth guard the
  // MCP server applies.
  let pid: string | undefined
  if (parentId) {
    const safeParent = safeId(parentId)
    const parent = safeParent ? readFolder(safeParent) : null
    if (!parent) return { id: '', error: 'The house you picked to put this one in no longer exists.' }
    if (houseChain(parent.id, readFolder).length >= MAX_HOUSE_DEPTH)
      return {
        id: '',
        error: `“${parent.name}” is already ${MAX_HOUSE_DEPTH} houses deep — nothing more can go inside it.`
      }
    pid = parent.id
  }

  fs.mkdirSync(FOLDERS_DIR, { recursive: true })
  let id = slugifyName(clean)
  if (fs.existsSync(folderFile(id))) id = `${id}-${crypto.randomBytes(2).toString('hex')}`
  const now = new Date().toISOString()
  const folder: Folder = {
    id,
    name: clean,
    description: desc || undefined,
    parentId: pid,
    rules: stampOwner(merged.rules, []),
    createdAt: now,
    updatedAt: now
  }
  withFileLock(folderFile(id), () => writeFolder(folder))
  const inside = pid ? ` inside "${chainLabel(houseChain(pid, readFolder))}"` : ''
  logFolderChange(
    id,
    `Folder "${clean}" created by the owner${inside} with ${folder.rules.length} house rule(s): ${folder.rules.map((r) => r.title).join(', ') || 'none'}`
  )
  return { id, error: '' }
}

export function updateFolder(
  id: string,
  patch: { name?: string; description?: string; parentId?: string | null }
): string {
  const fid = safeId(id)
  if (!fid) return 'Unknown folder.'
  // Moving the house is its own guarded operation (cycles, depth) — do it
  // first, so a refused move never half-applies with a rename.
  if (patch.parentId !== undefined) {
    const moveErr = moveFolder(fid, patch.parentId ?? null)
    if (moveErr) return moveErr
  }
  if (patch.name === undefined && patch.description === undefined) return ''
  const file = folderFile(fid)
  let error = ''
  withFileLock(file, () => {
    const folder = readJson<Folder | null>(file, null)
    if (!folder) {
      error = 'That folder no longer exists.'
      return
    }
    if (patch.name !== undefined) {
      const clean = patch.name.trim()
      if (!clean) {
        error = 'Give the folder a name.'
        return
      }
      if (clean.length > 60) {
        error = 'That name is too long — 60 characters max.'
        return
      }
      folder.name = clean
    }
    if (patch.description !== undefined) {
      const desc = patch.description.trim().slice(0, 200)
      if (desc) folder.description = desc
      else delete folder.description
    }
    folder.updatedAt = new Date().toISOString()
    writeFolder(folder)
  })
  if (!error && patch.name !== undefined) logFolderChange(fid, `Folder renamed to "${patch.name.trim()}" by the owner`)
  return error
}

/** Put a house inside another one, or pass null to bring it back to the top.
 *  Refuses exactly what the MCP server's set_folder_parent refuses — itself, a
 *  house that already lives inside it (a cycle), and silly depths. */
export function moveFolder(id: string, parentId: string | null): string {
  const fid = safeId(id)
  if (!fid) return 'Unknown folder.'
  const folder = readFolder(fid)
  if (!folder) return 'That folder no longer exists.'
  const pid = parentId ? safeId(parentId) : null
  if (parentId && !pid) return 'Unknown house.'
  if ((folder.parentId ?? null) === (pid ?? null)) return ''
  if (pid) {
    const refusal = canParent(fid, pid, readFolder, listFolders())
    if (refusal) return refusal
  }
  const file = folderFile(fid)
  let error = ''
  withFileLock(file, () => {
    const fresh = readJson<Folder | null>(file, null)
    if (!fresh) {
      error = 'That folder no longer exists.'
      return
    }
    if (pid) fresh.parentId = pid
    else delete fresh.parentId
    fresh.updatedAt = new Date().toISOString()
    writeFolder(fresh)
  })
  if (error) return error
  logFolderChange(
    fid,
    pid
      ? `Folder "${folder.name}" moved inside "${chainLabel(houseChain(pid, readFolder))}" by the owner — its rules now apply here too`
      : `Folder "${folder.name}" moved back to the top level by the owner — it no longer inherits any rules`
  )
  return ''
}

export function setFolderRules(id: string, rules: FolderRule[]): string {
  const fid = safeId(id)
  if (!fid) return 'Unknown folder.'
  const cleaned = cleanRules(rules)
  if (cleaned.error) return cleaned.error
  const file = folderFile(fid)
  let error = ''
  let added: string[] = []
  let removed: string[] = []
  let name = ''
  withFileLock(file, () => {
    const folder = readJson<Folder | null>(file, null)
    if (!folder) {
      error = 'That folder no longer exists.'
      return
    }
    const previous = Array.isArray(folder.rules) ? folder.rules : []
    const before = new Set(previous.map((r) => r.title))
    const after = new Set(cleaned.rules.map((r) => r.title))
    added = cleaned.rules.filter((r) => !before.has(r.title)).map((r) => r.title)
    removed = previous.filter((r) => !after.has(r.title)).map((r) => r.title)
    name = folder.name
    folder.rules = stampOwner(cleaned.rules, previous)
    folder.updatedAt = new Date().toISOString()
    writeFolder(folder)
  })
  if (error) return error
  if (added.length || removed.length) {
    logFolderChange(
      fid,
      `House rules changed on "${name}" by the owner${added.length ? ` — added: ${added.join(', ')}` : ''}${removed.length ? ` — removed: ${removed.join(', ')}` : ''}`
    )
  }
  return ''
}

/** Delete is explicit about everything inside: sub-houses and projects MOVE UP
 *  one level — to this house's own parent, or to the top when it had none — and
 *  each move is logged in the folder log and in the project's activity feed.
 *  Only then is the folder itself set aside in the trash. Nothing is silently
 *  orphaned, and nothing quietly loses rules it never knew it had. */
export function deleteFolder(id: string): string {
  const fid = safeId(id)
  if (!fid) return 'Unknown folder.'
  const folder = readFolder(fid)
  if (!folder) return 'That folder no longer exists.'
  const up = folder.parentId && readFolder(folder.parentId) ? folder.parentId : null
  const children = listFolders().filter((f) => f.parentId === fid)
  for (const child of children) {
    // Straight to the file: moveFolder would refuse nothing here, but going
    // through it keeps the log line and the guards in one place.
    const err = moveFolder(child.id, up)
    if (err) return `Could not move “${child.name}” out of this house — nothing was deleted.`
  }
  const inside = listBundles().filter((b) => b.project.folderId === fid)
  for (const b of inside) {
    const err = assignProjectFolder(b.project.id, up)
    if (err) return `Could not move "${b.project.name}" out of the folder — nothing was deleted.`
  }
  const where = up ? `"${chainLabel(houseChain(up, readFolder))}"` : 'the top level'
  logFolderChange(
    fid,
    `Folder "${folder.name}" deleted by the owner` +
      (children.length || inside.length
        ? ` — ${children.length ? `${children.length} sub-house(s)` : ''}${children.length && inside.length ? ' and ' : ''}${inside.length ? `${inside.length} project(s)` : ''} moved up to ${where} first`
        : '')
  )
  const trash = path.join(DATA_DIR, 'trash')
  fs.mkdirSync(trash, { recursive: true })
  try {
    fs.renameSync(folderFile(fid), path.join(trash, `folder-${fid}-${Date.now()}.json`))
  } catch {
    return 'That folder no longer exists.'
  }
  return ''
}

/** Put a project in a folder (or take it out). Mirrors assign_project_folder. */
export function assignProjectFolder(projectId: string, folderId: string | null): string {
  const pid = safeId(projectId)
  if (!pid) return 'Unknown project.'
  const fid = folderId ? safeId(folderId) : null
  if (folderId && !fid) return 'Unknown folder.'
  const folder = fid ? readFolder(fid) : null
  if (fid && !folder) return 'That folder no longer exists.'
  const metaFile = path.join(PROJECTS_DIR, pid, 'project.json')
  let error = ''
  let changed = false
  let projectName = ''
  withFileLock(metaFile, () => {
    const project = readJson<Record<string, unknown> | null>(metaFile, null)
    if (!project) {
      error = 'That project no longer exists.'
      return
    }
    projectName = String(project.name ?? pid)
    if ((project.folderId ?? null) === (fid ?? null)) return
    if (fid) project.folderId = fid
    else delete project.folderId
    project.updatedAt = new Date().toISOString()
    const tmp = `${metaFile}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(project, null, 2))
    fs.renameSync(tmp, metaFile)
    changed = true
  })
  if (error) return error
  if (changed) {
    logProjectActivity(
      pid,
      'assign_folder',
      folder ? `Project placed in folder "${folder.name}" by the owner` : 'Project taken out of its folder by the owner'
    )
    if (folder) {
      try {
        fs.appendFileSync(
          path.join(FOLDERS_DIR, `${folder.id}.log`),
          `${new Date().toISOString()} Project "${projectName}" placed in this folder by the owner\n`
        )
      } catch {}
    }
  }
  return ''
}

/** Stamp the owner's "write AGENTS.md into the code folder" preference onto any
 *  project that has never been told either way. Done once per project, so the
 *  per-project toggle in the app always reflects what actually happens on disk
 *  and flipping the preference later never rewrites a deliberate choice. */
export function applyAgentsMdDefault(defaultOn: boolean): void {
  let dirs: string[]
  try {
    dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return
  }
  for (const pid of dirs) {
    const metaFile = path.join(PROJECTS_DIR, pid, 'project.json')
    const project = readJson<Record<string, unknown> | null>(metaFile, null)
    if (!project || project.syncAgentsMd !== undefined) continue
    withFileLock(metaFile, () => {
      const fresh = readJson<Record<string, unknown> | null>(metaFile, null)
      if (!fresh || fresh.syncAgentsMd !== undefined) return
      fresh.syncAgentsMd = defaultOn
      const tmp = `${metaFile}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(fresh, null, 2))
      fs.renameSync(tmp, metaFile)
    })
  }
}

// ---------- "Re-check everything": the owner's own proof run ----------
// The same commands the agent registered, run by the app this time. Green marks
// must be earnable again by the person who owns the product, not only by the
// agent that claimed them.

const RERUN_TIMEOUT_MS = 120_000

function runOne(command: string, cwd: string): Promise<{ exitCode: number; durationMs: number; timedOut: boolean; outputTail: string }> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    execFile(
      '/bin/sh',
      ['-lc', command],
      { cwd, timeout: RERUN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const out = `${stdout ?? ''}${stderr ?? ''}`
        let exitCode = 0
        let timedOut = false
        if (err) {
          if ((err as { killed?: boolean }).killed || (err as { signal?: string }).signal) {
            timedOut = true
            exitCode = -1
          } else exitCode = typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : 1
        }
        resolve({ exitCode, durationMs: Date.now() - startedAt, timedOut, outputTail: out.slice(-4000) })
      }
    )
  })
}

export interface RerunResult {
  ok: boolean
  /** Plain-words summary for the owner */
  message: string
  ran: number
  failed: number
}

export async function rerunChecks(projectId: string): Promise<RerunResult> {
  const pid = safeId(projectId)
  if (!pid) return { ok: false, message: 'Unknown project.', ran: 0, failed: 0 }
  const dir = path.join(PROJECTS_DIR, pid)
  const metaFile = path.join(dir, 'project.json')
  const tasksFile = path.join(dir, 'tasks.json')
  let project: Project
  let tasks: Task[]
  try {
    project = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'))
  } catch {
    return { ok: false, message: 'This project has nothing to re-check yet.', ran: 0, failed: 0 }
  }
  const codePath = project.codebasePath
  if (!codePath || !fs.existsSync(codePath)) {
    return {
      ok: false,
      message: 'SpecDrive does not know where this project’s code lives, so it cannot run the checks. Ask your agent to record the code folder.',
      ran: 0,
      failed: 0
    }
  }
  const home = os.homedir()
  const real = fs.realpathSync(codePath)
  if (real !== home && !real.startsWith(home + path.sep)) {
    return { ok: false, message: 'The code folder sits outside your home folder — SpecDrive only runs checks inside it.', ran: 0, failed: 0 }
  }
  const targets = tasks.filter((t) => t.status === 'done' && t.verifyCommand)
  if (!targets.length) {
    return {
      ok: false,
      message: 'No finished step carries a check SpecDrive can run — every green mark here rests on your agent’s word. Ask it to give the steps a check command.',
      ran: 0,
      failed: 0
    }
  }
  const results: { id: string; exitCode: number; durationMs: number; timedOut: boolean; outputTail: string; command: string }[] = []
  for (const t of targets) {
    const run = await runOne(t.verifyCommand as string, real)
    results.push({ id: t.id, command: t.verifyCommand as string, ...run })
  }
  const ranAt = new Date().toISOString()
  withFileLock(metaFile, () => {
    let all: Task[]
    try {
      all = JSON.parse(fs.readFileSync(tasksFile, 'utf8'))
    } catch {
      return
    }
    for (const r of results) {
      const t = all.find((x) => x.id === r.id)
      if (!t) continue
      t.proofRun = {
        command: r.command,
        exitCode: r.exitCode,
        durationMs: r.durationMs,
        timedOut: r.timedOut,
        outputTail: r.outputTail,
        ranAt
      }
      t.lastRerunAt = ranAt
      if (r.exitCode !== 0) {
        t.stale = true
        t.staleSince = ranAt
        t.staleBecause = 'rerun'
        t.staleReason = 'Its check failed when you re-ran it just now'
      }
      t.updatedAt = ranAt
    }
    const tmp = `${tasksFile}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2))
    fs.renameSync(tmp, tasksFile)
  })
  const failed = results.filter((r) => r.exitCode !== 0)
  const names = failed.map((r) => `“${targets.find((t) => t.id === r.id)?.title ?? 'a step'}”`).join(', ')
  return {
    ok: failed.length === 0,
    ran: results.length,
    failed: failed.length,
    message: failed.length
      ? `${failed.length} of ${results.length} checks failed just now: ${names}. Those steps are marked for a re-check — tell your agent.`
      : `All ${results.length} checks passed again just now — the green marks are earned, not remembered.`
  }
}

// ---------- "Waiting on you": what the owner alone can unblock ----------
// Across every project, the three things that actually stall the loop: a
// question only the owner can answer, a step the agent could not finish, and a
// step it parked. Everything else is the agent's job, not the owner's.

export interface WaitingItem {
  id: string
  projectId: string
  projectName: string
  kind: 'question' | 'blocked' | 'deferred' | 'failed'
  title: string
  /** Plain words: the question, or why the step stopped */
  detail: string
  /** For a question: what the agent recommends if the owner has no opinion */
  suggestion?: string
  /** What the owner's answer gets attached to */
  target: OwnerComment['target']
  since: string
}

const QUESTION_RE = /^question\s*:?\s*/i

export function listWaiting(): WaitingItem[] {
  const out: WaitingItem[] = []
  for (const b of listBundles()) {
    const name = b.project.name
    const answered = new Set(
      (b.comments ?? []).filter((c) => c.target.kind === 'spec').map((c) => c.target.id)
    )
    for (const sp of b.specs) {
      if (sp.category !== 'decisions' || !QUESTION_RE.test(sp.title.trim())) continue
      if (sp.status === 'confirmed' || answered.has(sp.id)) continue
      const body = sp.content.trim()
      out.push({
        id: `q-${b.project.id}-${sp.id}`,
        projectId: b.project.id,
        projectName: name,
        kind: 'question',
        title: sp.title.replace(QUESTION_RE, '').trim() || sp.title,
        detail: body.split('\n')[0] ?? '',
        suggestion: body.length > (body.split('\n')[0] ?? '').length ? body : undefined,
        target: { kind: 'spec', id: sp.id },
        since: sp.updatedAt
      })
    }
    const answeredTasks = new Set(
      (b.comments ?? []).filter((c) => c.target.kind === 'task').map((c) => c.target.id)
    )
    for (const t of b.tasks) {
      if (!['blocked', 'deferred', 'failed'].includes(t.status)) continue
      if (answeredTasks.has(t.id)) continue
      out.push({
        id: `t-${b.project.id}-${t.id}`,
        projectId: b.project.id,
        projectName: name,
        kind: t.status as WaitingItem['kind'],
        title: t.title,
        detail: t.note ?? (t.status === 'blocked' ? 'The agent could not get past this one.' : 'Set aside for now.'),
        target: { kind: 'task', id: t.id },
        since: t.updatedAt
      })
    }
  }
  return out.sort((a, b) => b.since.localeCompare(a.since))
}
