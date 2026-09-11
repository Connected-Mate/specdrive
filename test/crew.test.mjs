// End-to-end tests of the owner's own agents ("crew") through the real MCP
// server over stdio, against an isolated data dir (HOME is overridden), so
// nothing touches ~/.specdrive. The point of this module is that a saved agent
// becomes a real slash command and resolves per project like a house rule —
// so the prompt list and the scope chain are what these tests actually check.
// Run: npm test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(here, '..', 'mcp', 'server.mjs')
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'specdrive-crew-'))
const CREW_DIR = path.join(HOME, '.specdrive', 'crew')

let client
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args })
  return { isError: !!r.isError, text: r.content?.[0]?.text ?? '', s: r.structuredContent }
}
const idOf = (r) => r.text.match(/id: ([a-z0-9-]+)/)?.[1]
const slugOf = (r) => r.text.match(/slug: ([a-z0-9-]+)/)?.[1]
const promptNames = async () => (await client.listPrompts()).prompts.map((p) => p.name)
const promptBy = async (name) => (await client.listPrompts()).prompts.find((p) => p.name === name)

/** The crew file of an agent, found by the slug list_agents reports. */
const fileIdOf = async (slug) => {
  const r = await call('list_agents', {})
  return r.s.agents.filter((a) => a.slug === slug).map((a) => a.id)
}

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, HOME }
  })
  client = new Client({ name: 'specdrive-crew-tests', version: '1.0' })
  await client.connect(transport)
})
after(async () => {
  await client.close()
  fs.rmSync(HOME, { recursive: true, force: true }) // our own temp dir only
})

test('1. a saved agent becomes a real slash command, and a preset fills the whole brief', async () => {
  const before = await promptNames()
  assert.equal(before.includes('agent_human_tester'), false, 'the prompt existed before any agent was saved')
  assert.equal(before.includes('specdrive_integrate_agent'), true, 'the "create an agent" prompt is missing')
  assert.equal(before.includes('specdrive_run_agent'), true, 'the "run an agent" prompt is missing')

  const r = await call('add_agent', { preset: 'human-tester' })
  assert.equal(r.isError, false, r.text)
  assert.equal(slugOf(r), 'human-tester', r.text)
  assert.match(r.text, /\/mcp__specdrive__agent_human_tester/)

  const p = await promptBy('agent_human_tester')
  assert.ok(p, `prompts/list has no agent_human_tester — got: ${(await promptNames()).join(', ')}`)
  assert.equal(p.title, 'Agent — Human tester')
  assert.match(p.description, /like a real/i)

  // the preset really filled it in — a bare shell would pass the slug check
  const got = await call('get_agent', { agent: 'human-tester' })
  assert.equal(got.isError, false, got.text)
  assert.ok(got.s.agent.rules.length >= 4, `preset rules: ${got.s.agent.rules.length}`)
  assert.ok(got.s.agent.method.length >= 4, `preset method: ${got.s.agent.method.length}`)
  assert.equal(got.s.agent.preset, 'human-tester')

  // a hand-written one lands next to it, with its own command
  const own = await call('add_agent', {
    name: 'Copy checker',
    emoji: '📝',
    role: 'Checks every word on screen against the brand voice',
    mission: 'Read every screen and judge the words, not the code.',
    rules: ['Never change anything', 'Quote the exact sentence you object to'],
    method: ['Open the app', 'Read every screen', 'List what reads badly'],
    deliverable: 'A list of sentences to rewrite, worst first.'
  })
  assert.equal(own.isError, false, own.text)
  const names = await promptNames()
  assert.ok(names.includes('agent_copy_checker'), names.join(', '))
})

