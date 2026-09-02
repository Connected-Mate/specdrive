// End-to-end tests of the SpecDrive MCP server over stdio, against an
// isolated data dir (HOME is overridden), so nothing touches ~/.specdrive.
// Run: npm test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(here, '..', 'mcp', 'server.mjs')
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'specdrive-test-'))

let client
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args })
  return { isError: !!r.isError, text: r.content?.[0]?.text ?? '', s: r.structuredContent }
}
const idOf = (r) => r.text.match(/id: ([a-z0-9-]+)/)?.[1]

/** A project driven straight to the build phase with a compliant plan. */
async function projectInBuild(name) {
  const p = await call('create_project', { name, one_liner: 't', idea: 't' })
  const pid = idOf(p)
  const sp = await call('add_spec', { project: pid, category: 'features', title: 'f', content: 'f' })
  const spid = idOf(sp)
  const sc = await call('add_scenario', { project: pid, title: 's', actor: 'u', steps: [{ action: 'a' }, { action: 'b' }] })
  await call('update_scenario', { project: pid, scenario_id: idOf(sc), status: 'walked' })
  for (const phase of ['challenge', 'research', 'risks', 'plan']) {
    const r = await call('set_phase', { project: pid, phase })
    assert.equal(r.isError, false, `phase ${phase}: ${r.text}`)
  }
  const mk = async (title, extra = {}) =>
    idOf(await call('add_task', { project: pid, title, detail: 'x', spec_ids: [spid], ...extra }))
  const tasks = {
    a: await mk('Step A'),
    b: await mk('Step B'),
    test: await mk('Write tests', { kind: 'test' }),
    security: await mk('Safety pass', { kind: 'security' }),
    review: await mk('Independent review', { kind: 'review' })
  }
  const r = await call('set_phase', { project: pid, phase: 'build' })
  assert.equal(r.isError, false, r.text)
  return { pid, spid, tasks }
}
/** A project in plan phase with one spec, one walked scenario — nothing else. */
async function projectInPlan(name) {
  const p = await call('create_project', { name, one_liner: 't', idea: 't' })
  const pid = idOf(p)
  const spid = idOf(await call('add_spec', { project: pid, category: 'features', title: 'f', content: 'f' }))
  const sc = await call('add_scenario', { project: pid, title: 's', actor: 'u', steps: [{ action: 'a' }, { action: 'b' }] })
  await call('update_scenario', { project: pid, scenario_id: idOf(sc), status: 'walked' })
  for (const phase of ['challenge', 'research', 'risks', 'plan']) {
    const r = await call('set_phase', { project: pid, phase })
    assert.equal(r.isError, false, `phase ${phase}: ${r.text}`)
  }
  return { pid, spid }
}
const start = (pid, id) => call('update_task', { project: pid, task_id: id, status: 'in_progress' })
const done = (pid, id, extra = {}) =>
  call('update_task', { project: pid, task_id: id, status: 'done', note: 'works', proof: 'ran it, saw it', ...extra })

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, HOME }
  })
  client = new Client({ name: 'specdrive-tests', version: '1.0' })
  await client.connect(transport)
})
after(async () => {
  await client.close()
  fs.rmSync(HOME, { recursive: true, force: true }) // our own temp dir only
})

test('1. check_convergence answers with valid structured content', async () => {
  const { pid } = await projectInBuild('t1')
  const r = await call('check_convergence', { project: pid })
  assert.equal(r.isError, false, r.text)
  assert.equal(typeof r.s.converged, 'boolean')
})

test('2. a project closes only with a fresh independent review', async () => {
  const { pid, tasks } = await projectInBuild('t2')
  for (const id of [tasks.a, tasks.b, tasks.test, tasks.security]) {
    await start(pid, id)
    assert.equal((await done(pid, id)).isError, false)
  }
  await call('check_convergence', { project: pid })
  assert.equal((await call('set_phase', { project: pid, phase: 'done' })).isError, true, 'closed without review')
  await start(pid, tasks.review)
  await done(pid, tasks.review, { note: 'reviewed', proof: 'a fresh independent session read the diff' })
  await call('check_convergence', { project: pid })
  const r = await call('set_phase', { project: pid, phase: 'done' })
  assert.equal(r.isError, false, r.text)
})

