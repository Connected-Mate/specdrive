// The install path, tested on a simulated Mac with NO node — the machine where
// SpecDrive's own binary has to stand in for it. That is the case that opened
// three copies of the app instead of serving the board.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '..', 'src', 'main', 'agents.ts')
const APP_BIN = '/Applications/SpecDrive.app/Contents/MacOS/SpecDrive'
const SERVER = '/Applications/SpecDrive.app/Contents/Resources/mcp/server.mjs'

let HOME
let agents
let CFG

before(async () => {
  HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'specdrive-agents-'))
  process.env.HOME = HOME
  process.env.PATH = '/nonexistent' // no node anywhere
  const bundle = path.join(HOME, 'agents.mjs')
  await esbuild.build({ entryPoints: [SRC], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' })
  agents = await import(bundle)
  CFG = path.join(HOME, '.codex', 'config.toml')
})
after(() => fs.rmSync(HOME, { recursive: true, force: true })) // our own temp dir only

test('1. with no node, the stand-in binary is written WITH the flag that makes it behave as node', async () => {
  fs.mkdirSync(path.dirname(CFG), { recursive: true })
  fs.writeFileSync(CFG, '[mcp_servers.other]\ncommand = "/bin/echo"\nargs = ["hi"]\n')
  await agents.connectAgent('codex-cli', SERVER)
  const raw = fs.readFileSync(CFG, 'utf8')
  assert.match(raw, /\[mcp_servers\.specdrive\]/)
  assert.match(raw, /\[mcp_servers\.other\]/, 'another server was lost')
  // The fallback is process.execPath; whatever it is, it must carry the flag.
  assert.match(raw, /ELECTRON_RUN_AS_NODE = "1"/, 'the stand-in was written without the flag — the agent would open the app instead')
})

test('2. connecting twice does not stack a second block', async () => {
  await agents.connectAgent('codex-cli', SERVER)
  const raw = fs.readFileSync(CFG, 'utf8')
  assert.equal(raw.split('[mcp_servers.specdrive]').length - 1, 1)
})

test('3. a config that would open the app is never reported as connected', async () => {
  fs.writeFileSync(CFG, `[mcp_servers.specdrive]\ncommand = "${APP_BIN}"\nargs = ["${SERVER}"]\n`)
  const list = await agents.detectAgents(SERVER)
  assert.equal(list.find((a) => a.id === 'codex-cli').connected, false)
  const v = await agents.verifyAgent('codex-cli')
  assert.equal(v.ok, false)
})

test('4. the same config WITH the flag is accepted as connected', async () => {
  fs.writeFileSync(
    CFG,
    `[mcp_servers.specdrive]\ncommand = "${process.execPath}"\nargs = ["${SERVER}"]\nenv = { ELECTRON_RUN_AS_NODE = "1" }\n`
  )
  const list = await agents.detectAgents(SERVER)
  assert.equal(list.find((a) => a.id === 'codex-cli').connected, true)
})
