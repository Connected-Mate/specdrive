export interface PresetRule {
  title: string
  content: string
}

export type PresetKey = 'security' | 'design' | 'structure'

export const RULE_PRESETS: Record<PresetKey, PresetRule[]>
export const PRESET_KEYS: PresetKey[]
export const PRESET_LABEL: Record<PresetKey, string>
