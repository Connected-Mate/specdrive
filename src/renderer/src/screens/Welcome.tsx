import React from 'react'
import { CursorScene } from '@/components/scene/CursorScene'

/** Main pane when no project is selected — the multiplayer moment, no scroll. */
export function Welcome(): React.JSX.Element {
  return (
    <div className="welcome">
      <CursorScene word="SpecDrive" />
      <div className="welcome-steps">
        <div className="wstep">
          <span className="num">1</span>
          <div>
            <h3>Connect an agent</h3>
            <p>One click in the sidebar links SpecDrive to the AI tools already on your Mac.</p>
          </div>
        </div>
        <div className="wstep">
          <span className="num">2</span>
          <div>
            <h3>Tell it your idea</h3>
            <p>Copy the starter prompt on the right, paste it into your agent, and just talk.</p>
          </div>
        </div>
        <div className="wstep">
          <span className="num">3</span>
          <div>
            <h3>Follow the loop</h3>
            <p>Challenge, research, hard parts, plan — then build, one checked-off step at a time.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
