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
/** A second connection = a second server process = a FRESH session, the way an
 *  independent review must be done. */
let fresh
const callWith = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args })
  return { isError: !!r.isError, text: r.content?.[0]?.text ?? '', s: r.structuredContent }
}
const call = (name, args) => callWith(client, name, args)
const callFresh = (name, args) => callWith(fresh, name, args)
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
  // a real (empty) codebase folder, so the board can run the test step's own command
  const code = fs.mkdtempSync(path.join(HOME, 'code-'))
  await call('set_codebase_path', { project: pid, codebase_path: code })
  const mk = async (title, extra = {}) =>
    idOf(await call('add_task', { project: pid, title, detail: 'x', spec_ids: [spid], ...extra }))
  const tasks = {
    a: await mk('Step A'),
    b: await mk('Step B'),
    test: await mk('Write tests', { kind: 'test', verify_command: 'test -f tests-written.txt' }),
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
const done = (pid, id, extra = {}) => {
  // The fixture's testing step is red until its marker exists — writing it here
  // is the harness standing in for "the tests got written".
  try {
    const dir = path.join(HOME, '.specdrive', 'projects', pid)
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'))
    const task = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).find((t) => t.id === id)
    // Only the testing step gets its marker, and only once it is under way:
    // its check must have been RED when the step started.
    if (meta.codebasePath && task?.kind === 'test') fs.writeFileSync(path.join(meta.codebasePath, 'tests-written.txt'), '1')
  } catch {}
  return call('update_task', { project: pid, task_id: id, status: 'done', note: 'works', proof: 'ran it, saw it', ...extra })
}
/** Finish any task the honest way: reviews from the fresh session, the rest here. */
const finish = async (pid, id, ids, extra = {}) => {
  if (ids && id === ids.review) return doneFresh(pid, id)
  await start(pid, id)
  return done(pid, id, extra)
}
/** Finish a task as a fresh, independent session (reviews must be done this way). */
const doneFresh = async (pid, id, extra = {}) => {
  await callFresh('update_task', { project: pid, task_id: id, status: 'in_progress' })
  return callFresh('update_task', { project: pid, task_id: id, status: 'done', note: 'reviewed', proof: 'a fresh independent session read the diff', ...extra })
}

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, HOME }
  })
  client = new Client({ name: 'specdrive-tests', version: '1.0' })
  await client.connect(transport)
  const t2 = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, HOME } })
  fresh = new Client({ name: 'specdrive-tests-fresh', version: '1.0' })
  await fresh.connect(t2)
})
after(async () => {
  await client.close()
  await fresh.close()
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
  // the same session that built cannot be the reviewer
  await start(pid, tasks.review)
  const same = await done(pid, tasks.review, { note: 'reviewed', proof: 'I read my own diff' })
  assert.equal(same.isError, true, 'the builder reviewed its own work')
  assert.match(same.text, /FRESH session/)
  const r0 = await doneFresh(pid, tasks.review)
  assert.equal(r0.isError, false, r0.text)
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
    await finish(pid, id, tasks, { proof: 'checked it by hand' })
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
    await finish(pid, id, tasks)
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
    if (id === tasks.review || id === second) return doneFresh(pid, id)
    await start(pid, id)
    return done(pid, id, { note: 'ok', proof: 'checked by hand' })
  }
  for (const id of [...Object.values(tasks), second]) await finish(id)
  await call('check_convergence', { project: pid })
  const refused = await call('set_phase', { project: pid, phase: 'done' })
  assert.equal(refused.isError, true, 'closed with a single review angle')
  assert.match(refused.text, /lens/i)
  assert.match(refused.text, /edge-cases/)
  const third = idOf(await call('add_task', { project: pid, title: 'Third review', detail: 'x', kind: 'review', lens: 'edge-cases' }))
  await doneFresh(pid, third)
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
    await finish(pid, id, tasks, { proof: 'checked it by hand' })
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

test('22. coverage: shape names the areas, specs fill them by tag, plan is refused over an empty area, n/a needs a reason', async () => {
  const p = await call('create_project', { name: 't22-' + Date.now(), one_liner: 't', idea: 't', shape: 'iOS app' })
  const pid = idOf(p)
  assert.equal(p.isError, false, p.text)
  assert.match(p.text, /App Store|platform/i) // the shape's starting hints surface at once
  // n/a without a reason is refused
  const bad = await call('set_required_areas', {
    project: pid,
    areas: [{ area: 'business-model', why: 'It has to pay for itself.' }, { area: 'platform-rules', why: 'Apple decides.', status: 'n/a' }]
  })
  assert.equal(bad.isError, true)
  const ok = await call('set_required_areas', {
    project: pid,
    areas: [{ area: 'business-model', why: 'It has to pay for itself.' }, { area: 'platform-rules', why: 'Apple decides what ships.' }]
  })
  assert.equal(ok.isError, false, ok.text)
  assert.match(ok.text, /2 area\(s\) have NOTHING/)
  // a spec that admits it does not know (confidence "gap") only makes the area partial;
  // any real answer — even a draft — covers it
  const gap = await call('add_spec', { project: pid, category: 'business', title: 'Unknown yet', content: '?', confidence: 'gap', tags: ['area:business-model'] })
  assert.equal(gap.isError, false, gap.text)
  let gp = await call('get_project', { project: pid })
  assert.match(gp.text, /business-model .* PARTIAL/)
  assert.match(gp.text, /platform-rules .* EMPTY/)
  const sp = await call('add_spec', { project: pid, category: 'business', title: 'Freemium', content: 'x', tags: ['area:business-model'] })
  assert.equal(sp.isError, false, sp.text)
  gp = await call('get_project', { project: pid })
  assert.match(gp.text, /business-model .* COVERED/)
  // the board walks to plan, then refuses over the empty area
  const sc = await call('add_scenario', { project: pid, title: 's', actor: 'u', steps: [{ action: 'a' }, { action: 'b' }] })
  await call('update_scenario', { project: pid, scenario_id: idOf(sc), status: 'walked' })
  for (const phase of ['challenge', 'research', 'risks']) {
    const r = await call('set_phase', { project: pid, phase })
    assert.equal(r.isError, false, `phase ${phase}: ${r.text}`)
  }
  const refused = await call('set_phase', { project: pid, phase: 'plan' })
  assert.equal(refused.isError, true)
  assert.match(refused.text, /platform-rules/)
  // an honest n/a with a reason unlocks it; the decision survives a later full re-declare
  const na = await call('set_required_areas', {
    project: pid,
    areas: [{ area: 'business-model', why: 'It has to pay for itself.' }, { area: 'platform-rules', why: 'Apple decides.', status: 'n/a', note: 'Internal enterprise build, never on the store.' }]
  })
  assert.equal(na.isError, false, na.text)
  const again = await call('set_required_areas', {
    project: pid,
    areas: [{ area: 'business-model', why: 'It has to pay for itself.' }, { area: 'platform-rules', why: 'Apple decides.' }]
  })
  assert.match(again.text, /NOT APPLICABLE/)
  const planned = await call('set_phase', { project: pid, phase: 'plan' })
  assert.equal(planned.isError, false, planned.text)
  const proj = JSON.parse(fs.readFileSync(path.join(HOME, '.specdrive', 'projects', pid, 'project.json'), 'utf8'))
  assert.equal(proj.shape, 'ios-app')
  assert.equal(proj.requiredAreas.find((a) => a.area === 'business-model').status, 'covered')
})

test('23. houses nest: rules stack root-first, the closest house wins on a shared name, cycles refused', async () => {
  const parent = await call('create_folder', {
    name: 'Nest Parent',
    description: 'the group',
    rules: [
      { title: 'EU data', content: 'Data stays in the EU.' },
      { title: 'Group tone', content: 'Formal, never playful.' }
    ]
  })
  assert.equal(parent.isError, false, parent.text)
  const pfid = idOf(parent)
  // A child house created straight inside the parent, overriding one rule by
  // reusing its exact name.
  const child = await call('create_folder', {
    name: 'Nest Child',
    parent: 'Nest Parent',
    rules: [
      { title: 'Group tone', content: 'Playful — this team talks to teenagers.' },
      { title: 'Ship weekly', content: 'Something reaches users every week.' }
    ]
  })
  assert.equal(child.isError, false, child.text)
  const cfid = idOf(child)
  assert.match(child.text, /inside "Nest Parent"/)
  assert.match(child.text, /inherits 1 rule\(s\)/) // EU data only — Group tone is overridden
  const onDisk = JSON.parse(fs.readFileSync(path.join(HOME, '.specdrive', 'folders', `${cfid}.json`), 'utf8'))
  assert.equal(onDisk.parentId, pfid)

  // An unknown parent is refused, not silently ignored.
  const nowhere = await call('create_folder', { name: 'Nest Orphan', parent: 'no-such-house' })
  assert.equal(nowhere.isError, true)
  assert.match(nowhere.text, /Unknown parent house/)

  // A project in the child house sees both houses, outermost first.
  const p = await call('create_project', { name: 't23-' + Date.now(), one_liner: 't', idea: 't', folder: cfid })
  const pid = idOf(p)
  const gp = await call('get_project', { project: pid })
  assert.equal(gp.isError, false, gp.text)
  assert.equal(gp.s.houseChain.length, 2)
  assert.equal(gp.s.houseChain[0].id, pfid, 'the chain starts at the outermost house')
  assert.equal(gp.s.houseChain[1].id, cfid)
  const eff = gp.s.effectiveRules
  assert.deepEqual(
    eff.map((r) => `${r.house}/${r.title}`),
    ['Nest Parent/EU data', 'Nest Parent/Group tone', 'Nest Child/Group tone', 'Nest Child/Ship weekly'],
    'ancestor rules come first, in reading order'
  )
  const replaced = eff.find((r) => r.houseId === pfid && r.title === 'Group tone')
  assert.equal(replaced.supersededBy, cfid, 'the ancestor rule is kept, marked as replaced')
  assert.equal(replaced.supersededByHouse, 'Nest Child')
  assert.ok(
    !eff.find((r) => r.houseId === cfid && r.title === 'Group tone').supersededBy,
    "the closest house's rule wins"
  )
  // The prose an agent actually reads says the same thing.
  assert.match(gp.text, /Nest Parent › Nest Child/)
  assert.match(gp.text, /Group tone — REPLACED by the rule of the same name in "Nest Child"/)
  assert.match(gp.text, /EU data: Data stays in the EU\./)

  // The convergence check walks the whole stack, overrides resolved.
  const built = await projectInBuild('t23b-' + Date.now())
  await call('assign_project_folder', { project: built.pid, folder: cfid })
  for (const t of [built.tasks.a, built.tasks.b, built.tasks.test, built.tasks.security, built.tasks.review]) {
    await start(built.pid, t)
    await done(built.pid, t)
  }
  const conv = await call('check_convergence', { project: built.pid })
  assert.match(conv.text, /4c\. HOUSE RULES/)
  assert.match(conv.text, /\[Nest Parent\] EU data/)
  assert.match(conv.text, /\[Nest Child\] Group tone: Playful/)
  assert.ok(!/\[Nest Parent\] Group tone/.test(conv.text), 'a replaced rule is not asked for twice')

  // list_projects prints the tree and the project's full address.
  const list = await call('list_projects', {})
  const tree = list.s.folders.find((f) => f.id === cfid)
  assert.equal(tree.parentId, pfid)
  assert.equal(tree.path, 'Nest Parent › Nest Child')
  assert.equal(tree.ruleCount, 2)
  assert.equal(tree.effectiveRuleCount, 3) // EU data + both live Group tone/Ship weekly
  assert.match(list.text, /\n {2}nest-child — "Nest Child"/, 'sub-houses are indented under their house')

  // Cycles and self-parenting are refused; the move that is legal works.
  const cycle = await call('set_folder_parent', { folder: pfid, parent: cfid })
  assert.equal(cycle.isError, true)
  assert.match(cycle.text, /already lives inside this one/)
  const itself = await call('set_folder_parent', { folder: cfid, parent: cfid })
  assert.equal(itself.isError, true)
  assert.match(itself.text, /cannot live inside itself/)
  const out = await call('set_folder_parent', { folder: cfid, parent: '' })
  assert.equal(out.isError, false, out.text)
  const alone = JSON.parse(fs.readFileSync(path.join(HOME, '.specdrive', 'folders', `${cfid}.json`), 'utf8'))
  assert.equal(alone.parentId, undefined, 'taken out of its parent house')
  const back = await call('set_folder_parent', { folder: 'Nest Child', parent: 'Nest Parent' })
  assert.equal(back.isError, false, back.text)
  assert.match(back.text, /Nest Parent › Nest Child/)
})

test('24. the inheritance rule is one shared function: chain, override, cycles, depth', async () => {
  const { activeRules, canParent, chainLabel, effectiveRules, houseChain, possibleParents, subtreeDepth } =
    await import('../src/shared/house-chain.mjs')
  const houses = [
    { id: 'a', name: 'A', rules: [{ title: 'One', content: 'a1' }, { title: 'Two', content: 'a2' }] },
    { id: 'b', name: 'B', parentId: 'a', rules: [{ title: 'Two', content: 'b2' }] },
    { id: 'c', name: 'C', parentId: 'b', rules: [{ title: 'Three', content: 'c3' }] },
    // A house whose parent points back down its own line — must not loop.
    { id: 'x', name: 'X', parentId: 'y', rules: [] },
    { id: 'y', name: 'Y', parentId: 'x', rules: [] }
  ]
  const read = (id) => houses.find((h) => h.id === id) ?? null

  assert.equal(chainLabel(houseChain('c', read)), 'A › B › C')
  assert.deepEqual(
    effectiveRules('c', read).map((r) => `${r.house}/${r.title}${r.supersededBy ? '(replaced)' : ''}`),
    ['A/One', 'A/Two(replaced)', 'B/Two', 'C/Three']
  )
  assert.deepEqual(
    activeRules('c', read).map((r) => r.content),
    ['a1', 'b2', 'c3'],
    'the closest house wins, nothing is lost on the way'
  )
  assert.ok(houseChain('x', read).length <= 2, 'a cycle stops instead of looping forever')
  assert.equal(effectiveRules(null, read).length, 0)

  assert.equal(canParent('a', 'c', read, houses).length > 0, true, 'a house cannot go inside its own child')
  assert.equal(canParent('a', 'a', read, houses).length > 0, true)
  assert.equal(canParent('c', 'a', read, houses), '', 'a legal move is allowed')
  assert.equal(subtreeDepth('a', houses), 3)
  assert.deepEqual(
    possibleParents('b', houses, read).map((h) => h.id),
    ['a', 'x', 'y'],
    'itself and its descendants are not offered'
  )
})

test('25. proof ladder: a claimed command is refused, a test step needs its command, acceptance must be answered', async () => {
  const { pid, spid, tasks } = await projectInBuild('t25-' + Date.now())
  // (b) "I ran npm test" in prose, no verify_command → refused, pointed at edit_task
  await start(pid, tasks.a)
  const claimed = await done(pid, tasks.a, { proof: 'Ran npm test — 12 passing' })
  assert.equal(claimed.isError, true)
  assert.match(claimed.text, /did not see it run/)
  const honest = await done(pid, tasks.a, { proof: 'opened the page, clicked through, saw the count drop' })
  assert.equal(honest.isError, false, honest.text)
  // (a) a testing step must carry the command
  const bare = idOf(await call('add_task', { project: pid, title: 'More tests', detail: 'x', spec_ids: [spid], kind: 'test' }))
  await start(pid, bare)
  const noCmd = await done(pid, bare)
  assert.equal(noCmd.isError, true)
  assert.match(noCmd.text, /testing step/)
  const skipped = await done(pid, bare, { proof_run_skip_reason: 'no runner in this sandbox' })
  assert.equal(skipped.isError, false, skipped.text)
  // (d) a spec with an acceptance scenario must get a result
  await call('update_spec', { project: pid, spec_id: spid, acceptance: 'Given the last loaf, when I tap Reserve, then the count drops to 0' })
  await start(pid, tasks.b)
  const noAcc = await done(pid, tasks.b)
  assert.equal(noAcc.isError, true)
  assert.match(noAcc.text, /acceptance scenario/)
  const failAcc = await done(pid, tasks.b, { acceptance_results: [{ spec: spid, result: 'fail', how: 'count stayed at 1' }] })
  assert.equal(failAcc.isError, true)
  assert.match(failAcc.text, /FAILS/)
  const passAcc = await done(pid, tasks.b, { acceptance_results: [{ spec: 'f', result: 'pass', how: 'tapped Reserve, count went 1 → 0' }] })
  assert.equal(passAcc.isError, false, passAcc.text)
  const stored = JSON.parse(fs.readFileSync(path.join(HOME, '.specdrive', 'projects', pid, 'tasks.json'), 'utf8')).find((t) => t.id === tasks.b)
  assert.equal(stored.acceptanceResults[0].result, 'pass')
  assert.equal(stored.doneBy.pid > 0, true)
})

test('26. rerun_checks earns the green marks again and flags a check that now fails', async () => {
  const { pid, spid } = await projectInPlan('t26-' + Date.now())
  const code = fs.mkdtempSync(path.join(HOME, 'code-'))
  await call('set_codebase_path', { project: pid, codebase_path: code })
  const okTask = idOf(await call('add_task', { project: pid, title: 'Passing step', detail: 'x', spec_ids: [spid], verify_command: 'true' }))
  const flaky = idOf(await call('add_task', { project: pid, title: 'Flaky step', detail: 'x', spec_ids: [spid], verify_command: 'test -f flag.txt' }))
  for (const [title, kind] of [['Write tests', 'test'], ['Safety pass', 'security'], ['Independent review', 'review']])
    await call('add_task', { project: pid, title, detail: 'x', spec_ids: [spid], kind, ...(kind === 'test' ? { verify_command: 'true' } : {}) })
  const r = await call('set_phase', { project: pid, phase: 'build' })
  assert.equal(r.isError, false, r.text)
  fs.writeFileSync(path.join(code, 'flag.txt'), '1')
  for (const id of [okTask, flaky]) {
    await start(pid, id)
    const d = await done(pid, id, { proof_run_skip_reason: undefined, proof: 'the check ran green' })
    assert.equal(d.isError, false, d.text)
  }
  fs.unlinkSync(path.join(code, 'flag.txt'))
  const rerun = await call('rerun_checks', { project: pid })
  assert.equal(rerun.isError, false, rerun.text)
  assert.match(rerun.text, /1 passed, 1 failed/)
  const conv = await call('check_convergence', { project: pid })
  assert.match(conv.text, /RE-CHECK/i)
})

test('27. red before green: a test step whose check was already passing proves nothing', async () => {
  const { pid, spid } = await projectInPlan('t27-' + Date.now())
  const code = fs.mkdtempSync(path.join(HOME, 'code-'))
  await call('set_codebase_path', { project: pid, codebase_path: code })
  // a "test" step whose command passes before any work is done
  const cheat = idOf(await call('add_task', { project: pid, title: 'Write tests', detail: 'x', spec_ids: [spid], kind: 'test', verify_command: 'true' }))
  const honest = idOf(await call('add_task', { project: pid, title: 'More tests', detail: 'x', spec_ids: [spid], kind: 'test', verify_command: 'test -f built.txt' }))
  await call('add_task', { project: pid, title: 'Safety pass', detail: 'x', spec_ids: [spid], kind: 'security' })
  await call('add_task', { project: pid, title: 'Independent review', detail: 'x', spec_ids: [spid], kind: 'review' })
  assert.equal((await call('set_phase', { project: pid, phase: 'build' })).isError, false)
  await start(pid, cheat)
  const cheated = await done(pid, cheat, { proof: 'the suite is green' })
  assert.equal(cheated.isError, true, 'accepted a test that was green before the work')
  assert.match(cheated.text, /already passed|fails first/i)
  // the honest one is red first, then green once the work exists
  await start(pid, honest)
  fs.writeFileSync(path.join(code, 'built.txt'), '1')
  const good = await done(pid, honest, { proof: 'test went from red to green' })
  assert.equal(good.isError, false, good.text)
  const stored = JSON.parse(fs.readFileSync(path.join(HOME, '.specdrive', 'projects', pid, 'tasks.json'), 'utf8'))
  assert.equal(stored.find((t) => t.id === honest).baselineRun.exitCode !== 0, true)
})
