import { useCallback, useEffect, useState } from 'react'
import type { DetectedAgent, ProjectBundle } from '@shared/types'

/** All projects, refreshed live whenever the MCP server writes to disk. */
export function useProjects(): { projects: ProjectBundle[]; loaded: boolean } {
  const [projects, setProjects] = useState<ProjectBundle[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(() => {
    window.specdrive.listProjects().then((p) => {
      setProjects(p)
      setLoaded(true)
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
    window.specdrive.detectAgents().then(setAgents)
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

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
