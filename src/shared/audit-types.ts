export type HistoryProvider = 'claude' | 'codex'
export interface AuditEvidence {
  sessionId: string
  messageId: string
  excerpt: string
}
export interface AuditFinding {
  id: string
  title: string
  category: 'preference' | 'workflow' | 'context' | 'tooling'
  summary: string
  confidence: 'low' | 'medium' | 'high'
  evidence: AuditEvidence[]
  proposal?: { before: string; after: string; rationale: string }
}
export interface AuditObservation {
  sessionId: string
  requestMessageId: string
  completionMessageId?: string
  validationMessageId?: string
  correctionMessageIds: string[]
  outcome: 'validated' | 'declared' | 'unknown'
  /** Derived from source messages; elapsed wall time includes human pauses. */
  responseTurns?: number
  elapsedMs?: number
  validatedElapsedMs?: number
}
export interface HistoryMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp?: string
}
export interface HistorySession {
  id: string
  provider: HistoryProvider
  title: string
  projectPath?: string
  startedAt?: string
  updatedAt?: string
  messageCount: number
}
export interface HistoryCoverage {
  provider: HistoryProvider
  available: boolean
  discovered: number
  included: number
  note: string
}
export interface AuditReport {
  id: string
  createdAt: string
  updatedAt: string
  status: 'collecting' | 'ready' | 'applied'
  targetPath: string
  original: string
  originalHash: string
  originalExists: boolean
  scope: string
  coverage: HistoryCoverage[]
  sessions: HistorySession[]
  findings: AuditFinding[]
  observations: AuditObservation[]
  limitations: string[]
  appliedAt?: string
  backupPath?: string
  appliedFindingIds?: string[]
  appliedDecisions?: AuditDecision[]
}
export interface AuditTarget { label: string; path: string; exists: boolean }
export interface AuditDecision { findingId: string; after: string }
export interface AuditPreview {
  content: string
  conflicts: { findingId: string; message: string }[]
}
export interface AgentAuditApi {
  list(): Promise<AuditReport[]>
  targets(): Promise<AuditTarget[]>
  chooseTarget(): Promise<AuditTarget | null>
  apply(id: string, decisions: AuditDecision[], expectedUpdatedAt: string): Promise<AuditReport>
}
