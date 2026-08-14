import type { Phase } from '@shared/types'

/** Each phase owns one stop of the dusk gradient — the brand, systematized. */
export const PHASE_COLOR: Record<Phase, string> = {
  capture: '#4a7ff2',
  challenge: '#7b7ed8',
  research: '#c98ab5',
  risks: '#e8a87c',
  plan: '#d98d63',
  build: '#007aff',
  done: '#0a0a0a'
}
