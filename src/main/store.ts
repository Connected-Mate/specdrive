// Read-side of the ~/.specdrive store (the MCP server owns the write side).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type { ActivityEntry, OwnerComment, ProjectBundle } from '../shared/types'

export const DATA_DIR = path.join(os.homedir(), '.specdrive')
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects')

export function ensureDataDirs(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true })
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

export function loadBundle(id: string): ProjectBundle | null {
  const dir = path.join(PROJECTS_DIR, id)
  const project = readJson(path.join(dir, 'project.json'), null)
  if (!project) return null
  return {
    project,
    specs: readJson(path.join(dir, 'specs.json'), []),
    tasks: readJson(path.join(dir, 'tasks.json'), []),
    wireframes: readJson(path.join(dir, 'wireframes.json'), []),
    flow: readJson(path.join(dir, 'flow.json'), null),
    scenarios: readJson(path.join(dir, 'scenarios.json'), []),
    planDoc: readJson(path.join(dir, 'plan-doc.json'), null),
    documents: readJson(path.join(dir, 'documents.json'), []),
    activity: readActivity(dir),
    comments: readJson(path.join(dir, 'comments.json'), []),
    folder: (project as { folderId?: string }).folderId
      ? readJson(path.join(DATA_DIR, 'folders', `${(project as { folderId?: string }).folderId}.json`), null)
      : null
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
  const lock = metaFile + '.lock'
  const deadline = Date.now() + 3000
  for (;;) {
    try {
      fs.mkdirSync(lock)
      break
    } catch {
      if (Date.now() > deadline) {
        try {
          fs.rmdirSync(lock)
        } catch {}
      }
      const wait = Date.now() + 15
      while (Date.now() < wait) {} // ms-scale
    }
  }
  try {
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
  } finally {
    try {
      fs.rmdirSync(lock)
    } catch {}
  }
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
  const lock = metaFile + '.lock'
  const deadline = Date.now() + 3000
  for (;;) {
    try {
      fs.mkdirSync(lock)
      break
    } catch {
      if (Date.now() > deadline) {
        try {
          fs.rmdirSync(lock)
        } catch {}
      }
      const wait = Date.now() + 15
      while (Date.now() < wait) {} // ms-scale
    }
  }
  try {
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
  } finally {
    try {
      fs.rmdirSync(lock)
    } catch {}
  }
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
