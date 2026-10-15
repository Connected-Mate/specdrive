import { dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AuditDecision, AuditReport, AuditTarget } from '../shared/audit-types'
import { listAudits, getAudit, applyAudit, readAuditTarget } from '../shared/agent-audit.mjs'
import { listBundles } from './store'

export { listAudits, readAuditTarget }

const instructionName = (target: string): boolean => ['CLAUDE.md', 'AGENTS.md'].includes(path.basename(target))

export function auditTargets(): AuditTarget[] {
  const historyHome = process.env.SPECDRIVE_HISTORY_HOME || os.homedir()
  const targets: AuditTarget[] = []
  const add = (label: string, target: string): void => {
    if (!fs.existsSync(path.dirname(target))) return
    const canonical = path.join(fs.realpathSync(path.dirname(target)), path.basename(target))
    if (!targets.some((item) => item.path === canonical)) targets.push({ label, path: canonical, exists: fs.existsSync(canonical) })
  }
  add('Claude · consignes personnelles', path.join(historyHome, '.claude', 'CLAUDE.md'))
  const codexRoot = process.env.SPECDRIVE_HISTORY_HOME ? path.join(historyHome, '.codex') : process.env.CODEX_HOME || path.join(historyHome, '.codex')
  add('Codex · consignes personnelles', path.join(codexRoot, 'AGENTS.md'))
  for (const bundle of listBundles()) {
    if (!bundle.project.codebasePath) continue
    add(`${bundle.project.name} · CLAUDE.md`, path.join(bundle.project.codebasePath, 'CLAUDE.md'))
    // A generated board export must keep its one-way source of truth.
    if (bundle.project.syncAgentsMd === false) add(`${bundle.project.name} · AGENTS.md`, path.join(bundle.project.codebasePath, 'AGENTS.md'))
  }
  return targets
}

export async function chooseAuditTarget(): Promise<AuditTarget | null> {
  const selection = await dialog.showSaveDialog({
    title: 'Choisir le fichier de consignes à examiner', buttonLabel: 'Choisir ce fichier',
    defaultPath: 'CLAUDE.md', filters: [{ name: 'Consignes Markdown', extensions: ['md'] }],
    properties: ['showHiddenFiles', 'createDirectory']
  })
  if (selection.canceled || !selection.filePath) return null
  if (!instructionName(selection.filePath)) throw new Error('Choisissez un fichier nommé CLAUDE.md ou AGENTS.md.')
  const canonical = path.join(fs.realpathSync(path.dirname(selection.filePath)), path.basename(selection.filePath))
  return { label: `${path.basename(path.dirname(canonical))} · ${path.basename(canonical)}`, path: canonical, exists: fs.existsSync(canonical) }
}

export async function applyAuditFromApp(id: string, decisions: AuditDecision[], expectedUpdatedAt: string): Promise<AuditReport> {
  if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) throw new Error('Actualisez l’analyse avant de l’appliquer.')
  const report = await getAudit(id)
  // Check active board sync, including a target that has not been generated yet.
  const realParent = (file: string): string => path.join(fs.realpathSync(path.dirname(file)), path.basename(file))
  for (const bundle of listBundles()) {
    if (!bundle.project.codebasePath || bundle.project.syncAgentsMd === false) continue
    const generatedPath = path.join(bundle.project.codebasePath, 'AGENTS.md')
    if (fs.existsSync(path.dirname(generatedPath)) && fs.existsSync(path.dirname(report.targetPath)) && realParent(generatedPath) === realParent(report.targetPath)) {
      throw new Error('Ce fichier AGENTS.md est synchronisé par le tableau SpecDrive. Modifiez les règles du projet ou choisissez CLAUDE.md.')
    }
  }
  return applyAudit(id, decisions, expectedUpdatedAt)
}
