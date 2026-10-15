import type { AuditDecision, AuditFinding, AuditPreview } from './audit-types'
export function previewAudit(original: string, findings: AuditFinding[], decisions: AuditDecision[]): AuditPreview
