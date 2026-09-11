import type { AgentDef, AgentRun, AgentSource, Project } from './types'
import type { ReadFolder } from './house-chain.mjs'

/** An agent as it reaches a project or a house: it remembers where it comes
 *  from, and whether a closer house replaced or switched it off. */
export interface EffectiveAgent extends AgentDef {
  /** "Everywhere" or the name of the house this agent lives in */
  from: string
  houseId: string | null
  house: string | null
  /** Comes from a house ABOVE the project's own one */
  inherited: boolean
  /** Lives in the project's own house */
  own: boolean
  /** A house in the line switched this inherited agent off */
  disabled?: boolean
  /** Id of the agent that won this slug in a closer house */
  supersededBy?: string
  supersededByHouse?: string
}

export interface CrewLimits {
  agents: number
  name: number
  slug: number
  emoji: number
  role: number
  mission: number
  rules: number
  rule: number
  method: number
  step: number
  deliverable: number
  tools: number
  tool: number
  model: number
  runs: number
  summary: number
  findings: number
  findingTitle: number
  findingDetail: number
  where: number
  description: number
  allowedTools: number
  sources: number
  sourceUrl: number
  sourceTitle: number
  license: number
  sourceWhat: number
  research: number
}

export interface BriefContext {
  project?: Pick<Project, 'id' | 'name' | 'oneLiner' | 'phase'> & {
    codebasePath?: string
    mode?: 'new' | 'existing'
  }
  /** Rendered house rules in force, as houseRulesForBrief returns them */
  houseRules?: string
  /** "SNCF › Marketing" */
  houseAddress?: string
  /** Free text the owner passed for this run */
  focus?: string
  includeLanguageLine?: boolean
}

export const CREW_LIMITS: CrewLimits
export const VERDICTS: AgentRun['verdict'][]
export const SEVERITIES: string[]
export const VERDICT_LABEL: Record<AgentRun['verdict'], string>
export const SEVERITY_LABEL: Record<string, string>
export const AGENT_FILE_PREFIX: string

export function agentSlug(name: string): string
export function promptNameFor(slug: string): string
export function agentFileName(slug: string): string
export function cleanAgent(
  input: unknown,
  opts?: { now?: string }
): { agent: AgentDef | null; error: string }
export const KNOWN_TOOLS: string[]
export const READ_ONLY_TOOLS: string[]
export function isReadOnlyBrief(agent: Partial<AgentDef>): boolean
export function cleanAllowedTools(raw: unknown, agent?: Partial<AgentDef>): string[]
export function cleanSources(raw: unknown): AgentSource[]
export function sourcesFooter(agent: Partial<AgentDef>, heading?: string): string
export function cleanRun(input: unknown, opts?: { now?: string }): { run: AgentRun | null; error: string }
export function cleanRuns(raw: unknown): AgentRun[]
export function withRun(runs: AgentRun[] | undefined, run: AgentRun): AgentRun[]
export function effectiveAgents(
  folderId: string | null | undefined,
  readFolder: ReadFolder,
  agents: AgentDef[]
): EffectiveAgent[]
export function activeAgents(
  folderId: string | null | undefined,
  readFolder: ReadFolder,
  agents: AgentDef[]
): EffectiveAgent[]
export function resolveAgent(
  slug: string,
  folderId: string | null | undefined,
  readFolder: ReadFolder,
  agents: AgentDef[]
): EffectiveAgent | null
export function agentsForHouse(
  folderId: string | null | undefined,
  readFolder: ReadFolder,
  agents: AgentDef[]
): EffectiveAgent[]
export function crewSlugs(agents: AgentDef[]): string[]
export function houseRulesForBrief(
  folderId: string | null | undefined,
  readFolder: ReadFolder
): string
export function composeBrief(agent: AgentDef, ctx?: BriefContext): string
export function renderAgentFile(agent: AgentDef, brief: string): string