test('2. scope resolves through nested houses: the closest one wins, a switched-off one is hidden', async () => {
  const a = await call('create_folder', { name: 'House A' })
  const aId = idOf(a)
  const b = await call('create_folder', { name: 'House B', parent: aId })
  const bId = idOf(b)
  const proj = await call('create_project', { name: 'Nested app', one_liner: 'x', idea: 'x', folder: bId })
  const pid = idOf(proj)

  const mk = (folder, role) =>
    call('add_agent', {
      name: 'Watchdog',
      emoji: '🐕',
      role,
      mission: 'Watch over this house.',
      scope: 'house',
      folder
    })
  assert.equal((await mk(aId, 'Guards House A')).isError, false)
  assert.equal((await mk(bId, 'Guards House B')).isError, false)

  const seen = await call('list_agents', { project: pid })
  assert.equal(seen.isError, false, seen.text)
  const dogs = seen.s.agents.filter((x) => x.slug === 'watchdog')
  assert.equal(dogs.length, 1, `both Watchdogs reached the project: ${JSON.stringify(dogs)}`)
  assert.equal(dogs[0].role, 'Guards House B', 'the outer house won over the closest one')
  assert.equal(dogs[0].from, 'House B')
  assert.match(seen.text, /Not available here: Watchdog/)

  // a house can switch off an agent it inherits — that is written on the agent
  const global = await call('add_agent', {
    name: 'Scout',
    emoji: '🔭',
    role: 'Looks around',
    mission: 'Look around the project.'
  })
  assert.equal(global.isError, false, global.text)
  const withScout = await call('list_agents', { project: pid })
  assert.ok(withScout.s.agents.some((x) => x.slug === 'scout'), 'the everywhere-agent never reached the project')

  const [scoutId] = await fileIdOf('scout')
  const file = path.join(CREW_DIR, `${scoutId}.json`)
  const on = JSON.parse(fs.readFileSync(file, 'utf8'))
  on.disabledIn = [bId]
  fs.writeFileSync(file, JSON.stringify(on, null, 2))

  const after = await call('list_agents', { project: pid })
  assert.equal(
    after.s.agents.some((x) => x.slug === 'scout'),
    false,
    'a switched-off agent still showed up as runnable'
  )
  // and it is still there for every other project
  const elsewhere = await call('list_agents', {})
  assert.ok(elsewhere.s.agents.some((x) => x.slug === 'scout'), 'switching it off in one house deleted it')
})

test('3. run_agent hands back the brief with the house rules, the project and the report-back order', async () => {
  const f = await call('create_folder', {
    name: 'Rule house',
    rules: [{ title: 'Data stays in the EU', content: 'Nothing leaves the EU, ever.' }]
  })
  const fid = idOf(f)
  const proj = await call('create_project', { name: 'Briefed app', one_liner: 'a thing', idea: 'x', folder: fid })
  const pid = idOf(proj)
  await call('add_agent', {
    name: 'Rule reader',
    emoji: '📏',
    role: 'Reads the rules',
    mission: 'Check the product against the rules in force.',
    scope: 'house',
    folder: fid
  })

  const r = await call('run_agent', { agent: 'rule-reader', project: pid, focus: 'only the sign-up screen' })
  assert.equal(r.isError, false, r.text)
  assert.match(r.text, /Data stays in the EU/, 'the house rules in force are missing from the brief')
  assert.match(r.text, /Briefed app/, 'the project is missing from the brief')
  assert.match(r.text, /Rule house/, 'the house address is missing from the brief')
  assert.match(r.text, /only the sign-up screen/, 'the focus the owner asked for is missing')
  assert.match(r.text, /log_agent_run/, 'the brief never tells the agent to report back')
  assert.match(r.text, /Rule reader/)

  // an agent that does not reach this project is refused, by name, in plain words
  const other = await call('create_project', { name: 'Outside app', one_liner: 'x', idea: 'x' })
  const outside = await call('run_agent', { agent: 'rule-reader', project: idOf(other) })
  assert.equal(outside.isError, true, 'an out-of-scope agent was allowed to run')
  assert.match(outside.text, /Rule house/)

  // and the loser of a shared name names the winner
  const clash = await call('run_agent', { agent: 'watchdog', project: pid })
  assert.equal(clash.isError, true, clash.text)

  // the same brief is what the slash command hands over
  const prompt = await client.getPrompt({ name: 'agent_rule_reader', arguments: { project: pid } })
  const text = prompt.messages[0].content.text
  assert.match(text, /Data stays in the EU/)
  assert.match(text, /Briefed app/)
  assert.equal(
    text.split('Always talk to me in the language I write to you in.').length - 1,
    1,
    'the language line was doubled'
  )
})

