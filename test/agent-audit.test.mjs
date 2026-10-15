// Every filesystem operation uses an isolated profile and data directory.
// These tests never read real conversation histories or overwrite real instructions.
import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startAudit, listAudits, getAudit, readAuditSession, submitAudit, applyAudit } from '../src/shared/agent-audit.mjs'
import { parseHistory, collectHistory } from '../src/shared/agent-history.mjs'
import { previewAudit } from '../src/shared/audit-preview.mjs'

let fixture
let targetPath
let oldData
let oldHome
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n'
const claudeMessage = (role, text, timestamp) => ({ type: role, timestamp, message: { role, content: [{ type: 'text', text }] } })
const codexMessage = (role, text, timestamp) => ({ type: 'response_item', timestamp, payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } })

beforeEach(async () => {
  fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'specdrive-audit-test-')))
  oldData = process.env.SPECDRIVE_DATA_DIR
  oldHome = process.env.SPECDRIVE_HISTORY_HOME
  process.env.SPECDRIVE_DATA_DIR = path.join(fixture, 'data')
  process.env.SPECDRIVE_HISTORY_HOME = path.join(fixture, 'home')
  await fs.mkdir(path.join(fixture, 'home', '.claude', 'projects', 'project'), { recursive: true })
  await fs.mkdir(path.join(fixture, 'home', '.codex', 'sessions', '2026', '10'), { recursive: true })
  await fs.mkdir(path.join(fixture, 'home', '.codex', 'archived_sessions'), { recursive: true })
  targetPath = path.join(fixture, 'CLAUDE.md')
  await fs.writeFile(targetPath, '# Instructions\n\nBe clear.\n')
  const rows = [
    { ...claudeMessage('user', 'Please implement the form.', '2026-10-15T10:00:00Z'), cwd: fixture },
    claudeMessage('assistant', 'I am implementing it.', '2026-10-15T10:01:00Z'),
    claudeMessage('user', 'Please verify the form in the browser.', '2026-10-15T10:02:00Z'),
    claudeMessage('assistant', 'Implemented and verified in the browser.', '2026-10-15T10:03:00Z'),
    claudeMessage('user', 'Yes, the form works.', '2026-10-15T10:04:00Z')
  ]
  await fs.writeFile(path.join(fixture, 'home', '.claude', 'projects', 'project', 'sample.jsonl'), jsonl(rows))
})
afterEach(async () => {
  if (oldData === undefined) delete process.env.SPECDRIVE_DATA_DIR; else process.env.SPECDRIVE_DATA_DIR = oldData
  if (oldHome === undefined) delete process.env.SPECDRIVE_HISTORY_HOME; else process.env.SPECDRIVE_HISTORY_HOME = oldHome
  await fs.rm(fixture, { recursive: true, force: true })
})
async function audit() { return startAudit({ targetPath, providers: ['claude'] }) }
function finding(report, overrides = {}) {
  return { id: 'browser-check', title: 'Verify forms in a browser', category: 'workflow', summary: 'The user had to ask for browser verification.', confidence: 'medium', evidence: [{ sessionId: report.sessions[0].id, messageId: 'm3', excerpt: 'Please verify the form in the browser.' }], proposal: { before: 'Be clear.', after: 'Verify UI changes in a browser.', rationale: 'Respond to the recorded request for verification.' }, ...overrides }
}
async function ready(report, override) { return submitAudit(report.id, { findings: [finding(report, override)], observations: [], limitations: [] }) }

test('normalizes Claude text while excluding tool results, system context and sidechains', () => {
  const result = parseHistory('claude', jsonl([
    claudeMessage('user', 'Build it.', '2026-10-15T10:00:00Z'),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'Fake user correction' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Secret' }, { type: 'tool_use', name: 'shell' }, { type: 'text', text: 'Built.' }] } },
    { ...claudeMessage('user', 'Injected'), isMeta: true },
    { ...claudeMessage('user', 'Subagent task'), isSidechain: true },
    claudeMessage('user', '<system-reminder>system data</system-reminder>'),
    { type: 'system', message: { role: 'system', content: 'Instructions' } }
  ]) + '{invalid\n')
  assert.deepEqual(result.messages.map(message => message.text), ['Build it.', 'Built.'])
  assert.equal(result.malformed, 1)
  assert.equal(result.session.messageCount, 2)
})

