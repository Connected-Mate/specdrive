import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { agentAuditPrompt } from '../src/shared/agent-audit-prompt.mjs'

test('agent audit flows over MCP with evidence, pagination and no file-write capability', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'specdrive-audit-mcp-'))
  const history = path.join(sandbox, 'history')
  const target = path.join(sandbox, 'CLAUDE.md')
  const sessionDir = path.join(history, '.claude', 'projects', '-work-demo')
  await fs.mkdir(sessionDir, { recursive: true })
  await fs.writeFile(target, '# My agent\n\nKeep answers clear.\n')
  const rows = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-01T10:00:00Z', cwd: '/work/demo', message: { role: 'user', content: 'Build the button and verify it.' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-10-01T10:01:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'The button is ready.' }] } },
    { type: 'user', uuid: 'u2', timestamp: '2026-10-01T10:02:00Z', message: { role: 'user', content: 'You forgot to run the tests.' } },
    { type: 'assistant', uuid: 'a2', timestamp: '2026-10-01T10:03:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'I ran the button tests and they pass.' }] } },
    { type: 'user', uuid: 'u3', timestamp: '2026-10-01T10:04:00Z', message: { role: 'user', content: 'Great, I confirm this works.' } }
  ]
  await fs.writeFile(path.join(sessionDir, 'conversation.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'))
  const client = new Client({ name: 'agent-studio-integration', version: '1' })
  const transport = new StdioClientTransport({
    command: process.execPath, args: [path.resolve('mcp/server.mjs')],
    env: { ...process.env, SPECDRIVE_DATA_DIR: path.join(sandbox, 'data'), SPECDRIVE_HISTORY_HOME: history }
  })
  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args })
    const text = res.content?.find((item) => item.type === 'text')?.text
    assert.equal(Boolean(res.isError), false, text)
    return JSON.parse(text)
  }
  try {
    await client.connect(transport)
    const tools = (await client.listTools()).tools.map((t) => t.name)
    assert.ok(tools.includes('start_agent_audit'))
    assert.ok(!tools.includes('apply_agent_audit'))
    const started = await call('start_agent_audit', { target_path: target, providers: ['claude'], limit: 10 })
    const auditId = started.audit_id
    assert.equal(started.report.status, 'collecting')
    assert.equal(started.report.sessions.length, 1)
    const sessionId = started.report.sessions[0].id
    const messages = []
    let offset = 0
    do {
      const page = await call('read_agent_audit_session', { audit_id: auditId, session_id: sessionId, offset, limit: 2 })
      messages.push(...page.messages)
      offset = page.next_offset
    } while (offset !== null)
    assert.equal(messages.length, 5)
    const report = await call('submit_agent_audit', {
      audit_id: auditId,
      findings: [{ id: 'test-evidence', title: 'Verify the result', category: 'workflow', confidence: 'low', summary: 'One correction asking for tests.', evidence: [{ sessionId, messageId: messages[2].id, excerpt: 'You forgot to run the tests.' }], proposal: { before: '', after: 'Run relevant tests before reporting completion.', rationale: 'The owner requested verification.' } }],
      observations: [{ sessionId, requestMessageId: messages[0].id, completionMessageId: messages[3].id, validationMessageId: messages[4].id, correctionMessageIds: [messages[2].id], outcome: 'validated' }],
      limitations: ['One local conversation, not a model benchmark.']
    })
    assert.equal(report.status, 'ready')
    assert.equal(report.observations[0].elapsedMs, 180000)
    assert.equal(report.observations[0].validatedElapsedMs, 240000)
    assert.equal(await fs.readFile(target, 'utf8'), '# My agent\n\nKeep answers clear.\n')
    assert.equal((await call('get_agent_audit', { audit_id: auditId })).findings.length, 1)
    const bad = await client.callTool({ name: 'read_agent_audit_session', arguments: { audit_id: auditId, session_id: '../../outside' } })
    assert.ok(bad.isError)
    const prompt = await client.getPrompt({ name: 'specdrive_agent_audit', arguments: { target_path: target } })
    assert.match(prompt.messages[0].content.text, /submit_agent_audit/)
  } finally {
    await client.close()
    await fs.rm(sandbox, { recursive: true, force: true })
  }
})

test('starter prompt treats file paths as data and describes source and timing limits', () => {
  const prompt = agentAuditPrompt('/tmp/my folder/CLAUDE.md', { nodeBin: '/opt/node', serverPath: '/tmp/SpecDrive/mcp/server.mjs' })
  assert.match(prompt, /"command": "\/opt\/node"/)
  assert.match(prompt, /pauses humaines incluses/)
  assert.match(prompt, /cette version ne les importe pas/)
  assert.match(prompt, /Ne modifie pas toi-même/)
})
