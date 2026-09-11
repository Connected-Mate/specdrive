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
  | 'business'
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
  'business',
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
  /** Where this fact comes from (existing-app mode especially) */
  source?: 'owner' | 'code' | 'doc' | 'web' | 'inference'
  /** How trustworthy: verified in code / pattern guess / unknown */
  confidence?: 'confirmed' | 'inferred' | 'gap'
  /** Change log: what changed, when, and why (filled by update_spec) */
  history?: { ts: string; field: string; from: string; to: string; why?: string }[]
  /** Set by the MCP read path instead of the full history */
  historyCount?: number
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'failed' | 'deferred'

export interface Task {
  id: string
  title: string
  detail: string
  /** Spec ids this task implements */
  specIds: string[]
  status: TaskStatus
  order: number
  /** Task ids that must be done before this one can start (graph, not just order) */
  dependsOn?: string[]
  /** When the agent set it in_progress (for time-per-task on the board) */
  startedAt?: string
  /** When it was verified done */
  doneAt?: string
  /** Git commit hash of the codebase when the task was completed — drift detection baseline */
  gitRef?: string
  /** Parent task id — sub-steps nest under their parent in the plan */
  parentId?: string
  /** Note the AI leaves when completing/blocking the task */
  note?: string
  /** Evidence of verification recorded at "done": what was run, what was observed */
  proof?: string
  /** Log of tries when a task didn't work the first time */
  attempts?: { ts: string; note: string; nextMove: string }[]
  /** What the agent plans to do next after the latest attempt */
  nextMove?: string
  /** Files/areas this task touched — used to spot when a later step affects an earlier one */
  touches?: string[]
  /** True when a later step may have invalidated this done task's proof */
  stale?: boolean
  /** When it was marked stale */
  staleSince?: string
  /** Id of the task (or 'discovery') whose change made it stale */
  staleBecause?: string
  /** Plain-words explanation of why it needs a re-check */
  staleReason?: string
  /** How many times this task has been reopened after being marked done */
  reopenCount?: number
  /** When it was last re-checked after going stale */
  recheckedAt?: string
  /** Evidence recorded at the last re-check */
  recheckProof?: string
  /** pid of the agent session currently working this task */
  claimedBy?: number
  /** What kind of step this is, for a small plain-words tag */
  kind?: string
  /** For review steps: the angle taken */
  lens?: 'adversarial' | 'edge-cases' | 'verification-gap' | 'intent-alignment'
  /** Shell command the server runs itself to prove the step */
  verifyCommand?: string
  /** Result of the server-run check at 'done' */
  proofRun?: { command: string; exitCode: number | null; durationMs: number; timedOut?: boolean; outputTail: string; ranAt: string }
  /** Why no runnable check exists for this step */
  proofRunSkipped?: { reason: string; at: string } | string
  /** Git ref when the step started — the baseline for "what changed" */
  startedRef?: string
  /** Files git saw change between start and done (evidence, capped) */
  changedFiles?: { files: string[]; total: number; at: string }
  /** Which session marked it done — a review by the builder's own session is refused */
  doneBy?: { pid: number; client: string; at: string }
  /** One result per linked spec that carries an acceptance scenario */
  acceptanceResults?: { specId: string; title: string; result: 'pass' | 'fail' | 'not_testable'; how: string; at: string }[]
  /** When rerun_checks last ran this step's command */
  lastRerunAt?: string
  /** When it was set aside after repeated failures */
  deferredAt?: string
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
  /** 'kit' = agent-native kit tree (JSON); 'html' = legacy raw HTML sketch */
  kind?: 'html' | 'kit'
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

/** A comment the OWNER leaves on a spec or task card in the app.
 *  The agent reads open comments through MCP on its next pass and resolves them.
 *  Stored per project in comments.json. */
export interface OwnerComment {
  id: string
  /** What the comment is attached to */
  target: { kind: 'spec' | 'task' | 'project'; id: string }
  text: string
  status: 'open' | 'resolved'
  /** Set by the agent when resolving: what it did about it, plain words */
  resolution?: string
  createdAt: string
  resolvedAt?: string
}

/** One standing rule of a folder — applies to every project inside. */
export interface FolderRule {
  title: string
  content: string
  /** Who set this rule: the owner directly, or an agent proposing it on the owner's behalf */
  setBy?: 'owner' | `agent:${string}`
  setAt?: string
  /** True once the owner has explicitly approved a rule an agent proposed */
  confirmedByOwner?: boolean
  /** Title of the earlier rule this one replaces, if any */
  supersedes?: string
  /** Glob this rule is scoped to, e.g. "ios/**" — omitted means it applies everywhere in the folder */
  appliesTo?: string
}

/** A folder above projects: standing house rules (company charter, compliance…)
 *  that every project placed inside must honor, in every phase.
 *
 *  Houses NEST: `parentId` puts this house inside another one (SNCF → SNCF
 *  Marketing → its projects). A project inherits the rules of every house
 *  above it; the closest house wins when two rules share a name. All of that
 *  logic lives in one place — src/shared/house-chain.mjs. */
export interface Folder {
  id: string
  name: string
  description?: string
  /** The house this one lives inside, if any — its rules apply here too */
  parentId?: string
  rules: FolderRule[]
  createdAt: string
  updatedAt: string
}

// ---------- the owner's own agents ("crew") ----------
// Saved team members: created once, available in EVERY project where SpecDrive
// is connected. Scoped exactly like house rules — everywhere, or attached to a
// house and inherited by every project inside it. Resolution lives in
// src/shared/crew-chain.mjs; the files live in ~/.specdrive/crew/<id>.json.

/** Where an agent is available: everywhere, or inside one house and below. */
export type AgentScope = 'global' | 'house'

export type AgentVerdict = 'pass' | 'issues' | 'blocked' | 'info'

export type FindingSeverity = 'blocker' | 'major' | 'minor' | 'note'

/** One problem an agent reported back after a run. */
export interface AgentFinding {
  severity: FindingSeverity
  title: string
  detail: string
  /** Screen, file:line, endpoint — where the owner (or the next agent) looks */
  where?: string
}

/** One report an agent posted back through log_agent_run. */
export interface AgentRun {
  id: string
  /** The project it ran on, when it ran on one */
  projectId?: string
  projectName?: string
  verdict: AgentVerdict
  /** One plain-words paragraph the owner reads first */
  summary: string
  findings: AgentFinding[]
  /** Which coding tool posted it */
  by?: string
  at: string
}

/** Where a piece of this agent's brief came from. An agent is built after
 *  reading what already exists in the open — published agent definitions,
 *  prompt collections, vendor docs — so the owner can always see what was
 *  borrowed, from whom, and under which licence. */
export interface AgentSource {
  url: string
  title?: string
  /** e.g. "MIT", "Apache-2.0", "unclear" — plain text, never inferred silently */
  license?: string
  /** One line: what was taken from it, and why it fits this job */
  what: string
}

/** A saved team member. The owner creates it once, by talking to their agent,
 *  and runs it anywhere with /mcp__specdrive__agent_<slug>. */
export interface AgentDef {
  /** File id — the slug, suffixed only if that slug was already taken */
  id: string
  /** Kebab name used in the MCP prompt (agent_<slug>) and the exported file */
  slug: string
  name: string
  /** One or two emoji — the agent's face on its card */
  emoji: string
  /** One line: what it does */
  role: string
  /** What it is for, in the owner's own terms */
  mission: string
  /** The MUST list — binding on every run */
  rules: string[]
  /** How it works, in order */
  method: string[]
  /** What it hands back at the end */
  deliverable: string
  /** Suggested tools, plain words */
  tools: string[]
  /** Suggested model, e.g. "opus" — only ever a hint */
  modelHint?: string
  /** What this brief was built from: the published agents and prompts that were
   *  read before writing it, and what each one contributed. */
  sources?: AgentSource[]
  /** Plain words: how those candidates compared, what was kept, what was
   *  dropped and why. The owner reads this to understand their own agent. */
  research?: string
  scope: AgentScope
  /** Set when scope is "house": the house it belongs to */
  folderId?: string
  /** Houses that switched this inherited agent off */
  disabledIn?: string[]
  /** The ready-made agent it was created from, if any */
  preset?: string
  /** Its reports, newest first, capped at 50 */
  runs: AgentRun[]
  createdAt: string
  updatedAt: string
}

/** One area of the product the agent decided this SHAPE of product must have
 *  an answer for (business model, platform rules, auth, payments…). The agent
 *  derives the list itself from the project's shape; the board tracks whether
 *  the specs actually cover it. */
export interface RequiredArea {
  /** Slug, e.g. "business-model", "platform-rules" — specs join it via the tag `area:<slug>` */
  area: string
  /** Plain-words label for the owner; falls back to a prettified slug */
  label?: string
  /** One plain sentence: why this product cannot ship without an answer here */
  why: string
  /** Recomputed by the server from the specs, except "n/a" which the agent sets */
  status: 'empty' | 'partial' | 'covered' | 'n/a'
  /** Specs tagged `area:<slug>` that answer it */
  specIds?: string[]
  /** Required when status is "n/a": why this area genuinely does not apply here */
  note?: string
}

export interface Project {
  id: string
  name: string
  oneLiner: string
  /** The user's raw idea, as dictated to the agent */
  idea: string
  /** What KIND of product this is — "ios-app", "web-saas", "marketplace"… The
   *  agent names it, and derives the required areas below from it. */
  shape?: string
  /** The checklist of areas this product must answer, derived by the agent */
  requiredAreas?: RequiredArea[]
  /** "new" (default) = blank-page idea; "existing" = the app already exists, code is ground truth */
  mode?: 'new' | 'existing'
  /** For existing apps: where the code lives */
  codebasePath?: string
  /** Folder this project belongs to — its house rules apply */
  folderId?: string
  /** Write the generated AGENTS.md (and a CLAUDE.md stub) into codebasePath on every change. Default true. */
  syncAgentsMd?: boolean
  /** Last git ref any session saw — drift baseline */
  lastSeenRef?: string
  /** When check_convergence last ran — gates 'done' */
  lastConvergenceAt?: string
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
  documents: SourceDocument[]
  activity: ActivityEntry[]
  /** The folder the project belongs to, if any — resolved by the app */
  folder?: Folder | null
  /** The whole line of houses above the project, [root … its own house].
   *  Empty when the project lives on its own. */
  houseChain?: Folder[]
  /** Owner comments on cards — written by the app, resolved by the agent via MCP */
  comments?: OwnerComment[]
  /** The crew that can be run on this project: everywhere-agents plus every
   *  house above it, closest house winning on a shared slug. */
  agents?: import('./crew-chain.mjs').EffectiveAgent[]
  /** Has the codebase moved since the last verified build step? null = unknown/not applicable */
  drift?: { moved: boolean; commits: number } | null
}

/** Source material the owner handed over — stored complete, never summarized. */
export interface SourceDocument {
  id: string
  title: string
  kind: 'style-guide' | 'notes' | 'reference' | 'spec' | 'image' | 'other'
  /** Relative filename inside the project's documents/ dir */
  file: string
  /** Characters in the stored document */
  size: number
  createdAt: string
}

/** A live MCP session: an agent currently talking to the board. */
export interface LiveSession {
  pid: number
  client: string
  version: string
  lastTool: string
  project: string | null
  lastToolAt: string
  startedAt: string
  /** Refreshed every 25s while the session lives */
  heartbeatAt?: string
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
  /** Where this agent keeps its MCP config */
  configPath?: string
  /** The exact command the agent will launch */
  command?: string
  args?: string[]
}

/** Result of actually launching the configured server and shaking hands. */
export interface AgentVerification {
  ok: boolean
  /** Plain-words outcome, shown to the owner */
  detail: string
  checkedAt: string
}

// ---------- App preferences (~/.specdrive/settings.json) ----------

export interface AppSettings {
  /** Write the generated AGENTS.md into the code folder of projects that have
   *  never been told either way. The per-project toggle always wins. */
  agentsMdForNewProjects: boolean
  /** Show a macOS notification when a milestone happens while the app is away. */
  notifications: boolean
}

/** What the Settings screen shows about this build and where its data lives. */
export interface AboutInfo {
  version: string
  dataDir: string
  serverPath: string
  nodeBin: string
}

/** One thing waiting on the owner, anywhere on the board. */
export interface WaitingItem {
  id: string
  projectId: string
  projectName: string
  kind: 'question' | 'blocked' | 'deferred' | 'failed'
  title: string
  detail: string
  suggestion?: string
  target: OwnerComment['target']
  since: string
}

// ---------- IPC contract (preload bridge) ----------

export interface SpecDriveApi {
  listProjects(): Promise<ProjectBundle[]>
  listSessions(): Promise<LiveSession[]>
  /** Paths the starter prompt needs so an agent can self-install the MCP */
  getMcpInfo(): Promise<{ serverPath: string; nodeBin: string }>
  getProject(id: string): Promise<ProjectBundle | null>
  deleteProject(id: string): Promise<void>
  detectAgents(): Promise<DetectedAgent[]>
  /** Register the MCP server with an agent (writes its config). Returns updated agent. */
  connectAgent(id: AgentId): Promise<DetectedAgent>
  /** REALLY verify: launch the configured command and do an MCP handshake */
  verifyAgent(id: AgentId): Promise<import('./types').AgentVerification>
  copyToClipboard(text: string): Promise<void>
  /** Read a wireframe HTML file (sandbox-rendered by the app) */
  readWireframe(projectId: string, file: string): Promise<string>
  /** Read a stored source document, verbatim */
  readDocument(projectId: string, file: string): Promise<string>
  /** Read a stored image document as a data URL */
  readImage(projectId: string, file: string): Promise<string>
  /** Store a dropped image into the project's documents */
  addImage(projectId: string, name: string, dataBase64: string): Promise<string>
  /** Leave an owner note on a spec/task/project card. Returns an error string, or '' on success. */
  addComment(projectId: string, target: OwnerComment['target'], text: string): Promise<string>
  /** Turn the generated AGENTS.md export for this project's code folder on/off. */
  setSyncAgentsMd(projectId: string, on: boolean): Promise<void>
  /** Reveal this project's own files (~/.specdrive/projects/<id>) in the Finder */
  revealProject(projectId: string): Promise<void>
  /** Re-run every finished step's own check, right now, and report in plain words */
  rerunChecks(projectId: string): Promise<{ ok: boolean; message: string; ran: number; failed: number }>
  /** Everything across every project that only the owner can unblock */
  listWaiting(): Promise<WaitingItem[]>
  // ----- house folders (the owner's side of what agents do over MCP) -----
  listFolders(): Promise<Folder[]>
  /** Returns the new folder's id, or an error string to show the owner.
   *  `parentId` puts the new house inside an existing one. */
  createFolder(
    name: string,
    description: string,
    rules: FolderRule[],
    presets: string[],
    parentId?: string | null
  ): Promise<{ id: string; error: string }>
  /** Rename a folder, change its description, or move it into another house. '' on success. */
  updateFolder(
    id: string,
    patch: { name?: string; description?: string; parentId?: string | null }
  ): Promise<string>
  /** Move a house inside another one, or pass null to bring it back to the top. '' on success. */
  moveFolder(id: string, parentId: string | null): Promise<string>
  /** Replace a folder's house rules with the complete list. '' on success. */
  setFolderRules(id: string, rules: FolderRule[]): Promise<string>
  /** Moves everything inside it up one level first — sub-houses and projects go
   *  to this house's own parent — then deletes it. '' on success. */
  deleteFolder(id: string): Promise<string>
  /** Put a project in a folder, or pass null to take it out. '' on success. */
  assignProjectFolder(projectId: string, folderId: string | null): Promise<string>
  // ----- the owner's own agents (the same writes agents make over MCP) -----
  /** Every saved agent, newest first. */
  listCrew(): Promise<AgentDef[]>
  /** Create an agent from scratch, or from a ready-made one (`preset`).
   *  Returns the new agent's id, or a plain-words error to show the owner. */
  createAgent(
    input: Partial<AgentDef> & { preset?: string }
  ): Promise<{ id: string; error: string }>
  /** Change any field of an agent in place. '' on success. */
  updateAgent(id: string, patch: Partial<AgentDef>): Promise<string>
  /** Make it available everywhere, or attach it to one house. '' on success. */
  setAgentScope(id: string, scope: AgentScope, folderId: string | null): Promise<string>
  /** Switch an inherited agent off inside one house (or back on). '' on success. */
  setAgentDisabled(id: string, folderId: string, off: boolean): Promise<string>
  /** Copy an agent, name and all, to edit without touching the original. */
  duplicateAgent(id: string): Promise<{ id: string; error: string }>
  /** Move an agent to the trash. '' on success. */
  deleteAgent(id: string): Promise<string>
  /** The runnable brief for this agent on this project — the same text the MCP
   *  server hands a coding agent, ready to copy-paste. */
  agentBrief(id: string, projectId: string | null): Promise<string>
  // ----- preferences, updates and data location -----
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getAbout(): Promise<AboutInfo>
  /** Runs the same "Check for Updates…" the menu does; resolves with the answer
   *  in one plain sentence, so the screen keeps it after the dialog is gone. */
  checkForUpdates(): Promise<string>
  /** Reveal ~/.specdrive (or the MCP server file) in the Finder */
  revealInFinder(what: 'data' | 'server'): Promise<void>
  /** Subscribe to live project changes; returns unsubscribe */
  onProjectsChanged(cb: () => void): () => void
  /** Fullscreen toggles hide/show the traffic lights; returns unsubscribe */
  onFullScreenChanged(cb: (on: boolean) => void): () => void
  openExternal(url: string): Promise<void>
}