test('normalizes Codex events once and excludes injected response items and tools', () => {
  const result = parseHistory('codex', jsonl([
    { type: 'session_meta', payload: { cwd: '/example/project', timestamp: '2026-10-15T10:00:00Z' } },
    codexMessage('user', '# AGENTS.md instructions for /example/project\nInjected'),
    codexMessage('developer', 'Developer instructions'),
    codexMessage('user', 'Build the page.'),
    { type: 'event_msg', payload: { type: 'user_message', message: 'Build the page.' } },
    { type: 'response_item', payload: { type: 'function_call_output', output: 'Fake correction' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'The page is built.' } },
    codexMessage('assistant', 'The page is built.')
  ]))
  assert.equal(result.session.projectPath, '/example/project')
  assert.deepEqual(result.messages.map(message => [message.id, message.role, message.text]), [['m5', 'user', 'Build the page.'], ['m7', 'assistant', 'The page is built.']])
  const legacy = parseHistory('codex', jsonl([codexMessage('user', '<environment_context>Injected</environment_context>'), codexMessage('user', 'Actual request'), codexMessage('assistant', 'Actual reply')]))
  assert.deepEqual(legacy.messages.map(message => message.text), ['Actual request', 'Actual reply'])
})

test('inventory is bounded, includes archived sessions and states local coverage', async () => {
  const recent = path.join(fixture, 'home', '.codex', 'archived_sessions', 'archived.jsonl')
  await fs.writeFile(recent, jsonl([codexMessage('user', 'Archived request')]))
  await fs.utimes(recent, new Date('2027-01-01'), new Date('2027-01-01'))
  const collected = await collectHistory({ limit: 1 })
  assert.equal(collected.histories.length, 1)
  assert.equal(collected.histories[0].session.provider, 'codex')
  assert.equal(collected.coverage.reduce((sum, entry) => sum + entry.discovered, 0), 2)
  assert.match(collected.coverage[0].note, /Cloud conversations are not accessed/)
  assert.match(collected.limitations.join(' '), /wall-clock/)
  const scoped = await collectHistory({ projectPath: fixture, limit: 5 })
  assert.equal(scoped.histories.length, 1)
  assert.equal(scoped.histories[0].session.provider, 'claude')
  await assert.rejects(collectHistory({ limit: 501 }), /between 1 and 500/)
})

test('snapshot persists and cannot read arbitrary paths through identifiers', async () => {
  const report = await audit()
  assert.equal(report.status, 'collecting')
  assert.match(report.scope, /no cloud access/)
  assert.equal((await listAudits())[0].id, report.id)
  assert.equal((await getAudit(report.id)).original, '# Instructions\n\nBe clear.\n')
  const saved = await readAuditSession(report.id, report.sessions[0].id)
  assert.equal(saved.messages.length, 5)
  await assert.rejects(getAudit('../CLAUDE.md'), /Invalid audit ID/)
  await assert.rejects(readAuditSession(report.id, '../../CLAUDE.md'), /Invalid session ID/)
  await assert.rejects(readAuditSession(report.id, 'a'.repeat(32)), /does not belong/)
})

test('findings require exact persisted message evidence and exact original text', async () => {
  const report = await audit()
  await assert.rejects(ready(report, { evidence: [{ sessionId: report.sessions[0].id, messageId: 'm3', excerpt: 'Invented complaint' }] }), /exactly quote/)
  await assert.rejects(ready(report, { evidence: [] }), /requires evidence/)
  await assert.rejects(ready(report, { proposal: { before: 'Missing text', after: 'New rule', rationale: 'Reason' } }), /not found/)
  const submitted = await ready(report)
  assert.equal(submitted.status, 'ready')
  assert.equal(submitted.findings.length, 1)
})

test('observations enforce roles and order and derive timing without trusting supplied metrics', async () => {
  const report = await audit()
  const observation = { sessionId: report.sessions[0].id, requestMessageId: 'm1', completionMessageId: 'm4', validationMessageId: 'm5', correctionMessageIds: ['m3'], outcome: 'validated', responseTurns: 500, elapsedMs: 1, validatedElapsedMs: 2 }
  const submitted = await submitAudit(report.id, { findings: [], observations: [observation], limitations: [] })
  assert.equal(submitted.observations[0].responseTurns, 2)
  assert.equal(submitted.observations[0].elapsedMs, 180_000)
  assert.equal(submitted.observations[0].validatedElapsedMs, 240_000)
  for (const invalid of [
    { requestMessageId: 'm2' }, { completionMessageId: 'm3' }, { validationMessageId: 'm3' },
    { correctionMessageIds: ['m2'] }, { correctionMessageIds: ['m1'] }, { correctionMessageIds: ['m5'] },
    { validationMessageId: undefined }, { outcome: 'declared' }
  ]) await assert.rejects(submitAudit(report.id, { findings: [], observations: [{ ...observation, ...invalid }], limitations: [] }))
})

