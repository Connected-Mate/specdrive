import type { HistoryCoverage, HistoryMessage, HistoryProvider, HistorySession } from './audit-types'
export interface NormalizedHistory { session: HistorySession; messages: HistoryMessage[] }
export function parseHistory(provider: HistoryProvider, source: string, sourceKey?: string): NormalizedHistory & { truncated: boolean; malformed: number; excludedReason?: string }
export function collectHistory(options?: { projectPath?: string; limit?: number; providers?: HistoryProvider[] }): Promise<{ histories: NormalizedHistory[]; coverage: HistoryCoverage[]; limitations: string[] }>
