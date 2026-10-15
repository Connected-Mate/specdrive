import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const MAX_SCAN_ENTRIES = 20_000
const MAX_MESSAGES = 10_000
const MAX_MESSAGE_CHARS = 100_000
const sha = text => createHash('sha256').update(text).digest('hex')
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined
const textBlocks = value => typeof value === 'string' ? value : Array.isArray(value)
  ? value.filter(block => block && ['text', 'input_text', 'output_text'].includes(block.type) && typeof block.text === 'string').map(block => block.text).join('\n') : ''
const injected = text => /^\s*(?:# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<user_instructions>|<system-reminder>|<local-command-caveat>|<command-name>|<ide_opened_file>|<ide_selection>)/i.test(text)

/** Normalize only conversational message records. Tool calls/results, system
 * instructions, metadata and injected context are never treated as user feedback. */
export function parseHistory(provider, source, sourceKey = 'session') {
  const records = []
  const events = []
  let projectPath
  let startedAt
  let truncated = false
  let malformed = 0
  let excludedReason
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue
    let row
    try { row = JSON.parse(lines[index]) } catch { malformed++; continue }
    if (!row || typeof row !== 'object') continue
    if (provider === 'codex' && row.type === 'session_meta') {
      if (typeof row.payload?.cwd === 'string') projectPath = row.payload.cwd
      startedAt = timestamp(row.payload?.timestamp ?? row.timestamp) ?? startedAt
      const source = row.payload?.source
      const internalSource = source && typeof source === 'object' && ('subagent' in source || 'internal' in source)
      const internalLabel = typeof source === 'string' && /^(?:subagent|internal)(?:_|$)/.test(source)
      if (internalSource || internalLabel || ['subagent', 'guardian_review', 'memory_consolidation'].includes(row.payload?.thread_source)) {
        excludedReason = 'Internal or subagent session: its user-role messages are not owner feedback.'
      }
    }
    if (provider === 'claude' && typeof row.cwd === 'string') projectPath = row.cwd
    const add = (destination, role, rawText) => {
      if (!['user', 'assistant'].includes(role) || !rawText.trim() || (role === 'user' && injected(rawText))) return
      if (rawText.length > MAX_MESSAGE_CHARS) { truncated = true; return }
      destination.push({ id: `m${index + 1}`, role, text: rawText, ...(timestamp(row.timestamp) ? { timestamp: timestamp(row.timestamp) } : {}) })
    }
    if (provider === 'claude') {
      if (row.isMeta || row.isSidechain || row.isCompactSummary) continue
      if (['user', 'assistant'].includes(row.type) && row.message?.role === row.type) add(records, row.type, textBlocks(row.message.content))
    } else if (provider === 'codex') {
      if (row.type === 'event_msg' && row.payload?.type === 'user_message') add(events, 'user', textBlocks(row.payload.message))
      if (row.type === 'event_msg' && row.payload?.type === 'agent_message') add(events, 'assistant', textBlocks(row.payload.message))
      if (row.type === 'response_item' && row.payload?.type === 'message') add(records, row.payload.role, textBlocks(row.payload.content))
    }
  }
  // Current Codex logs duplicate messages as event_msg and response_item.
  // Pair only nearby identical records, one to one. Keeping unrelated records
  // preserves old response-only portions of a mixed-format conversation.
  const duplicatedRecords = new Set()
  for (const event of events) {
    const eventLine = Number(event.id.slice(1))
    // Binary-search the nearby line window so a large transcript cannot turn
    // deduplication into a quadratic scan of every message against every event.
    let low = 0
    let high = records.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (Number(records[middle].id.slice(1)) < eventLine - 20) low = middle + 1
      else high = middle
    }
    let closest
    let distance = Infinity
    for (let index = low; index < records.length; index++) {
      const record = records[index]
      const line = Number(record.id.slice(1))
      if (line > eventLine + 20) break
      if (duplicatedRecords.has(record.id) || record.role !== event.role || record.text !== event.text) continue
      if (record.timestamp && event.timestamp && Math.abs(Date.parse(record.timestamp) - Date.parse(event.timestamp)) > 5_000) continue
      if (Math.abs(line - eventLine) < distance) { closest = record; distance = Math.abs(line - eventLine) }
    }
    if (closest) duplicatedRecords.add(closest.id)
  }
  let messages = [...records.filter(message => !duplicatedRecords.has(message.id)), ...events].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  if (excludedReason) messages = []
  if (messages.length > MAX_MESSAGES) { messages = messages.slice(-MAX_MESSAGES); truncated = true }
  const firstTimestamp = startedAt ?? messages.find(message => message.timestamp)?.timestamp
  const lastTimestamp = messages.findLast(message => message.timestamp)?.timestamp
  const session = {
    id: sha(`${provider}:${sourceKey}`).slice(0, 32), provider,
    title: messages.find(message => message.role === 'user')?.text.replace(/\s+/g, ' ').slice(0, 120) ?? 'Untitled local session',
    ...(projectPath ? { projectPath } : {}),
    ...(firstTimestamp ? { startedAt: firstTimestamp } : {}),
    ...(lastTimestamp ? { updatedAt: lastTimestamp } : {}),
    messageCount: messages.length
  }
  return { session, messages, truncated, malformed, ...(excludedReason ? { excludedReason } : {}) }
}

