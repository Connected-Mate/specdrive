import type { AgentDef } from './types'

/** One agent plus the brief that was composed for the project being exported. */
export interface AgentWithBrief {
  agent: AgentDef
  brief: string
}

/** What the last sync actually changed on disk — filenames only. */
export interface ClaudeAgentsSyncResult {
  wrote: string[]
  removed: string[]
}

export function syncClaudeAgents(
  codebasePath: string | undefined | null,
  agentsWithBriefs: AgentWithBrief[]
): ClaudeAgentsSyncResult
