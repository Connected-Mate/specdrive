import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AuditDecision, AuditFinding, AuditReport, AuditTarget } from '@shared/audit-types'
import { previewAudit } from '@shared/audit-preview.mjs'
import { agentAuditPrompt } from '@shared/agent-audit-prompt.mjs'
import { useToast } from '@/components/Toast'
import '../styles/agent-studio.css'

type Review = { state: 'pending' | 'accepted' | 'ignored'; after: string }
type DocumentPart = { kind: 'text'; key: string; text: string } | { kind: 'change'; key: string; finding: AuditFinding; after: string }

const shortPath = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~')
const fileName = (path: string): string => path.split(/[\\/]/).pop() || 'Instructions'
const confidence: Record<AuditFinding['confidence'], string> = {
  low: 'Interprétation à confirmer', medium: 'Confiance moyenne', high: 'Confiance élevée'
}
const reportDate = (date: string): string => {
  const value = new Date(date)
  return Number.isNaN(value.getTime()) ? 'Date inconnue' : value.toLocaleString('fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}
const conflictMessage = (message: string): string => {
  if (message.includes('overlap')) return 'Plusieurs propositions remplacent le même passage. Retenez-en une seule.'
  if (message.includes('occurs more than once')) return 'Le passage à remplacer apparaît plusieurs fois dans le document.'
  if (message.includes('not found')) return 'Le passage à remplacer est introuvable dans le document d’origine.'
  if (message.includes('100,000')) return 'Le texte proposé dépasse la limite de 100 000 caractères.'
  if (message.includes('no instruction proposal')) return 'Ce constat ne contient pas de modification du document.'
  return message
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

/** Render text, never HTML. Editing always retains the original Markdown string. */
function inlineMarkdown(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g)
  return tokens.map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`')) return <code key={index}>{token.slice(1, -1)}</code>
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
    if (link) return <a key={index} href={link[2]} onClick={(event) => { event.preventDefault(); void window.specdrive.openExternal(link[2]) }}>{link[1]}</a>
    return token
  })
}

function MarkdownDocument({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const key = index
    if (!line.trim()) { index++; continue }
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      index++
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++])
      if (index < lines.length) index++
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push(React.createElement(`h${heading[1].length}`, { key }, inlineMarkdown(heading[2])))
      index++; continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push(<hr key={key} />); index++; continue }
    if (/^\s*([-*+] |\d+\. )/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: React.ReactNode[] = []
      while (index < lines.length && /^\s*([-*+] |\d+\. )/.test(lines[index])) {
        items.push(<li key={index}>{inlineMarkdown(lines[index++].replace(/^\s*([-*+] |\d+\. )/, ''))}</li>)
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>)
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''))
      blocks.push(<blockquote key={key}>{inlineMarkdown(quote.join('\n'))}</blockquote>)
      continue
    }
    const paragraph: string[] = [line]
    index++
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|\s*```|>\s?|\s*[-*+] |\s*\d+\. )/.test(lines[index])) paragraph.push(lines[index++])
    blocks.push(<p key={key}>{inlineMarkdown(paragraph.join('\n'))}</p>)
  }
  return <div className="studio-markdown">{blocks}</div>
}

/** Anchor visual changes to the captured file; the shared preview remains the writer's authority. */
function documentParts(original: string, findings: AuditFinding[], decisions: AuditDecision[], conflictIds: Set<string>): DocumentPart[] {
  const byId = new Map(findings.map((finding) => [finding.id, finding]))
  const replacements: { start: number; end: number; finding: AuditFinding; after: string }[] = []
  const appends: DocumentPart[] = []
  for (const decision of decisions) {
    const finding = byId.get(decision.findingId)
    if (!finding?.proposal || conflictIds.has(finding.id)) continue
    if (!finding.proposal.before) {
      appends.push({ kind: 'change', key: finding.id, finding, after: decision.after })
    } else {
      const start = original.indexOf(finding.proposal.before)
      if (start >= 0) replacements.push({ start, end: start + finding.proposal.before.length, finding, after: decision.after })
    }
  }
  replacements.sort((a, b) => a.start - b.start)
  const parts: DocumentPart[] = []
  let cursor = 0
  for (const replacement of replacements) {
    if (replacement.start > cursor) parts.push({ kind: 'text', key: `text:${cursor}`, text: original.slice(cursor, replacement.start) })
    parts.push({ kind: 'change', key: replacement.finding.id, finding: replacement.finding, after: replacement.after })
    cursor = replacement.end
  }
  if (cursor < original.length) parts.push({ kind: 'text', key: `text:${cursor}`, text: original.slice(cursor) })
  return [...parts, ...appends]
}

