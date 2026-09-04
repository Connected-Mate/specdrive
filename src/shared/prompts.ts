import type { Phase } from './types'
import {
  START_PROMPT,
  ADOPT_PROMPT,
  CHALLENGE_PROMPT,
  RESEARCH_PROMPT,
  RISKS_PROMPT,
  PLAN_PROMPT,
  BUILD_PROMPT,
  AUTOBUILD_PROMPT,
  ITERATE_PROMPT,
  DEEP_DIVE_PROMPT,
  FOLDER_PROMPT,
  FOLDER_REVIEW_PROMPT,
  REFINE_SPECS_PROMPT
} from './prompt-texts.mjs'

// The copy-paste prompts SpecDrive hands the user at each step of the loop.
// The TEXTS live in prompt-texts.mjs, shared verbatim with the MCP server's
// native slash-command prompts — the two can no longer drift. This file only
// adds the app-side wrapper (connect-yourself guard + owner-facing titles).

export {
  START_PROMPT,
  ADOPT_PROMPT,
  AUTOBUILD_PROMPT,
  DEEP_DIVE_PROMPT,
  FOLDER_PROMPT,
  FOLDER_REVIEW_PROMPT,
  REFINE_SPECS_PROMPT
}

/** First line of every prompt — a non-technical owner cannot tell a role-played
 *  board from a real one, so the agent must refuse to improvise. If the tools
 *  are missing the agent CONNECTS ITSELF (paths injected by the app), so the
 *  owner never has to do anything technical. */
const TOOLS_GUARD = `FIRST, check whether the "specdrive" MCP tools are available in this session (try specdrive get_guidance).

IF THEY ARE AVAILABLE: skip this whole section and start the work below.

IF THEY ARE NOT, connect SpecDrive yourself — ONCE, never twice:
1. Look at your own MCP config first. If it ALREADY has a "specdrive" entry, do NOT write it again and do NOT tell me it is now installed: the entry exists, the tools are simply not loaded in this session. Go straight to step 3.
2. Otherwise add it, once:
   - Claude Code: run \`claude mcp add specdrive --scope user{{ENVFLAG}} -- "{{NODE}}" "{{SERVER}}"\`
   - Codex CLI: add to ~/.codex/config.toml
     [mcp_servers.specdrive]
     command = "{{NODE}}"
     args = ["{{SERVER}}"]{{TOMLENV}}
   - Any other agent: add an entry named "specdrive" to its MCP config with command "{{NODE}}" and args ["{{SERVER}}"]{{JSONENV}} (merge carefully, never remove other servers).
   Then read the file back and confirm the entry is really there.
3. Tell me, in plain words, exactly this and then STOP — do not continue, do not re-run step 2, do not repeat this message a second time:
   "SpecDrive is set up in your agent's configuration. This tool only reads that configuration when it starts, so please QUIT the agent completely and open it again — starting a new chat in the same session is not enough — then paste this prompt into the fresh session."
   For Codex CLI, say it plainly: quit the codex command entirely (Ctrl+C or exit) and start codex again.
4. If, in that fresh session, the tools are STILL missing, say so honestly and stop: "SpecDrive's configuration is written but your agent is not loading it. Open SpecDrive, go to Settings → AI agents, and press Test now — it will say what is wrong." Never loop, never invent the board, never role-play the tools.

Always talk to me in the language I write to you in.

`

export interface PhasePrompt {
  phase: Phase
  /** Short human title shown on the prompt card */
  title: string
  /** One plain-English sentence telling the user what this step does */
  forHumans: string
  /** Whether the user should ideally open a FRESH agent session for this step */
  freshSession: boolean
  prompt: string
}

export const PHASE_PROMPTS: PhasePrompt[] = [
  {
    phase: 'capture',
    title: 'Tell your idea',
    forHumans:
      'Open your AI agent, paste this, then just talk. Your specs will appear here as you speak.',
    freshSession: true,
    prompt: START_PROMPT
  },
  {
    phase: 'challenge',
    title: 'Challenge the specs',
    forHumans:
      'A fresh AI session plays devil’s advocate: it hunts for holes, contradictions and missing pieces.',
    freshSession: true,
    prompt: CHALLENGE_PROMPT
  },
  {
    phase: 'research',
    title: 'Research the field',
    forHumans:
      'The AI searches the web: similar products, proven solutions, open-source building blocks, pitfalls.',
    freshSession: true,
    prompt: RESEARCH_PROMPT
  },
  {
    phase: 'risks',
    title: 'Find the hard parts',
    forHumans:
      'The AI ranks what is genuinely difficult, so the tricky pieces get extra attention before building.',
    freshSession: true,
    prompt: RISKS_PROMPT
  },
  {
    phase: 'plan',
    title: 'Build the plan',
    forHumans:
      'The AI turns everything into an ordered step-by-step plan, plus simple sketches of the screens.',
    freshSession: true,
    prompt: PLAN_PROMPT
  },
  {
    phase: 'build',
    title: 'Build it',
    forHumans:
      'The AI codes step by step. Each finished step gets checked off here — you always see where it is.',
    freshSession: true,
    prompt: BUILD_PROMPT
  },
  {
    phase: 'done',
    title: 'Ship & iterate',
    forHumans:
      'Your product is built. Start a new loop any time: new ideas become new specs and new tasks.',
    freshSession: true,
    prompt: ITERATE_PROMPT
  }
]

export interface McpInfo {
  serverPath: string
  nodeBin: string
}

export function fillPrompt(
  template: string,
  projectName: string,
  topic?: string,
  mcp?: McpInfo
): string {
  const guarded = template.includes('{{NODE}}') ? template : TOOLS_GUARD + template
  // When SpecDrive's own binary stands in for Node (no Node on this Mac), every
  // config MUST carry ELECTRON_RUN_AS_NODE=1 — without it the agent launches a
  // second copy of the SpecDrive app instead of the board's server.
  const bin = mcp?.nodeBin ?? 'node'
  const standIn = /\.app\/Contents\/MacOS\//.test(bin)
  return guarded
    .replaceAll('{{PROJECT}}', projectName)
    .replaceAll('{{TOPIC}}', topic ?? '')
    .replaceAll('{{NODE}}', bin)
    .replaceAll('{{SERVER}}', mcp?.serverPath ?? '~/.specdrive/mcp/server.mjs')
    .replaceAll('{{ENVFLAG}}', standIn ? ' --env ELECTRON_RUN_AS_NODE=1' : '')
    .replaceAll('{{TOMLENV}}', standIn ? '\n     env = { ELECTRON_RUN_AS_NODE = "1" }' : '')
    .replaceAll('{{JSONENV}}', standIn ? ' and env {"ELECTRON_RUN_AS_NODE": "1"}' : '')
}

/** The folder prompts: the same "hand it to your agent" path projects have,
 *  for a new house or for refining an existing one. */
export function fillFolderPrompt(template: string, folderName: string, mcp?: McpInfo): string {
  return fillPrompt(template.replaceAll('{{FOLDER}}', folderName), '', undefined, mcp)
}
