import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuditDecision, AuditFinding, AuditReport, AuditTarget } from '@shared/audit-types'
import { previewAudit } from '@shared/audit-preview.mjs'
import { agentAuditPrompt } from '@shared/agent-audit-prompt.mjs'
import { useToast } from '@/components/Toast'
import '../styles/agent-studio.css'

type ReviewState = 'pending' | 'accepted' | 'ignored'
type Review = { state: ReviewState; after: string }
type DocumentTab = 'suggestions' | 'retained' | 'markdown'
type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string }

const categoryLabels: Record<AuditFinding['category'], string> = {
  preference: 'Préférence', workflow: 'Façon de travailler', context: 'Contexte', tooling: 'Outils'
}
const confidenceLabels: Record<AuditFinding['confidence'], string> = {
  low: 'Confiance faible', medium: 'Confiance moyenne', high: 'Confiance élevée'
}
const conflictMessage = (message: string): string => {
  if (message.includes('overlap')) return 'Plusieurs règles remplacent le même passage. Retenez-en une seule.'
  if (message.includes('occurs more than once')) return 'Le passage à remplacer apparaît plusieurs fois dans le document.'
  if (message.includes('not found')) return 'Le passage à remplacer est introuvable dans le document d’origine.'
  if (message.includes('100,000')) return 'Le texte proposé dépasse la limite de 100 000 caractères.'
  if (message.includes('no instruction proposal')) return 'Aucune modification du document n’est liée à ce constat.'
  return message
}
const shortPath = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~')
const fileName = (path: string): string => path.split(/[\\/]/).pop() || 'Instructions'
const reportDate = (date: string): string => {
  const value = new Date(date)
  return Number.isNaN(value.getTime()) ? 'Date inconnue' : value.toLocaleString('fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}
const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const duration = (ms: number): string => {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`
  return `${(ms / 86_400_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`
}

/** A bounded line diff keeps large instruction files responsive. */
function documentDiff(before: string, after: string): DiffLine[] {
  if (before === after) return before ? before.split('\n').map((text) => ({ kind: 'same', text })) : []
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  let start = 0
  let end = 0
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++
  while (end < Math.min(a.length, b.length) - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const left = a.slice(start, end ? -end : undefined)
  const right = b.slice(start, end ? -end : undefined)
  const rows: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }))
  if (left.length * right.length > 250_000) {
    rows.push(...left.map((text): DiffLine => ({ kind: 'remove', text })), ...right.map((text): DiffLine => ({ kind: 'add', text })))
  } else {
    const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        rows.push({ kind: 'same', text: left[i++] }); j++
      } else if (i < left.length && (j === right.length || table[i + 1][j] >= table[i][j + 1])) {
        rows.push({ kind: 'remove', text: left[i++] })
      } else rows.push({ kind: 'add', text: right[j++] })
    }
  }
  if (end) rows.push(...a.slice(-end).map((text): DiffLine => ({ kind: 'same', text })))
  return rows
}

function DocumentLines({ rows, selectedBefore = '', selectedAfter = '' }: { rows: DiffLine[]; selectedBefore?: string; selectedAfter?: string }): React.JSX.Element {
  const selectedRemovals = new Set(selectedBefore.split('\n').filter((line) => line.trim()))
  const selectedAdditions = new Set(selectedAfter.split('\n').filter((line) => line.trim()))
  return <div className="audit-document-lines" aria-label="Document avec ajouts et suppressions">
    {rows.map((row, index) => {
      const heading = /^(#{1,6})\s+/.exec(row.text)
      const selected = row.kind === 'add' ? selectedAdditions.has(row.text) : row.kind === 'remove' && selectedRemovals.has(row.text)
      return <div key={index} className={`audit-line audit-line-${row.kind}${heading ? ' audit-line-heading' : ''}${selected ? ' audit-line-selected' : ''}`}>
        <span className="audit-line-sign" aria-label={row.kind === 'add' ? 'Ajout' : row.kind === 'remove' ? 'Suppression' : undefined}>{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ''}</span>
        <span>{row.text || '\u00a0'}</span>
      </div>
    })}
  </div>
}

function StudioMark(): React.JSX.Element {
  return <div className="audit-intro-art" aria-hidden="true">
    <div className="audit-art-orbit" />
    <div className="audit-art-note audit-art-note-back"><span /><span /><span /></div>
    <div className="audit-art-note"><div className="audit-art-file">Votre agent, à votre façon.</div><span /><span /><div className="audit-art-edit">+ Vos préférences, enfin comprises.</div><span /></div>
    <div className="audit-art-check">✓</div>
  </div>
}

function ObservationSummary({ report }: { report: AuditReport }): React.JSX.Element {
  const observations = report.observations
  const corrections = new Set(observations.flatMap((item) => item.correctionMessageIds.map((id) => `${item.sessionId}:${id}`))).size
  const validated = observations.filter((item) => item.outcome === 'validated').length
  const declared = observations.filter((item) => item.outcome === 'declared').length
  const unknown = observations.filter((item) => item.outcome === 'unknown').length
  const elapsed = observations.flatMap((item) => typeof item.elapsedMs === 'number' && item.elapsedMs >= 0 ? [item.elapsedMs] : [])
  const validatedElapsed = observations.flatMap((item) => typeof item.validatedElapsedMs === 'number' && item.validatedElapsedMs >= 0 ? [item.validatedElapsedMs] : [])
  const completionMedian = median(elapsed)
  const validationMedian = median(validatedElapsed)
  return <div className="audit-measures" aria-label="Observations de l’analyse">
    <div><strong>{observations.length}</strong><span>demandes analysées</span></div>
    <div><strong>{corrections}</strong><span>corrections observées</span></div>
    <div className="audit-outcomes"><strong>{validated} <small>validées par vous</small></strong><span>{declared} déclarées terminées · {unknown} sans résultat établi</span></div>
    <div className="audit-timing">
      <strong>{completionMedian === undefined ? '—' : duration(completionMedian)} <small>délai médian déclaré</small></strong>
      <span>{elapsed.length ? `${elapsed.length} demande${elapsed.length > 1 ? 's' : ''} horodatée${elapsed.length > 1 ? 's' : ''}` : 'Horodatages de messages insuffisants'}</span>
      {validationMedian !== undefined && <span>Validation : {duration(validationMedian)} · {validatedElapsed.length} demande{validatedElapsed.length > 1 ? 's' : ''}</span>}
      {(elapsed.length > 0 || validatedElapsed.length > 0) && <span>Durée calendaire · pauses incluses</span>}
    </div>
  </div>
}

export function AgentStudio({ projectPath }: { projectPath?: string }): React.JSX.Element {
  const toast = useToast()
  const [reports, setReports] = useState<AuditReport[]>([])
  const [targets, setTargets] = useState<AuditTarget[]>([])
  const [targetPath, setTargetPath] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [findingId, setFindingId] = useState<string | null>(null)
  const [reviews, setReviews] = useState<Record<string, Record<string, Review>>>({})
  const [tab, setTab] = useState<DocumentTab>('suggestions')
  const [setupOn, setSetupOn] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const [waitingSince, setWaitingSince] = useState<number | null>(null)
  const [historyScope, setHistoryScope] = useState<'all' | 'project'>('all')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mcp, setMcp] = useState<{ nodeBin: string; serverPath: string }>()
  const documentScroll = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextReports, nextTargets] = await Promise.all([window.specdrive.agentAudit.list(), window.specdrive.agentAudit.targets()])
      setReports(nextReports.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      setTargets((current) => [...nextTargets, ...current.filter((target) => !nextTargets.some((item) => item.path === target.path))])
      setTargetPath((current) => current || nextTargets[0]?.path || '')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les analyses. Réessayez.')
    } finally { setLoaded(true) }
  }, [])
  useEffect(() => {
    void refresh()
    void window.specdrive.getMcpInfo().then(setMcp).catch(() => {})
    return window.specdrive.onProjectsChanged(() => { void refresh() })
  }, [refresh])

  const report = reports.find((item) => item.id === selectedId) ?? reports[0]
  const reviewKey = report ? `${report.id}:${report.updatedAt}` : ''
  const finding = report?.findings.find((item) => item.id === findingId) ?? report?.findings[0]
  const applied = report?.status === 'applied'
  const editable = report?.status === 'ready' && !busy
  const reviewFor = useCallback((item: AuditFinding): Review => {
    if (report?.status === 'applied') {
      const decision = report.appliedDecisions?.find((entry) => entry.findingId === item.id)
      return { state: decision || report.appliedFindingIds?.includes(item.id) ? 'accepted' : 'ignored', after: decision?.after ?? item.proposal?.after ?? '' }
    }
    return reviews[reviewKey]?.[item.id] ?? { state: 'pending', after: item.proposal?.after ?? '' }
  }, [report, reviewKey, reviews])
  const accepted = useMemo<AuditDecision[]>(() => (report?.findings ?? []).filter((item) => item.proposal && reviewFor(item).state === 'accepted').map((item) => ({ findingId: item.id, after: reviewFor(item).after })), [report, reviewFor])
  const suggestions = useMemo<AuditDecision[]>(() => (report?.findings ?? []).filter((item) => item.proposal && reviewFor(item).state !== 'ignored').map((item) => ({ findingId: item.id, after: reviewFor(item).after })), [report, reviewFor])
  const retainedPreview = useMemo(() => report ? previewAudit(report.original, report.findings, accepted) : { content: '', conflicts: [] }, [report, accepted])
  const suggestedPreview = useMemo(() => report ? previewAudit(report.original, report.findings, suggestions) : { content: '', conflicts: [] }, [report, suggestions])
  const currentPreview = tab === 'suggestions' ? suggestedPreview : retainedPreview
  const rows = useMemo(() => documentDiff(report?.original ?? '', currentPreview.content), [report?.original, currentPreview.content])
  const additions = rows.filter((row) => row.kind === 'add').length
  const removals = rows.filter((row) => row.kind === 'remove').length
  const selectedReview = finding ? reviewFor(finding) : undefined
  const selectedConflict = finding && suggestedPreview.conflicts.find((item) => item.findingId === finding.id)
  const selectedRetainedConflict = finding && retainedPreview.conflicts.find((item) => item.findingId === finding.id)
  const showSetup = setupOn || !report
  const currentTarget = targets.find((item) => item.path === targetPath)

  useEffect(() => {
    if (waitingSince === null) return
    const incoming = reports.find((item) => item.targetPath === targetPath && new Date(item.createdAt).getTime() >= waitingSince - 1000)
    if (!incoming) return
    setSelectedId(incoming.id)
    setFindingId(null)
    setTab('suggestions')
    setSetupOn(false)
    setPromptCopied(false)
    setWaitingSince(null)
  }, [reports, waitingSince, targetPath])

  // Selecting a finding brings its changes into view; typing never moves the document.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = documentScroll.current
      if (!container) return
      const selectedLine = container.querySelector<HTMLElement>('.audit-line-selected')
      if (selectedLine) container.scrollTop += selectedLine.getBoundingClientRect().top - container.getBoundingClientRect().top - 18
      else container.scrollTop = 0
    })
    return () => cancelAnimationFrame(frame)
  }, [finding?.id, report?.id, tab])

  const updateReview = (item: AuditFinding, update: Partial<Review>): void => {
    if (!report || !editable) return
    setReviews((current) => ({ ...current, [reviewKey]: { ...current[reviewKey], [item.id]: { ...reviewFor(item), ...update } } }))
    setError(null)
  }
  const chooseTarget = async (): Promise<void> => {
    try {
      const target = await window.specdrive.agentAudit.chooseTarget()
      if (!target) return
      setTargets((current) => [...current.filter((item) => item.path !== target.path), target])
      setTargetPath(target.path)
      setPromptCopied(false)
      setWaitingSince(null)
      setError(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Impossible de choisir ce fichier.') }
  }
  const copy = async (text: string, message: string): Promise<boolean> => {
    try { await window.specdrive.copyToClipboard(text); toast(message); return true }
    catch { setError('La copie a échoué. Réessayez.'); return false }
  }
  const copyPrompt = async (): Promise<void> => {
    if (!targetPath) return
    if (await copy(agentAuditPrompt(targetPath, mcp, historyScope === 'project' ? projectPath : undefined), 'Prompt copié — collez-le dans votre agent.')) {
      setPromptCopied(true)
      setWaitingSince(Date.now())
    }
  }
  const apply = async (): Promise<void> => {
    if (!report || !editable || !accepted.length || retainedPreview.conflicts.length) return
    setBusy(true); setError(null)
    try {
      const next = await window.specdrive.agentAudit.apply(report.id, accepted, report.updatedAt)
      setReports((current) => current.map((item) => item.id === next.id ? next : item))
      setTab('retained')
      toast('Vos instructions ont été mises à jour.')
    } catch (err) { setError(err instanceof Error ? err.message : 'La mise à jour a échoué. Vos choix sont conservés.') }
    finally { setBusy(false) }
  }

  return <main className={`agent-studio${showSetup ? ' agent-studio-setup' : ''}`}>
    <div className="audit-titlebar"><span>SpecDrive <span className="audit-titlebar-separator">/</span> Personnaliser mon agent</span><span className="audit-local"><span /> Sur ce Mac</span></div>
    <header className="audit-page-heading">
      <div><p className="audit-eyebrow">L’agent apprend. Vous décidez.</p><h1>Votre façon de travailler.</h1><p>Vos échanges deviennent des instructions que votre agent peut suivre.</p></div>
      {report && <div className="audit-heading-actions">
        <button className="pill pill-quiet" onClick={() => { setSetupOn(!setupOn); setError(null) }}>{showSetup ? 'Revenir à l’analyse' : '+ Nouvelle analyse'}</button>
      </div>}
    </header>

    {error && <div className="audit-alert" role="alert"><strong>Une action est nécessaire.</strong><p>{error}</p><button className="pill pill-quiet" onClick={() => { void refresh() }}>Actualiser</button></div>}

    {!loaded ? <div className="audit-loading" role="status">Chargement de vos analyses…</div> : showSetup ? <section className="audit-setup">
      <StudioMark />
      <div className="audit-setup-copy"><h2>Les mêmes corrections ?<br />Faites-en une règle.</h2><p>Un prompt suffit pour relire vos échanges Claude Code et Codex, retrouver ce que vous répétez et proposer des instructions plus justes.</p></div>
      <div className="audit-setup-form">
        <label htmlFor="audit-target">Quel document souhaitez-vous améliorer ?</label>
        <div className="audit-target-row"><select id="audit-target" value={targetPath} onChange={(event) => { setTargetPath(event.target.value); setPromptCopied(false); setWaitingSince(null) }} disabled={!targets.length}>
          {!targets.length && <option value="">Choisissez un fichier d’instructions</option>}
          {targets.map((target) => <option key={target.path} value={target.path}>{target.label}{target.exists ? '' : ' · à créer'}</option>)}
        </select><button className="pill pill-quiet" onClick={() => { void chooseTarget() }}>Choisir un fichier</button></div>
        {targetPath && <p className="audit-target-path" title={targetPath}>{shortPath(targetPath)}{currentTarget && !currentTarget.exists ? ' · sera créé après votre validation' : ''}</p>}
        {projectPath && <label className="audit-history-scope">Conversations à examiner<select value={historyScope} onChange={(event) => { setHistoryScope(event.target.value as 'all' | 'project'); setPromptCopied(false); setWaitingSince(null) }}><option value="all">Tous les historiques locaux accessibles</option><option value="project">Projet actuel · {fileName(projectPath)}</option></select></label>}
        <button className="pill pill-primary audit-copy-prompt" disabled={!targetPath} onClick={() => { void copyPrompt() }}>{promptCopied ? '✓ Copier à nouveau le prompt' : 'Copier le prompt de personnalisation'}<span aria-hidden="true">↗</span></button>
        <p className="audit-setup-hint">Collez-le dans votre agent connecté à SpecDrive. L’analyse apparaîtra ici.</p>
        {promptCopied && <div className="audit-waiting" role="status"><span className="audit-pulse" />Prêt à recevoir l’analyse de votre agent.<button onClick={() => { setSetupOn(false); void refresh() }}>Actualiser</button></div>}
      </div>
      <ol className="audit-steps">
        <li><span>01</span><div><h3>Relire les échanges</h3><p>L’agent examine les historiques locaux accessibles et indique ce qui manque.</p></div></li>
        <li><span>02</span><div><h3>Comprendre les frictions</h3><p>Chaque constat s’appuie sur des extraits de vos conversations.</p></div></li>
        <li><span>03</span><div><h3>Choisir les bonnes règles</h3><p>Vous relisez, modifiez et retenez chaque ajout avant l’écriture du fichier.</p></div></li>
      </ol>
      <p className="audit-source-note">Les extraits sont lus par l’agent dans lequel vous collez ce prompt. Les chats web Claude et ChatGPT ne sont pas récupérés automatiquement. Les sources absentes sont signalées dans chaque analyse.</p>
    </section> : report && <>
      <div className="audit-report-bar">
        <label className="audit-report-picker"><span>Analyse</span><select aria-label="Choisir une analyse" value={report.id} onChange={(event) => { setSelectedId(event.target.value); setFindingId(null); setTab('suggestions'); setError(null) }}>{reports.map((item) => <option value={item.id} key={item.id}>{reportDate(item.createdAt)} · {fileName(item.targetPath)}{item.status === 'applied' ? ' · appliquée' : ''}</option>)}</select></label>
        <span className={`audit-status${report.status === 'collecting' ? ' collecting' : ''}`}>{report.status === 'collecting' ? 'Analyse en cours' : applied ? 'Instructions mises à jour' : 'À relire'}</span>
        <span className="audit-scope" title={report.scope}>{report.scope}</span>
        <button className="audit-text-button" onClick={() => { void refresh() }} aria-label="Actualiser les analyses">↻ Actualiser</button>
      </div>
      <ObservationSummary report={report} />
      <details className="audit-coverage">
        <summary><span>{report.sessions.length} conversation{report.sessions.length > 1 ? 's' : ''} disponible{report.sessions.length > 1 ? 's' : ''} dans l’historique</span><span>Sources et limites{report.limitations.length ? ` · ${report.limitations.length}` : ''} <span aria-hidden="true">⌄</span></span></summary>
        <div className="audit-coverage-content">
          <div>{report.coverage.length ? report.coverage.map((source) => <p key={source.provider}><strong>{source.provider === 'claude' ? 'Claude Code' : 'Codex'}</strong><span>{source.available ? `${source.included} historique${source.included > 1 ? 's' : ''} inclus sur ${source.discovered} découvert${source.discovered > 1 ? 's' : ''}` : 'Source indisponible'}</span>{source.note && <span>{source.note}</span>}</p>) : <p>Aucune source déclarée pour cette analyse.</p>}</div>
          <div><p><strong>Ce que cette analyse couvre</strong><span>{report.scope}</span></p><p>Historiques locaux accessibles uniquement. Les conversations web et celles qui ne figurent pas dans les sources ci-contre ne sont pas incluses.</p>{report.limitations.map((limitation, index) => <p key={index}>• {limitation}</p>)}</div>
        </div>
      </details>

      {applied && <div className="audit-success" role="status"><span>✓</span><div><strong>Vos instructions ont été mises à jour.</strong><p>{shortPath(report.targetPath)}</p>{report.backupPath && <p>Copie de sauvegarde : {shortPath(report.backupPath)}</p>}<p>Cette analyse est conservée en lecture seule.</p></div></div>}
      {report.status === 'collecting' && <div className="audit-collecting" role="status"><span className="audit-pulse" />Votre agent prépare l’analyse. Les constats apparaissent ici au fil de son travail.</div>}

      <div className="audit-workspace">
        <section className="audit-findings" aria-label="Constats de l’analyse">
          <div className="audit-column-heading"><h2>Ce qui revient</h2><span>{report.findings.length}</span></div>
          <p className="audit-column-intro">Des constats reliés à vos échanges.</p>
          <div className="audit-finding-list">{report.findings.map((item, index) => {
            const state = reviewFor(item).state
            return <button key={item.id} className={`audit-finding${finding?.id === item.id ? ' selected' : ''}${state === 'ignored' ? ' ignored' : ''}`} onClick={() => setFindingId(item.id)} aria-pressed={finding?.id === item.id} style={{ '--finding-index': Math.min(index, 6) } as React.CSSProperties}>
              <span className="audit-finding-category">{categoryLabels[item.category]}<span>{state === 'accepted' ? '✓ Retenu' : state === 'ignored' ? 'Ignoré' : String(index + 1).padStart(2, '0')}</span></span>
              <strong>{item.title}</strong><p>{item.summary}</p><span className="audit-finding-meta">{item.evidence.length} extrait{item.evidence.length > 1 ? 's' : ''} · {confidenceLabels[item.confidence].toLowerCase()}</span>
              {suggestedPreview.conflicts.some((conflict) => conflict.findingId === item.id) && <span className="audit-finding-meta">⚑ Conflit entre suggestions</span>}
              {!item.proposal && <span className="audit-finding-meta">Constat sans proposition</span>}
            </button>
          })}</div>
          {!report.findings.length && <p className="audit-empty-column">{report.status === 'collecting' ? 'Les premiers constats arriveront ici.' : 'Aucun changement proposé dans cette analyse. Votre document reste identique.'}</p>}
          {report.findings.length > 0 && <div className="audit-findings-footer">{accepted.length} proposition{accepted.length > 1 ? 's' : ''} retenue{accepted.length > 1 ? 's' : ''}</div>}
        </section>

        <section className="audit-document" aria-label="Aperçu du document d’instructions">
          <div className="audit-document-heading"><div><span className="audit-file-symbol" aria-hidden="true">↳</span><h2>{fileName(report.targetPath)}</h2></div><span className="audit-file-type">Markdown</span></div>
          <p className="audit-document-path" title={report.targetPath}>{shortPath(report.targetPath)}{!report.originalExists && !applied ? ' · nouveau fichier' : ''}</p>
          <div className="audit-document-tabs" role="tablist" aria-label="Version du document">
            {([['suggestions', 'Suggestions'], ['retained', 'Version retenue'], ['markdown', 'Markdown']] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
          </div>
          <div className="audit-document-caption"><p>{tab === 'suggestions' && !applied ? 'Suggestions non ignorées · rien n’est encore écrit' : applied ? 'Version appliquée lors de cette analyse' : `${accepted.length} proposition${accepted.length > 1 ? 's' : ''} retenue${accepted.length > 1 ? 's' : ''} · aperçu avant écriture`}</p>{tab !== 'markdown' && <span>+{additions} <span>−{removals}</span></span>}</div>
          {currentPreview.conflicts.length > 0 && <div className="audit-conflicts" role="status">{currentPreview.conflicts.length} proposition{currentPreview.conflicts.length > 1 ? 's' : ''} en conflit, exclue{currentPreview.conflicts.length > 1 ? 's' : ''} de cet aperçu. Consultez les constats concernés.</div>}
          <div className="audit-document-scroll" role="tabpanel" ref={documentScroll}>
            {tab === 'markdown' ? <pre className="audit-raw-markdown">{retainedPreview.content || 'Le document est encore vide.'}</pre> : rows.length ? <DocumentLines rows={rows} selectedBefore={finding?.proposal?.before} selectedAfter={selectedReview?.after} /> : <div className="audit-empty-document"><span>↳</span><h3>Une page à votre image.</h3><p>{suggestions.length ? 'Retenez une proposition pour construire votre document.' : 'Les instructions proposées apparaîtront ici.'}</p></div>}
          </div>
          <div className="audit-document-footer"><span>{tab === 'suggestions' ? '+ Ajouts · − Suppressions' : 'Votre sélection, réunie dans un document'}</span><button className="audit-text-button" onClick={() => { void copy(retainedPreview.content, 'La version retenue a été copiée.') }} disabled={!retainedPreview.content}>Copier la version retenue</button></div>
        </section>

        <section className="audit-detail" aria-label="Preuves et proposition sélectionnée">
          {finding ? <>
            <div className="audit-column-heading"><h2>Pourquoi cette règle ?</h2></div>
            <div className="audit-detail-scroll">
              <span className="audit-confidence"><span className={`audit-confidence-dots ${finding.confidence}`} aria-hidden="true"><i /><i /><i /></span>{confidenceLabels[finding.confidence]}</span>
              <h3 className="audit-detail-title">{finding.title}</h3><p className="audit-detail-summary">{finding.summary}</p>
              <h4 className="audit-detail-label">Dans vos conversations</h4>
              {finding.evidence.length ? finding.evidence.map((evidence, index) => {
                const session = report.sessions.find((item) => item.id === evidence.sessionId)
                return <figure className="audit-evidence" key={`${evidence.sessionId}:${evidence.messageId}:${index}`}><blockquote>{evidence.excerpt}</blockquote><figcaption><span>{session?.provider === 'claude' ? 'Claude Code' : session?.provider === 'codex' ? 'Codex' : 'Conversation'}{session?.title ? ` · ${session.title}` : ''}</span><details><summary>Voir la référence</summary><span>Conversation : {evidence.sessionId}</span><span>Message : {evidence.messageId}</span></details></figcaption></figure>
              }) : <p className="audit-detail-summary">Aucun extrait joint. Ce constat manque de preuves vérifiables.</p>}
              {finding.proposal && <>
                <h4 className="audit-detail-label">La proposition</h4><p className="audit-rationale">{finding.proposal.rationale}</p>
                {finding.proposal.before && <details className="audit-before"><summary>Texte remplacé</summary><pre>{finding.proposal.before}</pre></details>}
                <label className="audit-editor-label" htmlFor="audit-proposal-editor">{applied ? selectedReview?.state === 'accepted' ? 'Texte appliqué' : 'Proposition non retenue' : 'Ajustez la règle à votre façon'}</label>
                <textarea id="audit-proposal-editor" className="audit-proposal-editor" value={selectedReview?.after ?? ''} onChange={(event) => updateReview(finding, { after: event.target.value })} readOnly={!editable} spellCheck={false} />
                {selectedConflict && <p className="audit-rule-conflict" role="status">{selectedRetainedConflict ? 'Conflit dans votre sélection. ' : 'Conflit lorsque toutes les suggestions sont réunies. '}{conflictMessage(selectedConflict.message)}</p>}
                {selectedReview?.after !== finding.proposal.after && !applied && <button className="audit-text-button audit-reset" disabled={!editable} onClick={() => updateReview(finding, { after: finding.proposal!.after })}>Rétablir la proposition initiale</button>}
              </>}
            </div>
            {finding.proposal && <div className="audit-decision-actions"><button className={`pill ${selectedReview?.state === 'accepted' ? 'audit-retained-button' : 'pill-white'}`} disabled={!editable} onClick={() => updateReview(finding, { state: selectedReview?.state === 'accepted' ? 'pending' : 'accepted' })}>{selectedReview?.state === 'accepted' ? '✓ Retenue' : 'Retenir la règle'}</button><button className="pill pill-quiet" disabled={!editable} onClick={() => updateReview(finding, { state: selectedReview?.state === 'ignored' ? 'pending' : 'ignored' })}>{selectedReview?.state === 'ignored' ? 'Reconsidérer' : 'Ignorer'}</button></div>}
          </> : <div className="audit-no-detail"><h2>Chaque règle a sa raison.</h2><p>Sélectionnez un constat pour lire les extraits et ajuster sa proposition.</p></div>}
        </section>
      </div>

      {!applied && <footer className="audit-apply-bar"><div><strong>{accepted.length ? `${accepted.length} règle${accepted.length > 1 ? 's' : ''} prête${accepted.length > 1 ? 's' : ''} à retenir dans votre document` : 'À vous de choisir ce que votre agent doit retenir.'}</strong><p>{retainedPreview.conflicts.length ? 'Résolvez ou ignorez les propositions en conflit avant de continuer.' : report.originalExists ? 'Une copie de sauvegarde sera créée avant la mise à jour.' : 'Le fichier sera créé avec les règles que vous avez retenues.'}</p></div><button className="pill pill-primary" disabled={!editable || !accepted.length || retainedPreview.conflicts.length > 0} onClick={() => { void apply() }}>{busy ? 'Mise à jour…' : `Mettre à jour ${fileName(report.targetPath)}`}<span aria-hidden="true">↗</span></button></footer>}
    </>}
  </main>
}