async function walk(root, state, depth = 0) {
  if (depth > 12 || state.entries >= MAX_SCAN_ENTRIES) { state.capped = true; return }
  let directory
  try {
    const stat = await fs.lstat(root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return
    directory = await fs.opendir(root)
  } catch (error) { if (error.code !== 'ENOENT') state.unreadable++; return }
  state.available = true
  for await (const entry of directory) {
    if (++state.entries > MAX_SCAN_ENTRIES) { state.capped = true; break }
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) await walk(file, state, depth + 1)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const stat = await fs.lstat(file)
        if (stat.isFile() && !stat.isSymbolicLink()) state.files.push({ path: file, size: stat.size, mtime: stat.mtimeMs, provider: state.provider })
      } catch { state.unreadable++ }
    }
  }
}

/** Bounded local inventory. There is deliberately no network/cloud fallback. */
export async function collectHistory({ projectPath, limit = 100, providers = ['claude', 'codex'] } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('History limit must be an integer between 1 and 500.')
  if (!Array.isArray(providers) || !providers.length || providers.some(provider => !['claude', 'codex'].includes(provider))) throw new Error('Choose Claude and/or Codex history.')
  const home = path.resolve(process.env.SPECDRIVE_HISTORY_HOME || os.homedir())
  const states = []
  for (const provider of [...new Set(providers)]) {
    const state = { provider, available: false, entries: 0, capped: false, unreadable: 0, files: [], included: 0, omitted: 0, excluded: 0 }
    const customCodexHome = !process.env.SPECDRIVE_HISTORY_HOME && process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : undefined
    const codexHome = customCodexHome ?? path.join(home, '.codex')
    const anchor = provider === 'codex' && customCodexHome ? customCodexHome : home
    const roots = provider === 'claude' ? [path.join(home, '.claude', 'projects')] : [path.join(codexHome, 'sessions'), path.join(codexHome, 'archived_sessions')]
    for (const root of roots) {
      try {
        // Reject symlinked history roots and ancestors rather than following them
        // into an unrelated filesystem tree.
        const canonical = await fs.realpath(root)
        const canonicalAnchor = await fs.realpath(anchor)
        if (canonical !== path.join(canonicalAnchor, path.relative(anchor, root))) { state.unreadable++; continue }
      } catch (error) { if (error.code !== 'ENOENT') state.unreadable++; continue }
      await walk(root, state)
    }
    states.push(state)
  }
  const candidates = states.flatMap(state => state.files).sort((a, b) => b.mtime - a.mtime)
  const histories = []
  let bytes = 0
  let examined = 0
  let capped = false
  // Project filtering may need to inspect several recent sessions, but must not
  // expand the scan without bound when most sessions belong to another project.
  for (const candidate of candidates) {
    if (histories.length >= limit || examined >= 2_000) { capped = true; break }
    examined++
    const state = states.find(item => item.provider === candidate.provider)
    if (candidate.size > MAX_FILE_BYTES || bytes + candidate.size > MAX_TOTAL_BYTES) { state.omitted++; continue }
    let handle
    try {
      handle = await fs.open(candidate.path, constants.O_RDONLY | constants.O_NOFOLLOW)
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES || bytes + stat.size > MAX_TOTAL_BYTES) { state.omitted++; continue }
      // Read no more than the measured budget even if the source is growing.
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES))
      let used = 0
      while (used < buffer.length) { const result = await handle.read(buffer, used, buffer.length - used, used); if (!result.bytesRead) break; used += result.bytesRead }
      bytes += used
      const parsed = parseHistory(candidate.provider, buffer.subarray(0, used).toString('utf8'), path.relative(home, candidate.path))
      if (parsed.excludedReason) { state.excluded++; continue }
      if (projectPath && (!parsed.session.projectPath || path.resolve(parsed.session.projectPath) !== path.resolve(projectPath))) continue
      if (parsed.truncated || parsed.malformed) state.omitted++
      if (!parsed.messages.length) continue
      histories.push({ session: parsed.session, messages: parsed.messages })
      state.included++
    } catch { state.unreadable++ } finally { await handle?.close() }
  }
  const coverage = states.map(state => ({ provider: state.provider, available: state.available, discovered: state.files.length, included: state.included,
    note: `${state.included} local sessions included from ${state.files.length} discovered files. ${!state.available ? 'Local history is unavailable. ' : ''}${state.capped ? 'Directory scan limit reached. ' : ''}${state.unreadable ? `${state.unreadable} paths were unreadable or symlinked. ` : ''}${state.omitted ? `${state.omitted} files or messages were omitted, malformed or exceeded size limits. ` : ''}${state.excluded ? `${state.excluded} internal or subagent sessions were excluded because they are not owner conversations. ` : ''}${capped ? `Recent-session limit applied (${limit} sessions maximum). ` : ''}Cloud conversations are not accessed.` }))
  const limitations = ['Only readable local Claude and Codex conversation logs are included; remote/cloud-only, deleted and unavailable conversations are not accessed.', `History is bounded to ${limit} recent matching sessions, 20,000 directory entries per provider, 16 MiB per file and 64 MiB total. Long messages and malformed records may be omitted.`, 'Elapsed times are wall-clock intervals between recorded messages; pauses and parallel work cannot be separated from active agent work.']
  if (states.some(state => state.omitted || state.unreadable || state.capped)) limitations.push('Some local files or records were excluded by access, format or size checks; see provider coverage.')
  if (states.some(state => state.excluded)) limitations.push('Codex internal and subagent sessions were excluded; their user-role messages do not establish the owner’s preferences.')
  return { histories, coverage, limitations }
}
