import React from 'react'
import { renderNodes } from './registry'
import type { PlanWireframeNode } from './types'
import './plan-wireframe-tokens.css'

// Thin host for the agent-native wireframe kit: scoped tokens + density on a
// .plan-wf wrapper, Portal palette mapped via --plan-* vars in base.css.
export function KitWireframe({
  nodes,
  density = 'regular',
  fill = true
}: {
  nodes: PlanWireframeNode[]
  density?: 'compact' | 'regular' | 'cozy'
  /** false = natural content height (thumbnails); true = fill the host box */
  fill?: boolean
}): React.JSX.Element {
  return (
    <div className={`plan-wf specdrive-wf${fill ? '' : ' natural'}`} data-density={density}>
      {renderNodes(nodes)}
    </div>
  )
}