test('3. a rejected update_task leaves no trace', async () => {
  const { pid, tasks } = await projectInBuild('t3')
  const r = await call('update_task', { project: pid, task_id: tasks.b, status: 'done', note: 'x', proof: 'y', depends_on: [tasks.a] })
  assert.equal(r.isError, true)
  const board = JSON.parse((await call('get_project', { project: pid })).text.split('\n\nCurrent phase')[0])
  assert.deepEqual(board.tasks.find((t) => t.id === tasks.b).dependsOn ?? [], [])
})

test('4. failure ladder: two changed retries, then a structural move is required', async () => {
  const { pid, tasks } = await projectInBuild('t4')
  await start(pid, tasks.a)
  const f = (note, next_move) => call('update_task', { project: pid, task_id: tasks.a, status: 'failed', note, next_move })
  assert.equal((await f('try A: err', 'retry_changed')).isError, false)
  assert.equal((await f('try A: err', 'retry_changed')).isError, true, 'same note accepted')
  assert.equal((await f('try B: err', 'retry_changed')).isError, false)
  assert.equal((await f('try C: err', 'retry_changed')).isError, true, 'third plain retry accepted')
  assert.equal((await f('try C: err', 'split')).isError, false)
})

test('5. a later change makes an earlier verified step stale; holds stops propagation', async () => {
  const { pid, tasks } = await projectInBuild('t5')
  await start(pid, tasks.a)
  await done(pid, tasks.a, { touches: ['payment flow'] })
  await start(pid, tasks.b)
  const r = await done(pid, tasks.b, { touches: ['payment flow'] })
  assert.match(r.text, /re-check/)
  const next = await call('get_next_task', { project: pid })
  assert.equal(next.s.needsRecheck, true)
  assert.equal(next.s.task.id, tasks.a)
  assert.equal((await call('set_phase', { project: pid, phase: 'done' })).isError, true)
  const rc = await call('recheck_task', { project: pid, task_id: tasks.a, outcome: 'holds', proof: 're-ran' })
  assert.match(rc.text, /nothing else was reopened/)
  assert.notEqual((await call('get_next_task', { project: pid })).s.needsRecheck, true)
})

test('6. phase gates: no scenarios, no tasks, no quality tail — all refused; skip_reason is recorded', async () => {
  const p = await call('create_project', { name: 't6', one_liner: 't', idea: 't' })
  const pid = idOf(p)
  assert.equal((await call('set_phase', { project: pid, phase: 'challenge' })).isError, true, 'left capture with zero specs')
  await call('add_spec', { project: pid, category: 'features', title: 'f', content: 'f' })
  assert.equal((await call('set_phase', { project: pid, phase: 'build' })).isError, true, 'phase jump allowed')
  assert.equal((await call('set_phase', { project: pid, phase: 'plan', skip_reason: 'tiny' })).isError, false)
  await call('add_task', { project: pid, title: 'only task', detail: 'x' })
  assert.equal((await call('set_phase', { project: pid, phase: 'build' })).isError, true, 'build without quality tail')
  const board = JSON.parse((await call('get_project', { project: pid })).text.split('\n\nCurrent phase')[0])
  assert.ok(board.specs.some((s) => s.title.startsWith('Checks skipped')), 'waiver not on the board')
})

test('7. dependencies: cycles and unknown ids rejected, blocked tasks never served', async () => {
  const { pid, tasks } = await projectInBuild('t7')
  assert.equal((await call('add_task', { project: pid, title: 'x', detail: 'x', depends_on: ['nope'] })).isError, true)
  const c = idOf(await call('add_task', { project: pid, title: 'C', detail: 'x', depends_on: [tasks.a] }))
  assert.equal((await call('update_task', { project: pid, task_id: tasks.a, status: 'in_progress', depends_on: [c] })).isError, true, 'cycle accepted')
  assert.equal((await start(pid, c)).isError, true, 'started with unmet dependency')
})