function InlineRuleEditor({ value, title, focus, onFocusHandled, onChange }: { value: string; title: string; focus: boolean; onFocusHandled: () => void; onChange: (value: string) => void }): React.JSX.Element {
  const input = useRef<HTMLTextAreaElement>(null)
  const resize = useCallback((): void => {
    if (!input.current) return
    input.current.style.height = '0px'
    input.current.style.height = `${Math.max(54, input.current.scrollHeight)}px`
  }, [])
  useLayoutEffect(resize, [value, resize])
  useLayoutEffect(() => {
    if (!input.current) return
    let width = input.current.getBoundingClientRect().width
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (typeof next === 'number' && next !== width) { width = next; resize() }
    })
    observer.observe(input.current)
    return () => observer.disconnect()
  }, [resize])
  useLayoutEffect(() => {
    if (!focus || !input.current) return
    input.current.focus({ preventScroll: true })
    onFocusHandled()
  }, [focus, onFocusHandled])
  return <textarea ref={input} className="studio-inline-editor" aria-label={`Règle proposée : ${title}`} value={value} onChange={(event) => onChange(event.target.value)} maxLength={100_000} spellCheck={false} placeholder="Un texte vide supprimera ce passage." />
}

function AuditDetails({ report }: { report: AuditReport }): React.JSX.Element {
  const observations = report.observations
  const corrections = new Set(observations.flatMap((item) => item.correctionMessageIds.map((id) => `${item.sessionId}:${id}`))).size
  const elapsed = observations.flatMap((item) => typeof item.elapsedMs === 'number' && item.elapsedMs >= 0 ? [item.elapsedMs] : [])
  const validatedElapsed = observations.flatMap((item) => typeof item.validatedElapsedMs === 'number' && item.validatedElapsedMs >= 0 ? [item.validatedElapsedMs] : [])
  const completionMedian = median(elapsed)
  const validationMedian = median(validatedElapsed)
  return <section className="studio-options-section">
    <h3>Ce qui a été examiné</h3><p>{report.scope}</p>
    <p>{report.sessions.length} conversations disponibles · {observations.length} demandes analysées · {corrections} corrections observées.</p>
    <p>{observations.filter((item) => item.outcome === 'validated').length} résultats validés par vous, {observations.filter((item) => item.outcome === 'declared').length} déclarés terminés, {observations.filter((item) => item.outcome === 'unknown').length} sans résultat établi.</p>
    {completionMedian !== undefined && <p>Délai médian déclaré : {duration(completionMedian)} sur {elapsed.length} demandes horodatées.</p>}
    {validationMedian !== undefined && <p>Délai médian avant validation : {duration(validationMedian)} sur {validatedElapsed.length} demandes horodatées.</p>}
    <p>{elapsed.length || validatedElapsed.length ? 'Durées calendaires, pauses incluses.' : 'Horodatages de messages insuffisants pour mesurer les durées.'}</p>
    {report.coverage.length ? report.coverage.map((source) => <p key={source.provider}><strong>{source.provider === 'claude' ? 'Claude Code' : 'Codex'}.</strong> {source.available ? `${source.included} historiques inclus sur ${source.discovered} découverts.` : 'Source indisponible.'} {source.note}</p>) : <p>Aucune source déclarée.</p>}
    {report.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}
    {report.backupPath && <p>Copie de sauvegarde : <span className="studio-selectable">{shortPath(report.backupPath)}</span></p>}
  </section>
}