test('missing or non-monotonic timestamps never produce invented elapsed durations', async () => {
  const source = path.join(fixture, 'home', '.claude', 'projects', 'project', 'sample.jsonl')
  await fs.writeFile(source, jsonl([claudeMessage('user', 'Please do this.', '2026-10-15T10:04:00Z'), claudeMessage('assistant', 'Done.', '2026-10-15T10:00:00Z'), claudeMessage('user', 'Validated.')]))
  const report = await audit()
  const result = await submitAudit(report.id, { findings: [], observations: [{ sessionId: report.sessions[0].id, requestMessageId: 'm1', completionMessageId: 'm2', validationMessageId: 'm3', correctionMessageIds: [], outcome: 'validated', elapsedMs: 10 }], limitations: [] })
  assert.equal(result.observations[0].responseTurns, 1)
  assert.equal(result.observations[0].elapsedMs, undefined)
  assert.equal(result.observations[0].validatedElapsedMs, undefined)
})

test('preview applies independent exact edits and detects ambiguity, overlap and duplicates', () => {
  const proposals = [
    { id: 'a', proposal: { before: 'alpha beta', after: 'one' } },
    { id: 'b', proposal: { before: 'beta gamma', after: 'two' } },
    { id: 'c', proposal: { before: '', after: 'extra' } }
  ]
  const conflict = previewAudit('alpha beta gamma', proposals, [{ findingId: 'a', after: 'one' }, { findingId: 'b', after: 'two' }])
  assert.equal(conflict.content, 'alpha beta gamma')
  assert.equal(conflict.conflicts.length, 2)
  const preview = previewAudit('alpha beta gamma', proposals, [{ findingId: 'a', after: 'edited' }, { findingId: 'c', after: 'extra' }])
  assert.equal(preview.content, 'edited gamma\n\nextra')
  assert.equal(preview.conflicts.length, 0)
  assert.equal(previewAudit('alpha beta alpha beta', proposals, [{ findingId: 'a', after: 'one' }]).conflicts.length, 1)
  assert.equal(previewAudit('alpha beta', proposals, [{ findingId: 'a', after: 'one' }, { findingId: 'a', after: 'two' }]).conflicts.length, 1)
})

test('apply preserves original in backup, persists edited decisions and rejects duplicate apply', async () => {
  const report = await ready(await audit())
  const decisions = [{ findingId: 'browser-check', after: 'Always check the changed form in the browser.' }]
  const applied = await applyAudit(report.id, decisions)
  assert.equal(applied.status, 'applied')
  assert.equal(await fs.readFile(targetPath, 'utf8'), '# Instructions\n\nAlways check the changed form in the browser.\n')
  assert.equal(await fs.readFile(applied.backupPath, 'utf8'), report.original)
  assert.deepEqual(applied.appliedDecisions, decisions)
  assert.equal(applied.findings[0].proposal.after, 'Verify UI changes in a browser.')
  assert.deepEqual((await getAudit(report.id)).appliedDecisions, decisions)
  await assert.rejects(applyAudit(report.id, decisions), /already been applied/)
})

test('stale or removed targets are never overwritten', async () => {
  const report = await ready(await audit())
  await fs.writeFile(targetPath, 'Manual change')
  await assert.rejects(applyAudit(report.id, [{ findingId: 'browser-check', after: 'New rule' }]), /changed since/)
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'Manual change')
  await fs.unlink(targetPath)
  await assert.rejects(applyAudit(report.id, [{ findingId: 'browser-check', after: 'New rule' }]), /changed since/)
})

test('creates an absent target, but detects an intervening empty file', async () => {
  await fs.unlink(targetPath)
  const report = await ready(await audit(), { proposal: { before: '', after: '# New instructions', rationale: 'Start personal instructions.' } })
  await fs.writeFile(targetPath, '')
  await assert.rejects(applyAudit(report.id, [{ findingId: 'browser-check', after: '# Edited instructions' }]), /changed since/)
  await fs.unlink(targetPath)
  const applied = await applyAudit(report.id, [{ findingId: 'browser-check', after: '# Edited instructions' }])
  assert.equal(applied.backupPath, undefined)
  assert.equal(await fs.readFile(targetPath, 'utf8'), '# Edited instructions')
})

