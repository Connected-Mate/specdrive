/** Pure preview shared by the renderer and writer. Replacements refer to the
 * original snapshot, never to another proposal's output. Conflicts remain visible. */
export function previewAudit(original, findings, decisions) {
  const conflicts = []
  const edits = []
  const appends = []
  const seen = new Set()
  const byId = new Map(findings.map(finding => [finding.id, finding]))
  for (const decision of decisions) {
    const findingId = decision?.findingId
    const conflict = message => conflicts.push({ findingId: String(findingId ?? ''), message })
    if (seen.has(findingId)) { conflict('This finding was selected more than once.'); continue }
    seen.add(findingId)
    const finding = byId.get(findingId)
    if (!finding?.proposal) { conflict('This finding has no instruction proposal.'); continue }
    if (typeof decision.after !== 'string' || decision.after.length > 100_000) {
      conflict('The edited proposal must be text of at most 100,000 characters.'); continue
    }
    const before = finding.proposal.before
    if (before === '') { appends.push({ findingId, after: decision.after }); continue }
    const start = original.indexOf(before)
    if (start < 0) { conflict('The original text was not found in the snapshot.'); continue }
    if (original.indexOf(before, start + 1) !== -1) {
      conflict('The original text occurs more than once; select a unique passage.'); continue
    }
    edits.push({ findingId, start, end: start + before.length, after: decision.after })
  }
  edits.sort((a, b) => a.start - b.start)
  const overlapping = new Set()
  for (let a = 0; a < edits.length; a++) {
    for (let b = a + 1; b < edits.length && edits[b].start < edits[a].end; b++) {
      overlapping.add(edits[a].findingId)
      overlapping.add(edits[b].findingId)
    }
  }
  for (const findingId of overlapping) conflicts.push({ findingId, message: 'Selected replacements overlap; keep one or revise the proposals.' })
  let content = original
  for (const edit of edits.toReversed ? edits.toReversed() : [...edits].reverse()) {
    if (!overlapping.has(edit.findingId)) content = content.slice(0, edit.start) + edit.after + content.slice(edit.end)
  }
  for (const append of appends) {
    if (!append.after) continue
    content += (content ? content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n' : '') + append.after
  }
  return { content, conflicts }
}
