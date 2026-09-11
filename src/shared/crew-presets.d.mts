import type { AgentDef } from './types'

export type AgentPresetKey = 'human-tester' | 'spec-checker' | 'security-reviewer' | 'design-critic'

/** A ready-made agent: everything an AgentDef needs except id, scope and runs. */
export type AgentPreset = Pick<
  AgentDef,
  | 'slug'
  | 'name'
  | 'emoji'
  | 'role'
  | 'description'
  | 'mission'
  | 'rules'
  | 'method'
  | 'deliverable'
  | 'tools'
  | 'allowedTools'
  | 'modelHint'
  | 'sources'
  | 'research'
>

export const AGENT_PRESETS: Record<AgentPresetKey, AgentPreset>
export const AGENT_PRESET_KEYS: AgentPresetKey[]
export const AGENT_PRESET_LABEL: Record<AgentPresetKey, string>
