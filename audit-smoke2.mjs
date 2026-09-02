// Throwaway audit smoke test #2 — the rework loop (stale / failed / done gate).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['/Users/0104389S/Projects/specdrive/mcp/server.mjs']
})
const client = new Client({ name: 'audit-smoke2', version: '1.0.0' }, { capabilities: {} })
await client.connect(transport)

const call = async (tool, args) => {
  try {
    const r = await client.callTool({ name: tool, arguments: args })
    return { ok: !r.isError, text: (r.content ?? []).map((c) => c.text).join('\n'), structured: r.structuredContent }
  } catch (e) {
    return { ok: false, threw: true, text: String(e?.message ?? e) }
  }
}
const log = (l, r) => console.log(`\n### ${l}\n  ok=${r.ok}${r.threw ? ' THREW' : ''}\n  ${String(r.text).slice(0, 500).replace(/\n/g, '\n  ')}`)

const NAME = 'Audit Rework Zzz'
let r = await call('create_project', { name: NAME, one_liner: 'Throwaway rework-loop audit.', idea: 'audit' })
const pid = /id: ([a-z0-9-]+)/.exec(r.text)?.[1]
console.log('PROJECT ID:', pid)

await call('add_spec', { project: pid, category: 'features', title: 'S1', content: 'x' })
await call('add_scenario', { project: pid, title: 'Sc', actor: 'a', steps: [{ action: 'a' }, { action: 'b' }] })
for (const ph of ['challenge', 'research', 'risks', 'plan']) await call('set_phase', { project: pid, phase: ph })

// three tasks, A and B share a "touch" so B completing will stale A
await call('add_task', { project: pid, title: 'Task A', detail: 'a' })
await call('add_task', { project: pid, title: 'Task B', detail: 'b' })
await call('add_task', { project: pid, title: 'Run the tests', detail: 't', kind: 'test' })
await call('add_task', { project: pid, title: 'Security & privacy pass', detail: 's', kind: 'security' })
await call('set_phase', { project: pid, phase: 'build' })

const gp = await call('get_project', { project: pid })
const T = Object.fromEntries((gp.structured?.tasks ?? []).map((t) => [t.title, t.id]))
console.log('TASKS:', JSON.stringify(T))

const doTask = async (title, touches) => {
  await call('update_task', { project: pid, task_id: T[title], status: 'in_progress' })
  return call('update_task', { project: pid, task_id: T[title], status: 'done', note: `${title} works`, proof: 'ran it, saw it', touches })
}
log('A done (touches auth.ts)', await doTask('Task A', ['src/auth.ts']))
log('B done (touches auth.ts -> should stale A)', await doTask('Task B', ['src/auth.ts']))

log('get_next_task #1 (expect RE-CHECK)', await call('get_next_task', { project: pid }))
log('get_next_task #2', await call('get_next_task', { project: pid }))
log('get_next_task #3', await call('get_next_task', { project: pid }))
log('get_next_task #4 (circuit breaker? or still re-check forever)', await call('get_next_task', { project: pid }))
log('get_next_task #5', await call('get_next_task', { project: pid }))

// Can the agent ignore the stale flag and just work the remaining real tasks?
console.log('\n>>> stale task blocks the queue; remaining real tasks are never served.')

log('recheck holds', await call('recheck_task', { project: pid, task_id: T['Task A'], outcome: 'holds', proof: 're-ran it' }))
log('get_next_task after recheck', await call('get_next_task', { project: pid }))

// finish everything, then try to close
for (const t of ['Run the tests', 'Security & privacy pass']) await doTask(t, [])
log('set_phase done (no convergence stamp possible)', await call('set_phase', { project: pid, phase: 'done' }))

// failed-task starvation: fail the remaining work and see what get_next_task offers
console.log('\nCLEANUP: ~/.specdrive/projects/' + pid)
await client.close()
process.exit(0)
