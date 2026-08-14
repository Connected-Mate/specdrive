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
  try {
    return fs
      .readFileSync(path.join(dir, 'activity.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ActivityEntry)
      .slice(-200)
  } catch {
    return []
  }
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
  const safe = path.basename(file)
  const p = path.join(PROJECTS_DIR, path.basename(projectId), 'wireframes', safe)
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return '<p>Wireframe not found.</p>'
  }
}

export function deleteProject(id: string): void {
  const dir = path.join(PROJECTS_DIR, path.basename(id))
  // Move to a trash dir instead of destroying data.
  const trash = path.join(DATA_DIR, 'trash')
  fs.mkdirSync(trash, { recursive: true })
  if (fs.existsSync(dir)) fs.renameSync(dir, path.join(trash, `${path.basename(id)}-${Date.now()}`))
}