export function AgentStudio({ projectPath }: { projectPath?: string }): React.JSX.Element {
  const toast = useToast()
  const [reports, setReports] = useState<AuditReport[]>([])
  const [targets, setTargets] = useState<AuditTarget[]>([])
  const [targetPath, setTargetPath] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [findingId, setFindingId] = useState<string | null>(null)
  const [focusEditorId, setFocusEditorId] = useState<string | null>(null)
  const [reviews, setReviews] = useState<Record<string, Record<string, Review>>>({})
  const [setupOn, setSetupOn] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [retainedOnly, setRetainedOnly] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const [waitingSince, setWaitingSince] = useState<number | null>(null)
  const [historyScope, setHistoryScope] = useState<'all' | 'project'>('all')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mcp, setMcp] = useState<{ nodeBin: string; serverPath: string }>()
  const [targetSnapshot, setTargetSnapshot] = useState<{ path: string; content: string; exists: boolean } | null>(null)
  const [targetLoading, setTargetLoading] = useState(false)
  const [targetError, setTargetError] = useState<string | null>(null)
  const [targetReadRevision, setTargetReadRevision] = useState(0)
  const documentScroll = useRef<HTMLDivElement>(null)
  const options = useRef<HTMLDivElement>(null)
  const optionsTrigger = useRef<HTMLButtonElement>(null)
  const closeOptions = useCallback((): void => {
    setOptionsOpen(false)
    optionsTrigger.current?.focus({ preventScroll: true })
  }, [])

  const refresh = useCallback(async (clearError = false): Promise<void> => {
    try {
      const [nextReports, nextTargets] = await Promise.all([window.specdrive.agentAudit.list(), window.specdrive.agentAudit.targets()])
      nextReports.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      setReports(nextReports)
      setTargets((current) => [...nextTargets, ...current.filter((target) => !nextTargets.some((item) => item.path === target.path))])
      setTargetPath((current) => current || nextReports[0]?.targetPath || nextTargets[0]?.path || '')
      if (clearError) setError(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Impossible de charger les analyses. Réessayez.') }
    finally { setLoaded(true) }
  }, [])
  useEffect(() => {
    void refresh()
    void window.specdrive.getMcpInfo().then(setMcp).catch(() => {})
    return window.specdrive.onProjectsChanged(() => { void refresh() })
  }, [refresh])

  const latest = reports.find((item) => item.id === selectedId) ?? reports[0]
  const report = setupOn ? undefined : latest
  const reviewKey = report ? `${report.id}:${report.updatedAt}` : ''
  const finding = report?.findings.find((item) => item.id === findingId) ?? report?.findings[0]
  const applied = report?.status === 'applied'
  const editable = report?.status === 'ready' && !busy
  const displayTarget = report?.targetPath ?? targetPath
  const currentTarget = targets.find((item) => item.path === displayTarget)
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
  const parts = useMemo(() => report ? documentParts(report.original, report.findings, suggestions, new Set(suggestedPreview.conflicts.map((item) => item.findingId))) : [], [report, suggestions, suggestedPreview.conflicts])
  const selectedConflict = finding && suggestedPreview.conflicts.find((item) => item.findingId === finding.id)
  const unplacedFinding = finding?.proposal && !applied && !retainedOnly && !parts.some((part) => part.kind === 'change' && part.finding.id === finding.id) ? finding : undefined

  useEffect(() => {
    if (report || !displayTarget) return
    let cancelled = false
    setTargetLoading(true); setTargetError(null); setTargetSnapshot(null)
    void window.specdrive.agentAudit.readTarget(displayTarget).then((snapshot) => {
      if (!cancelled) setTargetSnapshot(snapshot)
    }).catch((err) => {
      if (!cancelled) setTargetError(err instanceof Error ? err.message : 'Impossible de lire ce document.')
    }).finally(() => { if (!cancelled) setTargetLoading(false) })
    return () => { cancelled = true }
  }, [report?.id, displayTarget, targetReadRevision])

  useEffect(() => {
    if (!optionsOpen) return
    const closeOutside = (event: PointerEvent): void => {
      if (options.current && !options.current.contains(event.target as Node)) setOptionsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); closeOptions() } }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [optionsOpen, closeOptions])

  useEffect(() => {
    if (waitingSince === null) return
    const incoming = reports.find((item) => item.targetPath === targetPath && new Date(item.createdAt).getTime() >= waitingSince - 1000)
    if (!incoming) return
    setSelectedId(incoming.id); setFindingId(null); setSetupOn(false)
    setRetainedOnly(false); setPromptCopied(false); setWaitingSince(null); setOptionsOpen(false)
  }, [reports, waitingSince, targetPath])

  // A new selection reveals its passage; editing never moves the document.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = documentScroll.current
      if (!container) return
      const selected = container.querySelector<HTMLElement>('.studio-change.is-selected')
      if (selected) container.scrollTop += selected.getBoundingClientRect().top - container.getBoundingClientRect().top - 48
      else container.scrollTop = 0
    })
    return () => cancelAnimationFrame(frame)
  }, [finding?.id, report?.id, retainedOnly])

  const updateReview = (item: AuditFinding, update: Partial<Review>): void => {
    if (!report || !editable) return
    setReviews((current) => ({ ...current, [reviewKey]: { ...current[reviewKey], [item.id]: { ...reviewFor(item), ...update } } }))
    setError(null)
  }
  const selectFinding = (item: AuditFinding, focusEditor = false): void => { setFindingId(item.id); setRetainedOnly(false); setFocusEditorId(focusEditor ? item.id : null) }
  const chooseTarget = async (): Promise<void> => {
    try {
      const target = await window.specdrive.agentAudit.chooseTarget()
      if (!target) return
      setTargets((current) => [...current.filter((item) => item.path !== target.path), target])
      setTargetPath(target.path); setSetupOn(true); setPromptCopied(false); setWaitingSince(null); setError(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Impossible de choisir ce fichier.') }
  }
  const copy = async (text: string, message: string): Promise<boolean> => {
    try { await window.specdrive.copyToClipboard(text); toast(message); return true }
    catch { setError('La copie a échoué. Réessayez.'); return false }
  }
  const copyPrompt = async (): Promise<void> => {
    if (!displayTarget) { setOptionsOpen(true); return }
    if (await copy(agentAuditPrompt(displayTarget, mcp, historyScope === 'project' ? projectPath : undefined), 'Prompt copié — collez-le dans votre agent.')) {
      setTargetPath(displayTarget); setPromptCopied(true); setWaitingSince(Date.now()); setOptionsOpen(false)
    }
  }
  const apply = async (): Promise<void> => {
    if (!report || !editable || !accepted.length || retainedPreview.conflicts.length) return
    setBusy(true); setError(null)
    try {
      const next = await window.specdrive.agentAudit.apply(report.id, accepted, report.updatedAt)
      setReports((current) => current.map((item) => item.id === next.id ? next : item))
      setRetainedOnly(true)
      toast('Vos instructions ont été mises à jour.')
    } catch (err) { setError(err instanceof Error ? err.message : 'La mise à jour a échoué. Vos choix sont conservés.') }
    finally { setBusy(false) }
  }

  const renderChange = (item: AuditFinding, after: string, unplaced = false): React.JSX.Element => {
    const selected = finding?.id === item.id
    const review = reviewFor(item)
    return <section key={item.id} className={`studio-change${selected ? ' is-selected' : ''}${review.state === 'accepted' ? ' is-accepted' : ''}${unplaced ? ' is-unplaced' : ''}`} data-finding-id={item.id}>
      <button className="studio-change-caption" onClick={() => selectFinding(item, true)}><span>{unplaced ? 'Non intégrée au document' : review.state === 'accepted' ? '✓ Modification retenue' : 'Modification proposée'}</span><span>{selected && editable ? 'Modifiez le texte ici' : item.title}</span></button>
      {unplaced && <p className="studio-unplaced-reason">{selectedConflict ? conflictMessage(selectedConflict.message) : 'Cette proposition a été ignorée. Vous pouvez encore la modifier et la retenir.'}</p>}
      {item.proposal?.before && <div className="studio-removed" aria-label="Texte à remplacer"><MarkdownDocument text={item.proposal.before} /></div>}
      {selected && editable ? <InlineRuleEditor value={after} title={item.title} focus={focusEditorId === item.id} onFocusHandled={() => setFocusEditorId(null)} onChange={(value) => updateReview(item, { after: value })} /> : <div className="studio-added" onClick={() => selectFinding(item, true)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectFinding(item, true) } }} aria-label={`Modifier la proposition : ${item.title}`}>
        {after ? <MarkdownDocument text={after} /> : <p className="studio-deletion-note">Ce passage sera supprimé.</p>}
      </div>}
      {selected && editable && after !== item.proposal?.after && <button className="studio-text-button studio-reset" onClick={() => updateReview(item, { after: item.proposal?.after ?? '' })}>Rétablir le texte proposé</button>}
    </section>
  }

  return <main className="agent-studio">
    <header className="studio-toolbar">
      <div className="studio-file"><svg width="16" height="18" viewBox="0 0 16 18" fill="none" aria-hidden="true"><path d="M10 1H2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6L10 1Zm0 0v5h5M4 10h7M4 13h5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg><div><h1>{displayTarget ? fileName(displayTarget) : 'Instructions de votre agent'}</h1><p title={displayTarget}>{displayTarget ? shortPath(displayTarget) : 'Choisissez un document dans les options'}</p></div></div>
      <div className="studio-toolbar-actions">
        {applied && <span className="studio-saved">✓ Enregistré</span>}
        {!applied && accepted.length > 0 ? <button className="pill pill-primary studio-primary" disabled={!editable || retainedPreview.conflicts.length > 0} onClick={() => { void apply() }}>{busy ? 'Enregistrement…' : `Appliquer ${accepted.length} modification${accepted.length > 1 ? 's' : ''}`}</button> : <button className="pill pill-primary studio-primary" disabled={!loaded || report?.status === 'collecting'} onClick={() => { void copyPrompt() }}>{promptCopied ? '✓ Prompt copié' : 'Copier le prompt d’analyse'}</button>}
        <div className="studio-options-anchor" ref={options}>
          <button className="studio-options-toggle" ref={optionsTrigger} aria-label="Options de l’analyse" title="Document, historique et sources" aria-expanded={optionsOpen} aria-controls="studio-options" onClick={() => setOptionsOpen((open) => !open)}>•••</button>
          {optionsOpen && <div id="studio-options" className="studio-options" aria-label="Document, historique et sources">
            <section className="studio-options-section"><h2>Document et analyse</h2>
              <label>Document à personnaliser<select value={displayTarget} onChange={(event) => { setTargetPath(event.target.value); setSetupOn(true); setPromptCopied(false); setWaitingSince(null) }}>
                {!targets.length && !displayTarget && <option value="">Aucun fichier sélectionné</option>}
                {displayTarget && !targets.some((target) => target.path === displayTarget) && <option value={displayTarget}>{shortPath(displayTarget)}</option>}
                {targets.map((target) => <option key={target.path} value={target.path}>{target.label}{target.exists ? '' : ' · à créer'}</option>)}
              </select></label><button className="studio-text-button" onClick={() => { void chooseTarget() }}>Choisir un autre fichier…</button>
              {projectPath && <label>Conversations à examiner<select value={historyScope} onChange={(event) => { setHistoryScope(event.target.value as 'all' | 'project'); setPromptCopied(false); setWaitingSince(null) }}><option value="all">Tous les historiques locaux accessibles</option><option value="project">Projet actuel · {fileName(projectPath)}</option></select></label>}
              <p>Les extraits sont lus par l’agent dans lequel vous collez le prompt. Les chats web Claude et ChatGPT ne sont pas récupérés automatiquement.</p>
              <button className="studio-text-button" onClick={() => { void refresh(true) }}>Actualiser les analyses</button>
            </section>
            {reports.length > 0 && <section className="studio-options-section"><label>Analyses précédentes<select aria-label="Choisir une analyse" value={report?.id ?? ''} onChange={(event) => { const selected = reports.find((item) => item.id === event.target.value); if (!selected) return; setSelectedId(selected.id); setTargetPath(selected.targetPath); setSetupOn(false); setFindingId(null); setRetainedOnly(false); setError(null); closeOptions() }}><option value="" disabled>Choisir une analyse</option>{reports.map((item) => <option key={item.id} value={item.id}>{reportDate(item.createdAt)} · {fileName(item.targetPath)}{item.status === 'applied' ? ' · appliquée' : ''}</option>)}</select></label></section>}
            {report && <section className="studio-options-section">
              {!applied && <label className="studio-checkbox"><input type="checkbox" checked={retainedOnly} onChange={(event) => { setRetainedOnly(event.target.checked); closeOptions() }} />Afficher uniquement la version retenue</label>}
              <button className="studio-text-button" disabled={!retainedPreview.content || retainedPreview.conflicts.length > 0} onClick={() => { void copy(retainedPreview.content, 'La version retenue a été copiée.') }}>Copier le Markdown retenu</button>
              <button className="studio-text-button" onClick={() => { setTargetPath(report.targetPath); setSetupOn(true); setPromptCopied(false); setWaitingSince(null); closeOptions() }}>Préparer une nouvelle analyse</button>
            </section>}
            {report && <AuditDetails report={report} />}
          </div>}
        </div>
      </div>
    </header>

    {error && <div className="studio-notice studio-error" role="alert"><p>{error}</p><button className="studio-text-button" onClick={() => { void refresh(true) }}>Actualiser</button><button className="studio-dismiss" aria-label="Fermer le message" onClick={() => setError(null)}>×</button></div>}

    <div className="studio-workspace">
      <section className="studio-document" aria-label="Document d’instructions">
        <div className="studio-document-scroll" ref={documentScroll}>
          <div className="studio-page">
            {!loaded || (!report && targetLoading) ? <p className="studio-document-placeholder" role="status">Chargement du document…</p> : !report ? targetError ? <div className="studio-blank-document" role="alert"><h2>Le document n’a pas pu être lu.</h2><p>{targetError}</p><button className="studio-text-button" onClick={() => setTargetReadRevision((value) => value + 1)}>Réessayer</button></div> : targetSnapshot?.content ? <><p className="studio-page-note">Document actuel · lancez une analyse pour obtenir des propositions.</p><MarkdownDocument text={targetSnapshot.content} /></> : <div className="studio-blank-document"><h2>{fileName(displayTarget)}</h2><p>{displayTarget ? 'Ce document ne contient pas encore d’instructions.' : 'Choisissez votre document dans les options en haut à droite.'}</p><p>Les règles proposées par votre agent apparaîtront ici. Vous pourrez les modifier directement dans le texte.</p>{(targetSnapshot?.exists === false || (currentTarget && !currentTarget.exists)) && <p className="studio-file-note">Ce fichier sera créé uniquement après votre validation.</p>}</div> : applied || retainedOnly ? <>
              <p className="studio-page-note">{applied ? 'Version appliquée · lecture seule' : 'Version retenue · aperçu avant enregistrement'}</p>
              {retainedPreview.content ? <MarkdownDocument text={retainedPreview.content} /> : <p className="studio-document-placeholder">Le document est vide.</p>}
            </> : <>
              <p className="studio-page-note">Les modifications proposées sont surlignées. Rien n’est encore enregistré.</p>
              {parts.length ? parts.map((part) => part.kind === 'text' ? <MarkdownDocument key={part.key} text={part.text} /> : renderChange(part.finding, part.after)) : <p className="studio-document-placeholder">Les premières instructions proposées apparaîtront ici.</p>}
              {unplacedFinding && renderChange(unplacedFinding, reviewFor(unplacedFinding).after, true)}
            </>}
          </div>
        </div>
      </section>

      <aside className="studio-findings" aria-label="Constats et propositions">
        <div className="studio-findings-heading"><h2>À retenir de vos échanges</h2>{report && <span>{report.findings.length}</span>}</div>
        <div className="studio-findings-scroll">
          {!report ? <div className="studio-invitation"><h3>Qu’est-ce que vous lui répétez ?</h3><p>Copiez le prompt en haut, puis collez-le dans votre agent connecté à SpecDrive.</p><p>Il relira vos échanges et proposera ici des règles pour votre document.</p><p>Vous choisissez celles à garder. Vous pouvez les réécrire directement dans la page.</p>{promptCopied && <p className="studio-waiting" role="status">En attente de l’analyse de votre agent…</p>}<p className="studio-privacy-note">Claude Code et Codex, historiques locaux accessibles. Les chats web ne sont pas importés. Les extraits sont lus par l’agent choisi.</p></div> : <>
            {report.status === 'collecting' && <p className="studio-panel-status" role="status">Votre agent examine les échanges. Ses constats apparaissent ici au fil de l’analyse.</p>}
            {applied && <p className="studio-panel-status" role="status">Vos instructions ont été mises à jour. Cette analyse est conservée en lecture seule.{report.backupPath && ' Le chemin de la sauvegarde est dans les options.'}</p>}
            {promptCopied && <p className="studio-panel-status" role="status">Prompt copié. Collez-le dans votre agent pour lancer une nouvelle analyse.</p>}
            {report.findings.map((item, index) => {
              const review = reviewFor(item)
              const selected = finding?.id === item.id
              const conflict = suggestedPreview.conflicts.find((entry) => entry.findingId === item.id)
              return <article key={item.id} className={`studio-finding${selected ? ' is-open' : ''}${review.state === 'ignored' ? ' is-ignored' : ''}`}>
                <button className="studio-finding-title" onClick={() => selectFinding(item)} aria-expanded={selected}><span className="studio-finding-number">{review.state === 'accepted' ? '✓' : String(index + 1).padStart(2, '0')}</span><span>{item.title}</span><span className="studio-finding-chevron" aria-hidden="true">{selected ? '−' : '+'}</span></button>
                {selected ? <div className="studio-finding-body"><p>{item.summary}</p>
                  {item.evidence.slice(0, 2).map((evidence, evidenceIndex) => {
                    const session = report.sessions.find((entry) => entry.id === evidence.sessionId)
                    const short = evidence.excerpt.length > 220
                    return <figure className="studio-evidence" key={`${evidence.messageId}:${evidenceIndex}`}><blockquote>« {short ? `${evidence.excerpt.slice(0, 220)}…` : evidence.excerpt} »</blockquote><figcaption><details><summary>{session?.provider === 'claude' ? 'Claude Code' : session?.provider === 'codex' ? 'Codex' : 'Conversation'} · voir la source</summary>{short && <p>{evidence.excerpt}</p>}{session?.title && <p>{session.title}</p>}<p>Conversation : {evidence.sessionId}</p><p>Message : {evidence.messageId}</p></details></figcaption></figure>
                  })}
                  {item.evidence.length > 2 && <details className="studio-more-evidence"><summary>{item.evidence.length - 2} autres extraits</summary>{item.evidence.slice(2).map((evidence, evidenceIndex) => <figure className="studio-evidence" key={evidenceIndex}><blockquote>« {evidence.excerpt} »</blockquote><figcaption>Conversation : {evidence.sessionId}<br />Message : {evidence.messageId}</figcaption></figure>)}</details>}
                  {!item.evidence.length && <p className="studio-panel-meta">Aucun extrait joint à ce constat.</p>}
                  {item.proposal ? <><p className="studio-proposal-reason"><strong>{applied ? review.state === 'accepted' ? 'Règle appliquée.' : 'Proposition non retenue.' : 'La règle proposée.'}</strong> {item.proposal.rationale}</p>{!applied && <p className="studio-panel-meta">Le texte se modifie dans le document, à gauche.</p>}</> : <p className="studio-panel-meta">Ce constat ne propose pas de modification du document.</p>}
                  <p className="studio-panel-meta">{confidence[item.confidence]}{conflict ? ' · conflit entre propositions' : ''}</p>
                  {conflict && <p className="studio-conflict">{conflictMessage(conflict.message)}</p>}
                  {item.proposal && !applied && <div className="studio-finding-actions"><button className={`pill ${review.state === 'accepted' ? 'studio-accepted-button' : 'pill-quiet'}`} disabled={!editable} onClick={() => updateReview(item, { state: review.state === 'accepted' ? 'pending' : 'accepted' })}>{review.state === 'accepted' ? '✓ Retenue' : 'Retenir'}</button><button className="studio-text-button" disabled={!editable} onClick={() => updateReview(item, { state: review.state === 'ignored' ? 'pending' : 'ignored' })}>{review.state === 'ignored' ? 'Reconsidérer' : 'Ignorer'}</button></div>}
                </div> : <p className="studio-finding-summary">{review.state === 'ignored' ? applied ? 'Non retenue dans le document.' : 'Proposition ignorée.' : review.state === 'accepted' ? applied ? 'Appliquée dans le document.' : 'Retenue pour le document.' : item.summary}</p>}
              </article>
            })}
            {!report.findings.length && <p className="studio-panel-status">{report.status === 'collecting' ? 'Les premiers constats arriveront ici.' : 'Aucune modification proposée dans cette analyse.'}</p>}
          </>}
        </div>
        {report && !applied && <div className="studio-findings-footer">{retainedPreview.conflicts.length ? 'Votre sélection contient un conflit. Choisissez une seule règle pour chaque passage.' : accepted.length ? `${accepted.length} modification${accepted.length > 1 ? 's' : ''} retenue${accepted.length > 1 ? 's' : ''}. ${report.originalExists ? 'Une sauvegarde sera créée à l’enregistrement.' : 'Le fichier sera créé à l’enregistrement.'}` : 'Retenez les règles qui vous ressemblent.'}</div>}
      </aside>
    </div>
  </main>
}
