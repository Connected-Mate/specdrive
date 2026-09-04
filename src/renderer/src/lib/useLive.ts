import { useCallback, useEffect, useState } from 'react'
import type { DetectedAgent, Folder, LiveSession, ProjectBundle } from '@shared/types'

/** All projects, refreshed live whenever the MCP server writes to disk. */
export function useProjects(): { projects: ProjectBundle[]; loaded: boolean } {
  const [projects, setProjects] = useState<ProjectBundle[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(() => {
    window.specdrive
      .listProjects()
      .then((p) => {
        setProjects(p)
        setLoaded(true)
      })
      .catch((err) => {
        console.error('listProjects failed:', err)
        setLoaded(true) // never leave the app permanently blank
      })
  }, [])

  useEffect(() => {
    refresh()
    const off = window.specdrive.onProjectsChanged(refresh)
    return off
  }, [refresh])

  return { projects, loaded }
}

export function useAgents(): {
  agents: DetectedAgent[]
  connect: (id: DetectedAgent['id']) => Promise<void>
  refresh: () => void
} {
  const [agents, setAgents] = useState<DetectedAgent[]>([])

  const refresh = useCallback(() => {
    window.specdrive
      .detectAgents()
      .then(setAgents)
      .catch((err) => console.error('detectAgents failed:', err))
  }, [])

  useEffect(refresh, [refresh])

  const connect = useCallback(
    async (id: DetectedAgent['id']) => {
      await window.specdrive.connectAgent(id)
      refresh()
    },
    [refresh]
  )

  return { agents, connect, refresh }
}

/** The MCP sessions talking to the board right now, refreshed on every write
 *  and every 20s so sessions that died quietly still expire. */
export function useLiveSessions(): LiveSession[] {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  useEffect(() => {
    const refresh = (): void => {
      window.specdrive.listSessions().then(setSessions).catch(() => {})
    }
    refresh()
    const off = window.specdrive.onProjectsChanged(refresh)
    const t = setInterval(refresh, 20000) // expire stale sessions even when quiet
    return () => {
      off()
      clearInterval(t)
    }
  }, [])
  return sessions
}

const CLIENT_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  claude: 'Claude Code',
  cursor: 'Cursor',
  'cursor-vscode': 'Cursor',
  windsurf: 'Windsurf',
  'gemini-cli': 'Gemini',
  codex: 'Codex'
}

/** Raw MCP client id → the name the owner would recognise. */
export function clientLabel(raw: string): string {
  return CLIENT_LABEL[raw.toLowerCase()] ?? raw
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The house folders, refreshed live whenever anything under ~/.specdrive
 *  changes — an agent creating a folder over MCP shows up without a reload. */
export function useFolders(): { folders: Folder[]; refresh: () => void } {
  const [folders, setFolders] = useState<Folder[]>([])
  const refresh = useCallback(() => {
    window.specdrive
      .listFolders()
      .then(setFolders)
      .catch((err) => console.error('listFolders failed:', err))
  }, [])
  useEffect(() => {
    refresh()
    return window.specdrive.onProjectsChanged(refresh)
  }, [refresh])
  return { folders, refresh }
}

/** Where the MCP server lives on this Mac — every copy-paste prompt embeds it
 *  so the owner's agent can connect SpecDrive to itself, with nothing to type. */
export function useMcpInfo(): { serverPath: string; nodeBin: string } | undefined {
  const [info, setInfo] = useState<{ serverPath: string; nodeBin: string }>()
  useEffect(() => {
    window.specdrive
      .getMcpInfo()
      .then(setInfo)
      .catch(() => {})
  }, [])
  return info
}