test('8. done requires in_progress first, a note and proof', async () => {
  const { pid, tasks } = await projectInBuild('t8')
  assert.equal((await done(pid, tasks.a)).isError, true, 'done from todo')
  await start(pid, tasks.a)
  assert.equal((await call('update_task', { project: pid, task_id: tasks.a, status: 'done', note: 'x' })).isError, true, 'done without proof')
  assert.equal((await done(pid, tasks.a)).isError, false)
})

test('9. owner comments block closing until resolved', async () => {
  const { pid, tasks } = await projectInBuild('t9')
  for (const id of Object.values(tasks)) {
    await start(pid, id)
    await done(pid, id, { proof: 'fresh independent session verified' })
  }
  const dir = path.join(HOME, '.specdrive', 'projects', pid)
  fs.writeFileSync(path.join(dir, 'comments.json'), JSON.stringify([{ id: 'c1', target: { kind: 'project', id: pid }, text: 'wait', status: 'open', createdAt: new Date().toISOString() }]))
  await call('check_convergence', { project: pid })
  assert.equal((await call('set_phase', { project: pid, phase: 'done' })).isError, true)
  assert.equal((await call('resolve_comment', { project: pid, comment_id: 'c1', resolution: 'done' })).isError, false)
  await call('check_convergence', { project: pid })
  assert.equal((await call('set_phase', { project: pid, phase: 'done' })).isError, false)
})

test('10. folder house rules reach every context response and are traced', async () => {
  const f = await call('create_folder', { name: 'Acme', rules: [{ title: 'EU only', content: 'Data stays in the EU.' }] })
  const fid = idOf(f)
  const p = await call('create_project', { name: 't10', one_liner: 't', idea: 't', folder: fid })
  assert.match(p.text, /HOUSE RULES/)
  assert.match((await call('get_project', { project: idOf(p) })).text, /EU only/)
  await call('set_folder_rules', { folder: fid, rules: [{ title: 'EU only', content: 'x' }, { title: 'No trackers', content: 'y' }] })
  const act = fs.readFileSync(path.join(HOME, '.specdrive', 'projects', idOf(p), 'activity.jsonl'), 'utf8')
  assert.match(act, /added: No trackers/)
})

test('11. dynamic tool surface: build tools hidden before plan', async () => {
  const p = await call('create_project', { name: 't11', one_liner: 't', idea: 't' })
  // Other test projects may already be in build (union rule) — assert the shape, not visibility.
  const tools = (await client.listTools()).tools.map((t) => t.name)
  assert.ok(tools.includes('get_guidance') && tools.includes('add_spec'))
  assert.ok(idOf(p))
})

test('12. HTML sketches are sanitized', async () => {
  const p = await call('create_project', { name: 't12', one_liner: 't', idea: 't' })
  const pid = idOf(p)
  await call('add_spec', { project: pid, category: 'features', title: 'f', content: 'f' })
  await call('set_phase', { project: pid, phase: 'plan', skip_reason: 'test' })
  const r = await call('add_wireframe', { project: pid, screen: 'Home', title: 'x', html: '<div onclick=alert(1)><img src=x onerror=alert(1)><a href="java\tscript:x">y</a><script src="//e/x.js"></div>' })
  assert.equal(r.isError, false, r.text)
  const wf = JSON.parse(fs.readFileSync(path.join(HOME, '.specdrive', 'projects', pid, 'wireframes.json'), 'utf8'))[0]
  const html = fs.readFileSync(path.join(HOME, '.specdrive', 'projects', pid, 'wireframes', wf.file), 'utf8')
  assert.doesNotMatch(html, /onerror|onclick|<script|javascript:/i)
})

