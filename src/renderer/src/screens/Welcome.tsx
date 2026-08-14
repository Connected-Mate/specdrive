import React from 'react'

/** Main pane when no project is selected — fits the viewport, no scroll. */
export function Welcome(): React.JSX.Element {
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="copy">
          <h1>
            Your idea,
            <br />
            built properly.
          </h1>
          <p>
            Describe what you want to build — no tech skills needed. Your AI agent fills this space
            with a real plan, challenges it, researches it, then builds it step by step. You watch
            it all happen, live.
          </p>
        </div>
        <div className="art">
          <img src="images/robot-dusk.png" alt="" />
        </div>
      </div>
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