test('generated SpecDrive targets, symlinks and unexpected filenames are protected', async () => {
  const report = await ready(await audit())
  await fs.writeFile(targetPath, '<!-- Generated by SpecDrive — edit via SpecDrive, not here. Your changes will be overwritten. -->\n')
  await assert.rejects(audit(), /generated by SpecDrive/)
  await assert.rejects(applyAudit(report.id, [{ findingId: 'browser-check', after: 'New rule' }]), /generated by SpecDrive/)
  await fs.unlink(targetPath)
  const other = path.join(fixture, 'other.md')
  await fs.writeFile(other, 'Protected')
  await fs.symlink(other, targetPath)
  await assert.rejects(audit(), /symbolic links/)
  await assert.rejects(startAudit({ targetPath: other }), /named CLAUDE.md or AGENTS.md/)
  assert.equal(await fs.readFile(other, 'utf8'), 'Protected')
})

test('symlinked history files and directories are excluded from inventory', async () => {
  const outside = path.join(fixture, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'secret.jsonl'), jsonl([claudeMessage('user', 'Do not collect this symlinked data')]))
  const root = path.join(fixture, 'home', '.claude', 'projects')
  await fs.symlink(outside, path.join(root, 'linked-directory'))
  await fs.symlink(path.join(outside, 'secret.jsonl'), path.join(root, 'linked-file.jsonl'))
  const collected = await collectHistory({ providers: ['claude'] })
  assert.equal(collected.histories.length, 1)
  assert.equal(collected.coverage[0].discovered, 1)
})

test('mixed Codex histories preserve older response-only portions', () => {
  const result = parseHistory('codex', jsonl([
    codexMessage('user', 'Continue.', '2026-10-15T09:00:00Z'),
    codexMessage('assistant', 'First change done.', '2026-10-15T09:01:00Z'),
    codexMessage('user', 'Continue.', '2026-10-15T10:00:00Z'),
    { type: 'event_msg', timestamp: '2026-10-15T10:00:00Z', payload: { type: 'user_message', message: 'Continue.' } },
    { type: 'event_msg', timestamp: '2026-10-15T10:01:00Z', payload: { type: 'agent_message', message: 'Second change done.' } },
    codexMessage('assistant', 'Second change done.', '2026-10-15T10:01:00Z')
  ]))
  assert.deepEqual(result.messages.map(message => message.text), ['Continue.', 'First change done.', 'Continue.', 'Second change done.'])
})

test('reports a neighboring Codex override without changing the selected target', async () => {
  const agentsTarget = path.join(fixture, 'AGENTS.md')
  await fs.writeFile(agentsTarget, '# Personal rules')
  await fs.writeFile(path.join(fixture, 'AGENTS.override.md'), '# Override rules')
  const report = await startAudit({ targetPath: agentsTarget, providers: ['claude'] })
  assert.equal(report.targetPath, agentsTarget)
  assert.match(report.limitations.join(' '), /AGENTS.override.md.*takes precedence/)
})

test('old approvals cannot apply resubmitted proposals even when finding IDs are reused', async () => {
  const reviewed = await ready(await audit())
  const replacement = await ready(reviewed, { proposal: { before: '# Instructions', after: '# Different anchor', rationale: 'Updated proposal' } })
  assert.notEqual(reviewed.updatedAt, replacement.updatedAt)
  await assert.rejects(applyAudit(reviewed.id, [{ findingId: 'browser-check', after: 'Previously approved edit' }], reviewed.updatedAt), /proposals changed since you reviewed/)
  assert.equal(await fs.readFile(targetPath, 'utf8'), reviewed.original)
  const applied = await applyAudit(replacement.id, [{ findingId: 'browser-check', after: '# Reviewed latest proposal' }], replacement.updatedAt)
  assert.equal(applied.status, 'applied')
  assert.match(await fs.readFile(targetPath, 'utf8'), /^# Reviewed latest proposal/)
})

test('an existing backup is preserved and the apply failure explains retry requirements', async () => {
  const report = await ready(await audit())
  const backupPath = `${targetPath}.specdrive-${report.id}.bak`
  await fs.writeFile(backupPath, 'Earlier preserved backup')
  await assert.rejects(applyAudit(report.id, [{ findingId: 'browser-check', after: 'New rule' }], report.updatedAt), /backup already exists.*start a new audit/)
  assert.equal(await fs.readFile(backupPath, 'utf8'), 'Earlier preserved backup')
  assert.equal(await fs.readFile(targetPath, 'utf8'), report.original)
  assert.equal((await getAudit(report.id)).status, 'ready')
})