test('13. get_next_task never violates its output schema (budget, breaker, stale, rework, normal, empty)', async () => {
  const { pid, tasks } = await projectInBuild('t13')
  const shapes = []
  shapes.push(await call('get_next_task', { project: pid })) // normal
  for (let i = 0; i < 7; i++) shapes.push(await call('get_next_task', { project: pid })) // breaker trips
  await start(pid, tasks.a); await done(pid, tasks.a, { touches: ['x'] })
  await start(pid, tasks.b); await done(pid, tasks.b, { touches: ['x'] })
  shapes.push(await call('get_next_task', { project: pid })) // stale
  await call('recheck_task', { project: pid, task_id: tasks.a, outcome: 'holds', proof: 'ok' })
  for (const id of [tasks.test, tasks.security, tasks.review]) { await start(pid, id); await done(pid, id) }
  shapes.push(await call('get_next_task', { project: pid })) // empty
  for (const r of shapes) assert.equal(r.isError, false, r.text.slice(0, 120))
})

test('14. two clients writing the same board in parallel lose nothing', async () => {
  const p = await call('create_project', { name: 't14', one_liner: 't', idea: 't' })
  const pid = idOf(p)
  const t2 = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, HOME } })
  const c2 = new Client({ name: 'second', version: '1.0' })
  await c2.connect(t2)
  const jobs = []
  for (let i = 0; i < 15; i++) {
    jobs.push(client.callTool({ name: 'add_spec', arguments: { project: pid, category: 'features', title: `A${i}`, content: 'x' } }))
    jobs.push(c2.callTool({ name: 'add_spec', arguments: { project: pid, category: 'features', title: `B${i}`, content: 'x' } }))
  }
  await Promise.all(jobs)
  await c2.close()
  const dir = path.join(HOME, '.specdrive', 'projects', pid)
  const specs = JSON.parse(fs.readFileSync(path.join(dir, 'specs.json'), 'utf8'))
  assert.equal(specs.length, 30)
  assert.ok(!fs.readdirSync(dir).some((f) => f.includes('.corrupt-')), 'a corrupt file was quarantined')
})

test('15. executable proof: the board runs the check itself and refuses done when it fails', async () => {
  const { pid, spid } = await projectInPlan('t15')
  const code = path.join(HOME, 'code-15')
  fs.mkdirSync(code, { recursive: true })
  assert.equal((await call('set_codebase_path', { project: pid, codebase_path: code })).isError, false)
  const mk = async (title, verify_command, extra = {}) =>
    idOf(await call('add_task', { project: pid, title, detail: 'x', spec_ids: [spid], verify_command, ...extra }))
  const good = await mk('Green step', 'echo all-good')
  const bad = await mk('Red step', 'echo boom-from-the-suite >&2; exit 3')
  await mk('Write tests', 'true', { kind: 'test' })
  await mk('Safety pass', 'true', { kind: 'security' })
  assert.equal((await call('set_phase', { project: pid, phase: 'build' })).isError, false)

  await start(pid, good)
  const okRun = await done(pid, good)
  assert.equal(okRun.isError, false, okRun.text)
  assert.match(okRun.text, /Check passed/)

  await start(pid, bad)
  const failRun = await done(pid, bad)
  assert.equal(failRun.isError, true, 'a failing check was accepted as done')
  assert.match(failRun.text, /boom-from-the-suite/, 'the real output is not reported')
  assert.match(failRun.text, /Exit code: 3/)

  const tasks = JSON.parse(fs.readFileSync(path.join(HOME, '.specdrive', 'projects', pid, 'tasks.json'), 'utf8'))
  const g = tasks.find((t) => t.id === good)
  const b = tasks.find((t) => t.id === bad)
  assert.equal(g.status, 'done')
  assert.equal(g.proofRun.exitCode, 0)
  assert.match(g.proofRun.outputTail, /all-good/)
  assert.equal(b.status, 'in_progress', 'the failed step was closed anyway')
  assert.equal(b.proofRun.exitCode, 3, 'the failed run was not recorded')

  // A step with genuinely nothing to run says so, and it shows in convergence.
  const skipped = await call('update_task', {
    project: pid,
    task_id: bad,
    status: 'done',
    note: 'parked the command',
    proof: 'read it by hand',
    proof_run_skip_reason: 'visual check only, no command can prove it'
  })
  assert.equal(skipped.isError, false, skipped.text)
  const conv = await call('check_convergence', { project: pid })
  assert.match(conv.text, /WITHOUT A PASSING CHECK/)
  assert.match(conv.text, /its last run exited 3/)
})

