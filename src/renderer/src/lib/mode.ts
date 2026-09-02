import type { Phase } from '@shared/types'
import { PHASE_COLOR } from './phaseColors'

// Two worlds, one app. Everything before the first line of code is SPEC —
// deciding what to build. Once the agent starts building, it is BUILD.
// The whole screen (band, tabs, rail headline) leans on this one distinction.

export type World = 'spec' | 'build'

/** Build starts at the "build" phase and stays there once shipped. */
export function worldOf(phase: Phase): World {
  return phase === 'build' || phase === 'done' ? 'build' : 'spec'
}

/** Calm ink for the build side — the spec side keeps the dusk phase hues,
 *  so the two halves never look alike. Blue stays the one action colour. */
export const BUILD_COLOR = '#2f3338'

export function worldColor(phase: Phase): string {
  return worldOf(phase) === 'build' ? BUILD_COLOR : PHASE_COLOR[phase]
}

export const WORLD_WORD: Record<World, string> = {
  spec: 'Spec',
  build: 'Build'
}

/** One plain sentence, shown next to the mode word. */
export const WORLD_LINE: Record<World, string> = {
  spec: 'Deciding what to build',
  build: 'Making it real'
}
