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
  DEEP_DIVE_PROMPT
} from './prompt-texts.mjs'

// The copy-paste prompts SpecDrive hands the user at each step of the loop.
// The TEXTS live in prompt-texts.mjs, shared verbatim with the MCP server's
// native slash-command prompts — the two can no longer drift. This file only
// adds the app-side wrapper (connect-yourself guard + owner-facing titles).

export { START_PROMPT, ADOPT_PROMPT, AUTOBUILD_PROMPT, DEEP_DIVE_PROMPT }

/** First line of every prompt — a non-technical owner cannot tell a role-played
 *  board from a real one, so the agent must refuse to improvise. If the tools
 *  are missing the agent CONNECTS ITSELF (paths injected by the app), so the
 *  owner never has to do anything technical. */
const TOOLS_GUARD = `FIRST, verify the "specdrive" MCP tools are actually available in this session. If they are NOT available, connect SpecDrive yourself, without asking me to do anything:
- Claude Code: run \`claude mcp add specdrive --scope user -- "{{NODE}}" "{{SERVER}}"\`
- Any other agent: add to its MCP config an entry named "specdrive" with command "{{NODE}}" and args ["{{SERVER}}"] (merge carefully, never remove other servers).
Then tell me: "SpecDrive is now connected — please start a new chat and paste this prompt again." and STOP. Never simulate or role-play the spec board.

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
  return guarded
    .replaceAll('{{PROJECT}}', projectName)
    .replaceAll('{{TOPIC}}', topic ?? '')
    .replaceAll('{{NODE}}', mcp?.nodeBin ?? 'node')
    .replaceAll('{{SERVER}}', mcp?.serverPath ?? '~/.specdrive/mcp/server.mjs')
}
