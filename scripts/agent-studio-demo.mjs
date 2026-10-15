// A reproducible, isolated preview: every conversation and instruction is fictional.
// Run npm run build first, then node scripts/agent-studio-demo.mjs [--screenshot /absolute/file.png].
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startAudit, readAuditSession, submitAudit } from '../src/shared/agent-audit.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'specdrive-studio-demo-'))
process.env.SPECDRIVE_DATA_DIR = path.join(fixture, 'data')
process.env.SPECDRIVE_HISTORY_HOME = path.join(fixture, 'profile')
const target = path.join(fixture, 'CLAUDE.md')
await fs.writeFile(target, '# Comment travailler avec moi\n\n## Communication\nRéponds de façon claire et concise.\n\n## Autonomie\nDemande une confirmation avant chaque étape.\n\n## Projet\nGarde les conventions du code existant.\n')
const conversations = [
  { provider: 'claude', title: 'Le formulaire de réservation', messages: [
    ['user', 'Ajoute un formulaire de réservation, puis vérifie que les erreurs sont bien affichées.'],
    ['assistant', 'Le formulaire est prêt.'],
    ['user', 'Tu as encore oublié de tester le formulaire avant de dire que c’est terminé.'],
    ['assistant', 'J’ai testé les champs vides et la réservation valide. Les deux cas passent.'],
    ['user', 'Oui, j’ai vérifié : ça fonctionne.']
  ] },
  { provider: 'codex', title: 'La navigation mobile', messages: [
    ['user', 'Corrige la navigation mobile et vérifie le résultat sur un petit écran.'],
    ['assistant', 'La navigation a été modifiée.'],
    ['user', 'Teste le résultat avant de dire que c’est fini, comme je te l’ai déjà demandé.'],
    ['assistant', 'Puis-je lancer le test maintenant ?'],
    ['user', 'Avance directement pour les étapes déjà demandées, tu n’as pas besoin de me redemander.'],
    ['assistant', 'La navigation fonctionne à 390 px et le menu se ferme correctement.']
  ] },
  { provider: 'claude', title: 'Le compte rendu de livraison', messages: [
    ['user', 'Fais-moi un compte rendu de la livraison.'],
    ['assistant', 'Here is the delivery report.'],
    ['user', 'Réponds-moi en français, y compris dans les comptes rendus.'],
    ['assistant', 'Voici le compte rendu en français.'],
    ['user', 'C’est bon, merci.']
  ] }
]
for (let index = 0; index < conversations.length; index++) {
  const item = conversations[index]
  const dir = path.join(process.env.SPECDRIVE_HISTORY_HOME, item.provider === 'claude' ? '.claude/projects/demo' : '.codex/sessions/2026/10/15')
  await fs.mkdir(dir, { recursive: true })
  const rows = item.messages.map(([role, text], i) => {
    const timestamp = new Date(Date.UTC(2026, 9, 15, 9 + index, i * 3)).toISOString()
    return item.provider === 'claude'
      ? { type: role, cwd: '/demo/specdrive', uuid: `demo-${index}-${i}`, timestamp, message: { role, content: text } }
      : { type: 'event_msg', timestamp, payload: { type: role === 'user' ? 'user_message' : 'agent_message', message: text } }
  })
  await fs.writeFile(path.join(dir, `demo-${index}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n'))
}
const audit = await startAudit({ targetPath: target })
const sessions = await Promise.all(audit.sessions.map(session => readAuditSession(audit.id, session.id)))
const form = sessions.find(item => item.messages[0].text.startsWith('Ajoute'))
const nav = sessions.find(item => item.messages[0].text.startsWith('Corrige'))
const report = sessions.find(item => item.messages[0].text.startsWith('Fais-moi'))
const evidence = (session, i) => ({ sessionId: session.session.id, messageId: session.messages[i].id, excerpt: session.messages[i].text })
await submitAudit(audit.id, {
  findings: [
    { id: 'verification', title: 'Vérifier avant de dire « terminé »', category: 'workflow', summary: 'Deux demandes ont nécessité une relance pour que le résultat soit réellement testé.', confidence: 'high', evidence: [evidence(form, 2), evidence(nav, 2)], proposal: { before: '', after: '## Vérification\nAvant d’annoncer une tâche terminée, exécute les vérifications adaptées et indique le résultat observé. Si une vérification est impossible, précise laquelle et pourquoi.', rationale: 'Transformer une correction répétée en règle de travail observable.' } },
    { id: 'autonomy', title: 'Avancer sans confirmations répétées', category: 'preference', summary: 'Une demande de confirmation a interrompu une étape qui était déjà autorisée.', confidence: 'medium', evidence: [evidence(nav, 4)], proposal: { before: 'Demande une confirmation avant chaque étape.', after: 'Avance sur les étapes déjà demandées. Demande une précision seulement lorsqu’une information indispensable manque.', rationale: 'Remplacer la consigne qui provoque elle-même les interruptions.' } },
    { id: 'language', title: 'Garder les comptes rendus en français', category: 'preference', summary: 'Le compte rendu a dû être repris pour respecter la langue demandée.', confidence: 'low', evidence: [evidence(report, 2)], proposal: { before: 'Réponds de façon claire et concise.', after: 'Réponds en français, de façon claire et concise, y compris dans les comptes rendus de livraison.', rationale: 'Une occurrence : cette préférence reste à confirmer avant de devenir permanente.' } }
  ],
  observations: [
    { sessionId: form.session.id, requestMessageId: form.messages[0].id, completionMessageId: form.messages[3].id, validationMessageId: form.messages[4].id, correctionMessageIds: [form.messages[2].id], outcome: 'validated' },
    { sessionId: nav.session.id, requestMessageId: nav.messages[0].id, completionMessageId: nav.messages[5].id, correctionMessageIds: [nav.messages[2].id, nav.messages[4].id], outcome: 'declared' },
    { sessionId: report.session.id, requestMessageId: report.messages[0].id, completionMessageId: report.messages[3].id, validationMessageId: report.messages[4].id, correctionMessageIds: [report.messages[2].id], outcome: 'validated' }
  ],
  limitations: ['DÉMONSTRATION : conversations fictives. Aucun historique personnel n’a été lu.', 'Les durées de cet exemple sont calendaires et incluent les pauses.']
})
const reportPath = path.join(process.env.SPECDRIVE_DATA_DIR, 'agent-audits', audit.id, 'report.json')
const saved = JSON.parse(await fs.readFile(reportPath, 'utf8'))
saved.scope = 'Démonstration · 3 conversations fictives · données isolées'
await fs.writeFile(reportPath, JSON.stringify(saved, null, 2))
console.log(`Isolated demo data: ${fixture}`)
if (!process.argv.includes('--seed-only')) {
  const screenshotIndex = process.argv.indexOf('--screenshot')
  const screenshot = screenshotIndex >= 0 ? process.argv[screenshotIndex + 1] : undefined
  const electron = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const child = spawn(electron, [root], { stdio: 'inherit', env: {
    ...process.env, ELECTRON_RUN_AS_NODE: '', SPECDRIVE_USER_DATA_DIR: path.join(fixture, 'electron'),
    SPECDRIVE_ROUTE: '__agent-studio__', ...(screenshot ? { SPECDRIVE_SHOT: screenshot } : { SPECDRIVE_STUDIO_DEMO: '1' })
  } })
  child.on('exit', code => { process.exitCode = code || 0 })
}