test('4. a reported run is stored, shows its verdict, and reaches the project board', async () => {
  const proj = await call('create_project', { name: 'Reported app', one_liner: 'x', idea: 'x' })
  const pid = idOf(proj)
  const r = await call('log_agent_run', {
    agent: 'human-tester',
    project: pid,
    verdict: 'issues',
    summary: 'Sign-up works, but the password field silently drops what you paste into it.',
    findings: [
      {
        severity: 'blocker',
        title: 'Pasted password is dropped',
        detail: 'Pasted a password into the sign-up form; the field stayed empty and the button did nothing.',
        where: 'Sign-up screen'
      }
    ]
  })
  assert.equal(r.isError, false, r.text)
  assert.match(r.text, /Found problems/, r.text)

  const got = await call('get_agent', { agent: 'human-tester' })
  assert.equal(got.s.agent.runs.length, 1)
  assert.equal(got.s.agent.runs[0].verdict, 'issues')
  assert.equal(got.s.agent.runs[0].projectId, pid)
  assert.equal(got.s.agent.runs[0].findings[0].severity, 'blocker')
  assert.ok(got.s.agent.runs[0].by, 'the report was stored without saying which tool posted it')
  assert.match(got.text, /Pasted password is dropped/)

  const listed = await call('list_agents', { project: pid })
  const tester = listed.s.agents.find((a) => a.slug === 'human-tester')
  assert.ok(tester, 'the agent that just reported is not on the project')
  assert.equal(tester.lastVerdict, 'issues')
  assert.match(listed.text, /Found problems/)

  const board = await call('get_project', { project: pid })
  assert.equal(board.isError, false, board.text)
  assert.ok(Array.isArray(board.s.agents), 'get_project does not report the agents')
  assert.ok(board.s.agents.some((a) => a.slug === 'human-tester'), JSON.stringify(board.s.agents))
  assert.match(board.text, /AGENTS YOU CAN RUN HERE/)
  assert.match(board.text, /\/mcp__specdrive__agent_human_tester/)

  const feed = fs.readFileSync(path.join(HOME, '.specdrive', 'projects', pid, 'activity.jsonl'), 'utf8')
  assert.match(feed, /agent_run/, 'the run never reached the project activity feed')
})