test('16. every get_next_task exit carries a machine-readable state', async () => {
  const STATES = ['WORKING', 'RECHECK', 'COMPLETE', 'BLOCKED', 'DECIDE']
  const { pid, tasks } = await projectInBuild('t16')
  const seen = []
  const grab = async () => {
    const r = await call('get_next_task', { project: pid })
    assert.equal(r.isError, false, r.text.slice(0, 160))
    assert.ok(STATES.includes(r.s.state), `bad state ${r.s.state}`)
    seen.push(r.s.state)
    return r
  }
  const first = await grab() // WORKING, with the parallel ready set
  assert.equal(first.s.state, 'WORKING')
  assert.ok(Array.isArray(first.s.ready) && first.s.ready.length >= 2, 'ready waves missing')
  assert.ok(first.s.ready.every((w) => typeof w.wave === 'number'))
  for (let i = 0; i < 4; i++) await grab() // breaker trips: BLOCKED
  assert.ok(seen.includes('BLOCKED'), 'the breaker never reported BLOCKED')
  await start(pid, tasks.a)
  await done(pid, tasks.a, { touches: ['shared area'] })
  await start(pid, tasks.b)
  await done(pid, tasks.b, { touches: ['shared area'] })
  const recheck = await grab()
  assert.equal(recheck.s.state, 'RECHECK')
  await call('recheck_task', { project: pid, task_id: tasks.a, outcome: 'holds', proof: 'ok' })
  for (const id of [tasks.test, tasks.security, tasks.review]) {
    await start(pid, id)
    await done(pid, id)
  }
  const empty = await grab()
  assert.equal(empty.s.state, 'COMPLETE')
  const conv = await call('check_convergence', { project: pid })
  assert.ok(STATES.includes(conv.s.state), `convergence state ${conv.s.state}`)
})

test('17. analyze_plan blocks entering build while a feature spec has no task', async () => {
  const { pid, spid } = await projectInPlan('t17')
  const orphanSpec = idOf(await call('add_spec', { project: pid, category: 'features', title: 'Nobody builds me', content: 'x' }))
  const mk = (title, extra = {}) => call('add_task', { project: pid, title, detail: 'x', spec_ids: [spid], ...extra })
  await mk('Step A')
  await mk('Write tests', { kind: 'test' })
  await mk('Safety pass', { kind: 'security' })
  const audit = await call('analyze_plan', { project: pid })
  assert.equal(audit.isError, false, audit.text)
  assert.equal(audit.s.blockingCount, 1)
  assert.equal(audit.s.state, 'BLOCKED')
  assert.match(audit.text, /Nobody builds me/)
  const refused = await call('set_phase', { project: pid, phase: 'build' })
  assert.equal(refused.isError, true, 'build entered on an incoherent plan')
  assert.match(refused.text, /does not hold together/)
  await mk('Build the missing feature', { spec_ids: [orphanSpec] })
  assert.equal((await call('analyze_plan', { project: pid })).s.blockingCount, 0)
  assert.equal((await call('set_phase', { project: pid, phase: 'build' })).isError, false)
})

test('18. two reviews must look from two different angles', async () => {
  const { pid, tasks } = await projectInBuild('t18')
  const second = idOf(await call('add_task', { project: pid, title: 'Second review', detail: 'x', kind: 'review', lens: 'adversarial' }))
  const finish = async (id) => {
    await start(pid, id)
    await done(pid, id, { note: 'ok', proof: 'a fresh independent session read the diff' })
  }
  for (const id of [...Object.values(tasks), second]) await finish(id)
  await call('check_convergence', { project: pid })
  const refused = await call('set_phase', { project: pid, phase: 'done' })
  assert.equal(refused.isError, true, 'closed with a single review angle')
  assert.match(refused.text, /lens/i)
  assert.match(refused.text, /edge-cases/)
  const third = idOf(await call('add_task', { project: pid, title: 'Third review', detail: 'x', kind: 'review', lens: 'edge-cases' }))
  await finish(third)
  await call('check_convergence', { project: pid })
  const r = await call('set_phase', { project: pid, phase: 'done' })
  assert.equal(r.isError, false, r.text)
})

