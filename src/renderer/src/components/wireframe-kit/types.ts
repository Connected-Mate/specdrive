// Ported from BuilderIO/agent-native (ISC) — templates/plan/shared/plan-content.ts
// The lean kit-tree contract: the model emits semantic nodes, the stylesheet
// owns all visual quality. No geometry, no CSS in the tree.

export type PlanWireframeTone = 'default' | 'accent' | 'warn' | 'ok' | 'muted'

export type PlanWireframeElName =
  | 'screen'
  | 'browserBar'
  | 'statusBar'
  | 'toolbar'
  | 'row'
  | 'col'
  | 'sidebar'
  | 'navItem'
  | 'main'
  | 'title'
  | 'text'
  | 'lines'
  | 'section'
  | 'taskRow'
  | 'chips'
  | 'chip'
  | 'pill'
  | 'check'
  | 'field'
  | 'btn'
  | 'fab'
  | 'card'
  | 'column'
  | 'avatar'
  | 'iconSquare'
  | 'kv'
  | 'searchBar'
  | 'box'
  | 'divider'

export type PlanWireframeNode = {
  id?: string
  el: PlanWireframeElName
  children?: PlanWireframeNode[]

  // Generic content props
  text?: string
  value?: string
  label?: string
  placeholder?: string
  title?: string

  // Styling-by-intent (semantic only; renderer owns actual color/size)
  tone?: PlanWireframeTone
  color?: PlanWireframeTone
  weight?: 'normal' | 'medium' | 'bold'
  active?: boolean
  done?: boolean
  emphasis?: boolean
  full?: boolean
  solid?: boolean
  dashed?: boolean
  dot?: boolean
  script?: boolean
  area?: boolean
  shape?: 'square' | 'circle'

  // Numeric / structured props
  count?: number
  prio?: number
  n?: number
  widths?: number[]
  icon?: string

  // taskRow specifics
  note?: string
  due?: string
  dueTone?: PlanWireframeTone

  // Collection props (chips, kv)
  items?: Array<{ label: string; active?: boolean; count?: number; dot?: boolean }>
  rows?: Array<{ k: string; v: string }>
}
