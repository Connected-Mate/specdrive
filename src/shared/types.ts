// Shared data model between the Electron app and the MCP server.
// Everything lives as JSON files under ~/.specdrive so both sides stay in sync
// through the filesystem (the app watches it live).

export type Phase =
  | 'capture'
  | 'challenge'
  | 'research'
  | 'risks'
  | 'plan'
  | 'build'
  | 'done'

export const PHASES: Phase[] = ['capture', 'challenge', 'research', 'risks', 'plan', 'build', 'done']

export type SpecCategory =
  | 'vision'
  | 'audience'
  | 'features'
  | 'design'
  | 'tech'
  | 'data'
  | 'research'
  | 'risks'
  | 'decisions'

export const SPEC_CATEGORIES: SpecCategory[] = [
  'vision',
  'audience',
  'features',
  'design',
  'tech',
  'data',
  'research',
  'risks',
  'decisions'
]

export type SpecStatus = 'draft' | 'challenged' | 'confirmed'

export interface Spec {
  id: string
  category: SpecCategory
  title: string
  /** Markdown body — written by the AI agent through MCP */
  content: string
  status: SpecStatus
  /** 1 (easy) → 5 (hardest). Set during the risks phase. */
  difficulty?: number
  /** Note left by the challenge pass explaining what was questioned/changed */
  challengeNote?: string
  /** Given/When/Then scenario(s), plain language — basis for acceptance tests */
  acceptance?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked'

export interface Task {
  id: string
  title: string
  detail: string
  /** Spec ids this task implements */
  specIds: string[]
  status: TaskStatus
  order: number
  /** Parent task id — sub-steps nest under their parent in the plan */
  parentId?: string
  /** Note the AI leaves when completing/blocking the task */
  note?: string
  createdAt: string
  updatedAt: string
}

export interface Wireframe {
  id: string
  /** Which screen of the future product this sketches */
  screen: string
  title: string
  /** Relative filename inside the project's wireframes/ dir */
  file: string
  createdAt: string
}

// ---------- The visual plan document (agent-native style) ----------
// The plan is a rich document the agent authors, not just a checklist:
// narrative sections, decision callouts, sketchy diagrams, trade-off tables
// and open questions — rendered above the task list.

export type CalloutTone = 'decision' | 'risk' | 'note'

export type PlanBlock =
  | { type: 'section'; title: string; body: string }
  | { type: 'callout'; tone: CalloutTone; body: string }
  | { type: 'table'; title?: string; columns: string[]; rows: string[][] }
  | { type: 'diagram'; html: string; css?: string; caption?: string }
  | { type: 'questions'; items: { q: string; suggestion?: string }[] }

export interface PlanDoc {
  blocks: PlanBlock[]
  updatedAt: string
}

export type ScenarioStatus = 'draft' | 'walked' | 'gap_found'

export interface ScenarioStep {
  /** What the person does, plain words: "taps Reserve on the last loaf" */
  action: string
  /** Screen name where it happens (matches flow/wireframe names when possible) */
  screen?: string
  /** What must happen next, plain words: "count drops to 0, waitlist button appears" */
  expect?: string
}

/** A usage scenario: one person, one path through the product, step by step.
 *  Walking them one by one is how holes and bugs get found before code. */
export interface Scenario {
  id: string
  title: string
  /** Who is doing this, e.g. "A neighbor on her phone at 8pm" */
  actor: string
  steps: ScenarioStep[]
  status: ScenarioStatus
  /** When status is gap_found: what is missing or would break, plain words */
  gapNote?: string
  createdAt: string
  updatedAt: string
}

export interface FlowScreen {
  id: string
  name: string
  /** One plain sentence: what the user does on this screen */
  purpose?: string
  /** The one screen where the user's story starts */
  entry?: boolean
}

export interface FlowLink {
  from: string
  to: string
  /** What triggers the move, e.g. "taps Reserve" */
  label?: string
  /** Alternative/branch path marker, e.g. "sold out" — drawn dashed */
  condition?: string
}

/** The visual plan: screens of the product and how users move between them */
export interface Flow {
  screens: FlowScreen[]
  links: FlowLink[]
  updatedAt: string
}

export interface ActivityEntry {
  ts: string
  actor: 'agent' | 'app'
  action: string
  summary: string
}

export interface Project {
  id: string
  name: string
  oneLiner: string
  /** The user's raw idea, as dictated to the agent */
  idea: string
  phase: Phase
  /** Phase → ISO date it was completed */
  phaseHistory: Partial<Record<Phase, string>>
  createdAt: string
  updatedAt: string
}

/** Full snapshot the renderer works with */
export interface ProjectBundle {
  project: Project
  specs: Spec[]
  tasks: Task[]
  wireframes: Wireframe[]
  flow: Flow | null
  scenarios: Scenario[]
  planDoc: PlanDoc | null
  activity: ActivityEntry[]
}

// ---------- AI coding agents installed on the machine ----------

export type AgentId =
  | 'claude-code'
  | 'claude-desktop'
  | 'cursor'
  | 'windsurf'
  | 'antigravity'
  | 'gemini-cli'
  | 'codex-cli'

export interface DetectedAgent {
  id: AgentId
  name: string
  installed: boolean
  /** True once SpecDrive's MCP server is registered with this agent */
  connected: boolean
  /** How we register: 'auto' = one click from the app, 'manual' = copy a command */
  install: 'auto' | 'manual'
  /** Shown to the user when install is manual */
  manualCommand?: string
}

// ---------- IPC contract (preload bridge) ----------

export interface SpecDriveApi {
  listProjects(): Promise<ProjectBundle[]>
  getProject(id: string): Promise<ProjectBundle | null>
  deleteProject(id: string): Promise<void>
  detectAgents(): Promise<DetectedAgent[]>
  /** Register the MCP server with an agent (writes its config). Returns updated agent. */
  connectAgent(id: AgentId): Promise<DetectedAgent>
  copyToClipboard(text: string): Promise<void>
  /** Read a wireframe HTML file (sandbox-rendered by the app) */
  readWireframe(projectId: string, file: string): Promise<string>
  /** Subscribe to live project changes; returns unsubscribe */
  onProjectsChanged(cb: () => void): () => void
  openExternal(url: string): Promise<void>
}