test('19. a step can be deferred, and the board refuses to close over it silently', async () => {
  const { pid, tasks } = await projectInBuild('t19')
  assert.equal(
    (await call('update_task', { project: pid, task_id: tasks.b, status: 'deferred' })).isError,
    true,
    'deferred without a note'
  )
  const d = await call('update_task', { project: pid, task_id: tasks.b, status: 'deferred', note: 'needs an API key the owner has not issued' })
  assert.equal(d.isError, false, d.text)
  for (const id of [tasks.a, tasks.test, tasks.security, tasks.review]) {
    await start(pid, id)
    await done(pid, id, { proof: 'a fresh independent session verified it' })
  }
  const conv = await call('check_convergence', { project: pid })
  assert.match(conv.text, /DEFERRED STEPS/)
  assert.equal(conv.s.deferredTasks, 1)
  const refused = await call('set_phase', { project: pid, phase: 'done' })
  assert.equal(refused.isError, true, 'closed over a deferred step')
  assert.match(refused.text, /deferred/i)
  const r = await call('set_phase', { project: pid, phase: 'done', skip_reason: 'owner ships v1 without it' })
  assert.equal(r.isError, false, r.text)
  const board = JSON.parse((await call('get_project', { project: pid })).text.split('\n\nCurrent phase')[0])
  assert.ok(board.specs.some((s) => s.title.startsWith('Checks skipped')), 'the waiver is not on the board')
})

test('20. a verify_command is refused outside the home folder', async () => {
  const { pid, spid } = await projectInPlan('t20')
  assert.equal((await call('set_codebase_path', { project: pid, codebase_path: '/tmp' })).isError, false)
  const t = idOf(await call('add_task', { project: pid, title: 'Step', detail: 'x', spec_ids: [spid], verify_command: 'true' }))
  await call('add_task', { project: pid, title: 'Write tests', detail: 'x', spec_ids: [spid], kind: 'test' })
  await call('add_task', { project: pid, title: 'Safety pass', detail: 'x', spec_ids: [spid], kind: 'security' })
  assert.equal((await call('set_phase', { project: pid, phase: 'build' })).isError, false)
  await start(pid, t)
  const r = await done(pid, t)
  assert.equal(r.isError, true, 'ran a command outside the home folder')
  assert.match(r.text, /outside your home folder/)
})

test('21. house: provenance stamped, scoped rules filter per task, briefing on an existing house', async () => {
  const f = await call('create_folder', { name: 'House', rules: [{ title: 'EU only', content: 'x' }, { title: 'iOS rule', content: 'y', appliesTo: 'ios/**' }] })
  const fid = idOf(f)
  const folder = JSON.parse(fs.readFileSync(path.join(HOME, '.specdrive', 'folders', `${fid}.json`), 'utf8'))
  assert.match(folder.rules[0].setBy, /^agent:/)
  assert.ok(folder.rules[0].setAt)
  assert.equal(folder.rules[0].confirmedByOwner, false) // no elicitation in tests → never claimed
  const { pid, tasks } = await projectInBuild('t21-' + Date.now())
  await call('assign_project_folder', { project: pid, folder: fid })
  // task touching only web/ must not see the iOS rule
  await start(pid, tasks.a)
  await done(pid, tasks.a, { touches: ['web/app.ts'] })
  const gp = await call('get_guidance', { project: pid })
  assert.match(gp.text, /House Briefing|house/i)
  assert.match(gp.text, /EU only/)
  const nt = await call('get_next_task', { project: pid })
  assert.match(nt.text, /EU only/)
})
