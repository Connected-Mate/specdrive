// App preferences — a tiny JSON file next to the projects, written with the
// same lock + atomic-rename protocol as everything else under ~/.specdrive so a
// concurrent MCP write can never tear it. Read on every access rather than
// cached: the file is 200 bytes and the owner may edit it by hand.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AppSettings } from '../shared/types'
import { DATA_DIR, withFileLock } from './store'

export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

export const DEFAULT_SETTINGS: AppSettings = {
  agentsMdForNewProjects: true,
  notifications: true
}

export function readSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<AppSettings>
    return {
      agentsMdForNewProjects:
        typeof raw.agentsMdForNewProjects === 'boolean'
          ? raw.agentsMdForNewProjects
          : DEFAULT_SETTINGS.agentsMdForNewProjects,
      notifications:
        typeof raw.notifications === 'boolean' ? raw.notifications : DEFAULT_SETTINGS.notifications
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Merge a partial change in and return the settings as they now stand. */
export function writeSettings(patch: Partial<AppSettings>): AppSettings {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  let next = readSettings()
  withFileLock(SETTINGS_FILE, () => {
    next = { ...readSettings(), ...patch }
    const tmp = `${SETTINGS_FILE}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
    fs.renameSync(tmp, SETTINGS_FILE)
  })
  return next
}
