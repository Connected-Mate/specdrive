// Throwaway audit smoke test — drives the real MCP server over stdio.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['/Users/0104389S/Projects/specdrive/mcp/server.mjs']
})
const client = new Client({ name: 'audit-smoke', version: '1.0.0' }, { capabilities: {} })
await client.connect(transport)

const NAME = 'Audit Smoke Zzz'
const call = async (tool, args) => {
  try {
    const r = await client.callTool({ name: tool, arguments: args })
    const text = (r.content ?? []).map((c) => c.text).join('\n')
    return { ok: !r.isError, text, structured: r.structuredContent }
  } catch (e) {
    return { ok: false, threw: true, text: String(e?.message ?? e) }
  }
}

const log = (label, r) =>
  console.log(`\n### ${label}\n  ok=${r.ok}${r.threw ? ' THREW' : ''}\n  ${String(r.text).slice(0, 400).replace(/\n/g, '\n  ')}`)

let r = await call('create_project', {
  name: NAME,
  one_liner: 'A throwaway project used only to audit the server.',
  idea: 'audit'
})
log('create_project', r)
const pid = /id: ([a-z0-9-]+)/.exec(r.text)?.[1] ?? NAME
console.log('PROJECT ID:', pid)

log('add_spec', await call('add_spec', { project: pid, category: 'features', title: 'Reserve a loaf', content: 'When a neighbor taps Reserve, the count goes down.', acceptance: 'Given a loaf, when tapped, then count drops' }))
log('add_scenario', await call('add_scenario', { project: pid, title: 'Happy path', actor: 'A neighbor', steps: [{ action: 'opens page' }, { action: 'taps Reserve', expect: 'count drops' }] }))

// walk phases to build
for (const ph of ['challenge', 'research', 'risks', 'plan']) {
  log(`set_phase ${ph}`, await call('set_phase', { project: pid, phase: ph }))
}
log('add_task feature', await call('add_task', { project: pid, title: 'Build reserve button', detail: 'done = button works' }))
log('add_task test', await call('add_task', { project: pid, title: 'Write the tests', detail: 'done = tests pass', kind: 'test' }))
log('add_task security', await call('add_task', { project: pid, title: 'Security & privacy pass', detail: 'done = no secrets', kind: 'security' }))
log('set_phase build', await call('set_phase', { project: pid, phase: 'build' }))

// >>> THE MAIN EVENT: does check_convergence survive?
log('check_convergence (CLEAN board)', await call('check_convergence', { project: pid }))

// Now make a task fail, then re-check convergence
const gp = await call('get_project', { project: pid })
const tasks = gp.structured?.tasks ?? []
const t1 = tasks.find((t) => t.title === 'Build reserve button')
console.log('\nTASK IDS:', tasks.map((t) => `${t.id}=${t.title}`).join(' | '))

log('update_task -> in_progress', await call('update_task', { project: pid, task_id: t1.id, status: 'in_progress' }))
log('update_task -> failed', await call('update_task', { project: pid, task_id: t1.id, status: 'failed', note: 'ReferenceError somewhere', next_move: 'retry_changed' }))
log('check_convergence (with a FAILED task)', await call('check_convergence', { project: pid }))

// partial-mutation-on-error probe: reject the call but persist depends_on?
const t2 = tasks.find((t) => t.title === 'Write the tests')
log('update_task done-without-proof + depends_on (must reject)', await call('update_task', { project: pid, task_id: t2.id, status: 'done', note: 'n', depends_on: [t1.id] }))
const gp2 = await call('get_project', { project: pid })
const t2after = (gp2.structured?.tasks ?? []).find((t) => t.id === t2.id)
console.log('\n>>> after a REJECTED call, did depends_on persist?', JSON.stringify(t2after?.dependsOn))

// get_next_task with a failed task present
log('get_next_task', await call('get_next_task', { project: pid }))

console.log('\nCLEANUP DIR: ~/.specdrive/projects/' + pid)
await client.close()
process.exit(0)
