import type { AuditDecision, AuditFinding, AuditObservation, AuditReport, HistoryMessage, HistoryProvider, HistorySession } from './audit-types'
export function startAudit(options: { targetPath: string; projectPath?: string; limit?: number; providers?: HistoryProvider[] }): Promise<AuditReport>
export function listAudits(): Promise<AuditReport[]>
export function getAudit(id: string): Promise<AuditReport>
export function readAuditSession(id: string, sessionId: string): Promise<{ session: HistorySession; messages: HistoryMessage[] }>
export function submitAudit(id: string, submission: { findings: AuditFinding[]; observations: AuditObservation[]; limitations: string[] }): Promise<AuditReport>
export function applyAudit(id: string, decisions: AuditDecision[], expectedUpdatedAt?: string): Promise<AuditReport>
