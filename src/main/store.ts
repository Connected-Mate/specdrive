// Read-side of the ~/.specdrive store (the MCP server owns the write side).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ActivityEntry, ProjectBundle } from '../shared/types'

export const DATA_DIR = path.join(os.homedir(), '.specdrive')
export const PROJECTS_DIR = path.join(DATA_DIR, 'projects')

export function ensureDataDirs(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true })
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
    activity: readActivity(dir)
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
  if (!pid || !/^[a-z0-9]+\.html$/.test(safe)) return '<p>Wireframe not found.</p>'
  try {
    return fs.readFileSync(path.join(PROJECTS_DIR, pid, 'wireframes', safe), 'utf8')
  } catch {
    return '<p>Wireframe not found.</p>'
  }
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