test('5. get_guidance tells a fresh session the owner has agents and how to run them', async () => {
  const g = await call('get_guidance', {})
  assert.equal(g.isError, false, g.text)
  assert.match(g.text, /AGENTS \(the owner's own saved team\)/)
  assert.match(g.text, /list_agents/)
  assert.match(g.text, /run_agent/)
  assert.match(g.text, /log_agent_run/)
  assert.match(g.text, /specdrive_integrate_agent/)
})

test('6. the crew is exported as Claude Code subagents, and only SpecDrive files are ever touched', async () => {
  const code = fs.mkdtempSync(path.join(HOME, 'code-'))
  const dotClaude = path.join(code, '.claude', 'agents')
  fs.mkdirSync(dotClaude, { recursive: true })
  fs.writeFileSync(path.join(dotClaude, 'other.md'), 'someone else wrote this\n')

  const proj = await call('create_project', { name: 'Exported app', one_liner: 'x', idea: 'x' })
  const pid = idOf(proj)
  await call('set_codebase_path', { project: pid, codebase_path: code })

  const add = await call('add_agent', {
    name: 'Export me',
    emoji: '📤',
    role: 'Proves the export works',
    mission: 'Exist, and be written into the codebase.',
    model_hint: 'sonnet'
  })
  assert.equal(add.isError, false, add.text)

  const target = path.join(dotClaude, 'specdrive-export-me.md')
  assert.ok(fs.existsSync(target), `not exported — folder holds: ${fs.readdirSync(dotClaude).join(', ')}`)
  const md = fs.readFileSync(target, 'utf8')
  assert.match(md, /^---\nname: specdrive-export-me\n/)
  assert.match(md, /model: sonnet/)
  assert.match(md, /Proves the export works/)
  assert.match(md, /Exported app/, 'the exported brief does not name the project it is for')
  assert.equal(fs.existsSync(path.join(dotClaude, 'other.md')), true, 'a foreign file was removed')

  // leaving scope removes the file, without deleting the agent
  const house = await call('create_folder', { name: 'Far house' })
  const moved = await call('set_agent_scope', { agent: 'export-me', scope: 'house', folder: idOf(house) })
  assert.equal(moved.isError, false, moved.text)
  assert.equal(fs.existsSync(target), false, 'the agent left scope but its subagent file stayed')
  assert.equal(fs.existsSync(path.join(dotClaude, 'other.md')), true, 'a foreign file was removed')

  // back everywhere → written again, then deleted for good
  assert.equal((await call('set_agent_scope', { agent: 'export-me', scope: 'global' })).isError, false)
  assert.ok(fs.existsSync(target), 'coming back into scope did not re-export the agent')
  const gone = await call('delete_agent', { agent: 'export-me' })
  assert.equal(gone.isError, false, gone.text)
  assert.equal(fs.existsSync(target), false, 'a deleted agent kept its subagent file')
  assert.equal(fs.existsSync(path.join(dotClaude, 'other.md')), true, 'a foreign file was removed')
})

test('7. deleting an agent takes its slash command away and warns about the reports it sets aside', async () => {
  assert.ok((await promptNames()).includes('agent_human_tester'))
  const r = await call('delete_agent', { agent: 'human-tester' })
  assert.equal(r.isError, false, r.text)
  assert.match(r.text, /WARNING/, 'the owner was not warned that a report went with it')
  assert.match(r.text, /1 past report/)
  const names = await promptNames()
  assert.equal(names.includes('agent_human_tester'), false, `the prompt survived the delete: ${names.join(', ')}`)
  // nothing is destroyed
  const trash = fs.readdirSync(path.join(HOME, '.specdrive', 'trash'))
  assert.ok(trash.some((f) => f.startsWith('agent-human-tester-')), trash.join(', '))
})

test('8. an agent edited on disk (in the app) refreshes the list of a running server', async () => {
  const [id] = await fileIdOf('copy-checker')
  const file = path.join(CREW_DIR, `${id}.json`)
  const on = JSON.parse(fs.readFileSync(file, 'utf8'))
  on.name = 'Voice checker'
  on.role = 'Checks the voice of every screen'
  on.updatedAt = new Date().toISOString()
  fs.writeFileSync(file, JSON.stringify(on, null, 2))

  // the file watch is debounced — give it a beat, then read the list
  let p = null
  for (let i = 0; i < 40 && !p; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const found = await promptBy('agent_copy_checker')
    if (found?.title === 'Agent — Voice checker') p = found
  }
  assert.ok(p, 'editing an agent in the app never reached the running server')
  assert.equal(p.description, 'Checks the voice of every screen')
})

test('9. the same rules refuse the same things at both doors', async () => {
  const noName = await call('add_agent', { role: 'x', mission: 'y' })
  assert.equal(noName.isError, true)
  assert.match(noName.text, /name/i)
  const noRole = await call('add_agent', { name: 'Nameless', mission: 'y' })
  assert.equal(noRole.isError, true)
  assert.match(noRole.text, /one line/i)
  const badHouse = await call('add_agent', { name: 'Homeless', role: 'x', mission: 'y', scope: 'house', folder: 'nope' })
  assert.equal(badHouse.isError, true)
  assert.match(badHouse.text, /Unknown house/)
  const unknown = await call('run_agent', { agent: 'nobody', project: 'nothing' })
  assert.equal(unknown.isError, true)
  assert.match(unknown.text, /no agent called "nobody"/)
  const badVerdict = await call('log_agent_run', { agent: 'watchdog', verdict: 'great', summary: 'x' })
  assert.equal(badVerdict.isError, true, badVerdict.text)
})

test('10. AGENTS.md carries a "Your agents" section naming each agent and its command', async () => {
  // agentsMd.ts is TypeScript; esbuild bundles it the same way test/agents.test.mjs does.
  const out = path.join(HOME, 'agents-md.mjs')
  await esbuild.build({
    entryPoints: [path.resolve(here, '..', 'src', 'main', 'agentsMd.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    logLevel: 'silent'
  })
  const { renderAgentsMd } = await import(out)
  const base = {
    project: {
      id: 'p1',
      name: 'Md app',
      oneLiner: 'a thing',
      idea: 'x',
      phase: 'build',
      mode: 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    specs: [],
    tasks: [],
    wireframes: [],
    flow: null,
    scenarios: [],
    planDoc: null,
    documents: [],
    activity: []
  }
  const empty = renderAgentsMd(base)
  assert.match(empty, /## Your agents/)
  assert.match(empty, /No agents saved yet\./)

  const withCrew = renderAgentsMd({
    ...base,
    agents: [
      { slug: 'human-tester', name: 'Human tester', emoji: '🧑‍🔬', role: 'Tests like a real person', from: 'Everywhere' },
      { slug: 'house-cop', name: 'House cop', emoji: '👮', role: 'Checks the house rules', from: 'SNCF' },
      { slug: 'ghost', name: 'Ghost', emoji: '👻', role: 'Should not be listed', from: 'SNCF', disabled: true },
      { slug: 'beaten', name: 'Beaten', emoji: '🥀', role: 'Also not listed', from: 'SNCF', supersededBy: 'house-cop' }
    ]
  })
  assert.match(withCrew, /- \*\*🧑‍🔬 Human tester\*\* — Tests like a real person \(available everywhere\) → run it with `\/mcp__specdrive__agent_human_tester`/)
  assert.match(withCrew, /\(from the house "SNCF"\) → run it with `\/mcp__specdrive__agent_house_cop`/)
  assert.equal(/Ghost/.test(withCrew), false, 'a switched-off agent was exported')
  assert.equal(/Beaten/.test(withCrew), false, 'a superseded agent was exported')
  // the section sits between the state and what not to touch, where a reader expects it
  assert.ok(withCrew.indexOf('## Current state') < withCrew.indexOf('## Your agents'))
  assert.ok(withCrew.indexOf('## Your agents') < withCrew.indexOf('## What not to touch'))
})

test('11. an agent carries where its brief came from: sources + research round-trip, cap, and the export footer', async () => {
  const code = fs.mkdtempSync(path.join(HOME, 'sourced-code-'))
  const p = await call('create_project', { name: 'Sourced app', one_liner: 'x', idea: 'x' })
  const pid = idOf(p)
  await call('set_codebase_path', { project: pid, codebase_path: code })

  const made = await call('add_agent', {
    name: 'Lineage check',
    role: 'Reviews a diff the way the best published reviewers do',
    mission: 'Read the diff and report what is wrong, with proof.',
    rules: ['Never fix anything yourself.'],
    sources: [
      {
        url: 'https://raw.githubusercontent.com/example/agents/main/code-reviewer.md',
        title: 'example/agents — code-reviewer',
        license: 'MIT',
        what: 'Its severity scale and the rule that every finding carries a file:line.'
      },
      {
        url: 'https://docs.example.com/custom-agents',
        title: 'Vendor docs — custom agents',
        what: 'The frontmatter shape and when a subagent should refuse to act.'
      },
      // kept out by the cleaner: it parses as a string but is not a real link
      { url: 'javascript:alert(1)', what: 'must never become a link' }
    ],
    research: 'Three reviewers were read. The strongest one is strict about evidence; the weakest turns every nit into a blocker, so its tone was dropped.'
  })
  assert.equal(made.isError, false, made.text)
  assert.match(made.text, /records 2 source\(s\)/)

  const read = await call('get_agent', { agent: 'lineage-check' })
  assert.equal(read.isError, false, read.text)
  const a = read.s.agent
  assert.equal(a.sources.length, 2, 'a source without a usable link was stored')
  // A source missing its address is refused at the door, not quietly dropped:
  // losing a credit without saying so is worse than failing the call.
  const headless = await call('add_agent', {
    name: 'Headless source',
    role: 'x',
    mission: 'x',
    sources: [{ what: 'no address at all' }]
  })
  assert.equal(headless.isError, true, 'a source with no address was accepted')
  assert.match(headless.text, /sources\[0\]\.url|Required/i)
  assert.equal(a.sources[0].license, 'MIT')
  assert.equal(/javascript:/.test(JSON.stringify(a.sources)), false, 'a non-http link was stored')
  assert.match(a.research, /strongest one is strict about evidence/)
  assert.match(read.text, /BUILT FROM/)
  assert.match(read.text, /HOW THOSE COMPARED/)

  // The exported Claude Code subagent file credits what it was built from.
  const file = path.join(code, '.claude', 'agents', 'specdrive-lineage-check.md')
  assert.equal(fs.existsSync(file), true, 'the agent was not exported')
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /## Built from/)
  assert.match(text, /\[example\/agents — code-reviewer\]\(https:\/\/raw\.githubusercontent\.com\/example\/agents\/main\/code-reviewer\.md\) · MIT/)
  assert.match(text, /\*\*How they compared:\*\*/)

  // Caps are enforced at BOTH doors. Over the wire the tool refuses and says
  // why — a silently shortened credit list is a lie about what was read.
  const many = Array.from({ length: 20 }, (_, i) => ({
    url: `https://example.com/agent-${i}.md`,
    what: `candidate ${i}`
  }))
  const overCap = await call('update_agent', {
    agent: 'lineage-check',
    sources: many,
    research: 'x'.repeat(4000)
  })
  assert.equal(overCap.isError, true, 'an over-cap source list was accepted')
  assert.match(overCap.text, /at most 12 element|at most 1500 character/)

  // Within the caps it updates, and touches nothing else in the brief.
  const updated = await call('update_agent', {
    agent: 'lineage-check',
    sources: many.slice(0, 12),
    research: 'Second pass: four more candidates read, none better than the first.'
  })
  assert.equal(updated.isError, false, updated.text)
  const after = (await call('get_agent', { agent: 'lineage-check' })).s.agent
  assert.equal(after.sources.length, 12)
  assert.match(after.research, /Second pass/)
  assert.equal(after.rules.length, 1)
  assert.equal(after.name, 'Lineage check')

  // The shared cleaner is the second door: a file edited by hand, or the app's
  // own write path, is trimmed to the same limits instead of growing forever.
  const { cleanAgent, CREW_LIMITS } = await import('../src/shared/crew-chain.mjs')
  const trimmed = cleanAgent({
    name: 'Hand written',
    role: 'x',
    mission: 'x',
    sources: many,
    research: 'y'.repeat(4000)
  })
  assert.equal(trimmed.error, '')
  assert.equal(trimmed.agent.sources.length, CREW_LIMITS.sources)
  assert.equal(trimmed.agent.research.length, CREW_LIMITS.research)
})

test('12. an agent saved with no sources is told to go and research', async () => {
  const bare = await call('add_agent', {
    name: 'Improvised',
    role: 'Made up on the spot',
    mission: 'Nothing was read before writing this.'
  })
  assert.equal(bare.isError, false, bare.text)
  assert.match(bare.text, /records no sources/)
  assert.match(bare.text, /read the actual definition files/)
  // A ready-made one is not nagged: it was not improvised.
  const preset = await call('add_agent', { preset: 'spec-checker', name: 'Ready made' })
  assert.equal(preset.isError, false, preset.text)
  assert.equal(/records no sources/.test(preset.text), false)
})

test('13. the exported subagent file routes on `description` and is fenced in by a tool allowlist', async () => {
  const code = fs.mkdtempSync(path.join(HOME, 'fm-code-'))
  const p = await call('create_project', { name: 'Frontmatter app', one_liner: 'x', idea: 'x' })
  const pid = idOf(p)
  await call('set_codebase_path', { project: pid, codebase_path: code })

  // A brief that promises never to fix anything must not be handed Edit/Write,
  // even when the caller asks for them: the allowlist is the guardrail.
  const made = await call('add_agent', {
    name: 'Fenced reviewer',
    role: 'Reviews a diff',
    description: 'Use after writing code, before opening a pull request.',
    mission: 'Read the diff and report what is wrong.',
    rules: ['Never fix anything yourself — reporting is the whole job.'],
    allowed_tools: ['Read', 'Grep', 'Edit', 'Write', 'NotThatOne'],
    model_hint: 'opus'
  })
  assert.equal(made.isError, false, made.text)

  const file = path.join(code, '.claude', 'agents', 'specdrive-fenced-reviewer.md')
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /^---\n/)
  assert.match(text, /name: specdrive-fenced-reviewer/)
  // the routing line wins over the role in the frontmatter description
  assert.match(text, /description: "Use after writing code, before opening a pull request\."/)
  assert.match(text, /model: opus/)
  const toolLine = text.match(/^tools: (.+)$/m)?.[1]
  assert.ok(toolLine, 'no tools line in the frontmatter')
  assert.equal(/Edit|Write/.test(toolLine), false, `a "never fix" agent was handed writing tools: ${toolLine}`)
  assert.equal(/NotThatOne/.test(toolLine), false, 'an unknown tool name reached the frontmatter')
  assert.match(toolLine, /Read/)
  assert.match(toolLine, /Grep/)

  // An agent that says nothing about fixing keeps what it was granted.
  const builder = await call('add_agent', {
    name: 'Fixer upper',
    role: 'Applies the fixes',
    mission: 'Change the code where the report says to.',
    rules: ['Explain every change in one line.'],
    allowed_tools: ['Read', 'Edit', 'Write']
  })
  assert.equal(builder.isError, false, builder.text)
  const builderText = fs.readFileSync(path.join(code, '.claude', 'agents', 'specdrive-fixer-upper.md'), 'utf8')
  assert.match(builderText.match(/^tools: (.+)$/m)[1], /Edit/)

  // With no allowlist at all, the export falls back to the read-only set.
  const plain = await call('add_agent', { name: 'Plain one', role: 'Looks around', mission: 'Look at things.' })
  assert.equal(plain.isError, false, plain.text)
  const plainText = fs.readFileSync(path.join(code, '.claude', 'agents', 'specdrive-plain-one.md'), 'utf8')
  const plainTools = plainText.match(/^tools: (.+)$/m)[1]
  assert.match(plainTools, /Read, Grep, Glob/)
  assert.equal(/Edit|Write/.test(plainTools), false)
})

test('14. every ready-made agent arrives researched: sources, a routing line and a read-only allowlist', async () => {
  const { AGENT_PRESETS, AGENT_PRESET_KEYS } = await import('../src/shared/crew-presets.mjs')
  for (const key of AGENT_PRESET_KEYS) {
    const preset = AGENT_PRESETS[key]
    assert.ok(preset, `${key} is listed but missing`)
    assert.ok(preset.sources?.length >= 2, `${key} carries fewer than two sources`)
    for (const s of preset.sources) {
      assert.match(s.url, /^https:\/\//, `${key}: a source is not a real link`)
      assert.ok(s.what?.length > 10, `${key}: a source does not say what it contributed`)
    }
    assert.ok(preset.research?.length > 80, `${key} has no research note`)
    assert.ok(preset.description?.length > 10, `${key} has no routing line`)
    assert.ok(preset.description.length <= 160, `${key}: routing line too long`)
    assert.ok(preset.allowedTools?.length, `${key} has no tool allowlist`)
    assert.equal(
      preset.allowedTools.some((t) => t === 'Edit' || t === 'Write'),
      false,
      `${key} is a reviewer and must not be handed writing tools`
    )
  }

  // Saved through the real tool, a preset keeps all of it.
  // Naming a ready-made agent makes the NAME the command, not the preset key.
  const saved = await call('add_agent', { preset: 'security-reviewer', name: 'Sec preset check' })
  assert.equal(saved.isError, false, saved.text)
  assert.equal(slugOf(saved), 'sec-preset-check', saved.text)
  const read = await call('get_agent', { agent: 'sec-preset-check' })
  const a = read.s.agent
  assert.equal(a.sources.length, 3)
  assert.match(a.research, /top ten risks|published top ten/i)
  assert.match(a.description, /before anything goes in front of real people/i)
  assert.match(read.text, /When to use it:/)
  assert.match(read.text, /Tools it is allowed:/)
})

test('15. the composed run brief carries the reporting contract, not just the job', async () => {
  const p = await call('create_project', { name: 'Contract app', one_liner: 'x', idea: 'x' })
  const pid = idOf(p)
  await call('add_agent', { preset: 'human-tester', name: 'Contract tester' })
  const r = await call('run_agent', { agent: 'contract-tester', project: pid })
  assert.equal(r.isError, false, r.text)
  assert.match(r.text, /WHERE: the screen/)
  assert.match(r.text, /HOW BAD: blocker/)
  assert.match(r.text, /WHAT I SAW/)
  assert.match(r.text, /THE FIX/)
  assert.match(r.text, /Never invent a number/)
  assert.match(r.text, /I found nothing wrong/)
  assert.match(r.text, /Before you report, check yourself/)
  assert.match(r.text, /log_agent_run/)
  assert.match(r.text, /When you are the right one to call/)
})

test('16. telling the board where the code lives exports the crew there straight away', async () => {
  const code = fs.mkdtempSync(path.join(HOME, 'late-path-'))
  fs.mkdirSync(path.join(code, '.claude', 'agents'), { recursive: true })
  fs.writeFileSync(path.join(code, '.claude', 'agents', 'mine.md'), 'not SpecDrive')
  // The agents already exist; only the path is new.
  const p = await call('create_project', { name: 'Late path app', one_liner: 'x', idea: 'x' })
  const r = await call('set_codebase_path', { project: idOf(p), codebase_path: code })
  assert.equal(r.isError, false, r.text)
  const written = fs.readdirSync(path.join(code, '.claude', 'agents'))
  assert.ok(
    written.some((f) => f.startsWith('specdrive-')),
    `nothing was exported after the path was set: ${written.join(', ')}`
  )
  assert.equal(fs.readFileSync(path.join(code, '.claude', 'agents', 'mine.md'), 'utf8'), 'not SpecDrive')
})
