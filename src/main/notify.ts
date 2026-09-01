// macOS notifications for milestones the owner would want to know about even
// when the app isn't in front — driven off the same file-watch tick that
// already refreshes the UI (see index.ts). We diff each project's bundle
// against its last known snapshot; only real, verifiable state flips fire.
import { BrowserWindow, Notification } from 'electron'
import type { OwnerComment, ProjectBundle, Task } from '../shared/types'
import { listBundles } from './store'

interface Snapshot {
  phase: string
  taskStatus: Record<string, Task['status']>
  commentStatus: Record<string, OwnerComment['status']>
}

const snapshots = new Map<string, Snapshot>()
const THROTTLE_MS = 30_000
let lastFiredAt = 0

function toSnapshot(b: ProjectBundle): Snapshot {
  const taskStatus: Record<string, Task['status']> = {}
  for (const t of b.tasks) taskStatus[t.id] = t.status
  const commentStatus: Record<string, OwnerComment['status']> = {}
  for (const c of b.comments ?? []) commentStatus[c.id] = c.status
  return { phase: b.project.phase, taskStatus, commentStatus }
}

function anyWindowFocused(): boolean {
  return BrowserWindow.getAllWindows().some((w) => w.isFocused())
}

function fire(title: string, body: string): void {
  if (!Notification.isSupported()) return
  if (anyWindowFocused()) return
  const now = Date.now()
  if (now - lastFiredAt < THROTTLE_MS) return
  lastFiredAt = now
  new Notification({ title, body }).show()
}

/** Diff every project's bundle against its last known snapshot and fire a
 *  notification for the first milestone found this tick. Call it after
 *  every debounced file-watch cycle (and once at boot, to seed silently —
 *  the first sighting of a project never fires, it just learns its state). */
export function checkForNotifications(): void {
  let bundles: ProjectBundle[]
  try {
    bundles = listBundles()
  } catch {
    return
  }
  for (const b of bundles) {
    const prev = snapshots.get(b.project.id)
    const next = toSnapshot(b)
    snapshots.set(b.project.id, next)
    if (!prev) continue

    if (prev.phase !== next.phase) {
      fire(b.project.name, `Moved into the "${next.phase}" step`)
    }

    for (const t of b.tasks) {
      if (prev.taskStatus[t.id] && prev.taskStatus[t.id] !== 'blocked' && t.status === 'blocked') {
        fire(b.project.name, `A step is blocked: "${t.title}"`)
      }
    }

    if (b.tasks.length) {
      const wasAllDone =
        Object.keys(prev.taskStatus).length > 0 &&
        Object.values(prev.taskStatus).every((s) => s === 'done')
      const isAllDone = b.tasks.every((t) => t.status === 'done')
      if (isAllDone && !wasAllDone) fire(b.project.name, 'All build steps are done')
    }

    for (const c of b.comments ?? []) {
      if (prev.commentStatus[c.id] === 'open' && c.status === 'resolved') {
        fire(b.project.name, 'Your agent resolved a note you left')
      }
    }
  }
}
