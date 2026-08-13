import React from 'react'
import type { DetectedAgent, ProjectBundle } from '@shared/types'
import { START_PROMPT } from '@shared/prompts'
import { AgentChips } from '@/components/AgentChips'
import { PromptCard } from '@/components/PromptCard'
import { timeAgo } from '@/lib/useLive'

const PHASE_LABEL: Record<string, string> = {
  capture: 'Capturing the idea',
  challenge: 'Challenging the specs',
  research: 'Researching',
  risks: 'Finding the hard parts',
  plan: 'Planning',
  build: 'Building',
  done: 'Built'
}

export function Home({
  projects,
  agents,
  connect,
  openProject
}: {
  projects: ProjectBundle[]
  agents: DetectedAgent[]
  connect: (id: DetectedAgent['id']) => Promise<void>
  openProject: (id: string) => void
}): React.JSX.Element {
  const anyConnected = agents.some((a) => a.connected)
  const hasProjects = projects.length > 0

  return (
    <div className="page">
      {!hasProjects && (
        <section className="hero">
          <div className="hero-copy">
            <h1>
              Your idea,
              <br />
              built properly.
            </h1>
            <p>
              Describe what you want to build — in your own words, no tech skills needed. Your AI
              agent fills this board with a real plan, challenges it, researches it, then builds it
              step by step. You watch it all happen.
            </p>
            <div className="hero-actions">
              <a
                className="pill pill-white"
                href="#connect"
                style={{ textDecoration: 'none' }}
              >
                Get started
              </a>
            </div>
          </div>
          <div className="hero-art">
            <img src="images/robot-dusk.png" alt="" />
          </div>
        </section>
      )}

      {!hasProjects && (
        <section className="section">
          <div className="section-head">
            <h2>How it works</h2>
            <span className="aside">Three steps, five minutes</span>
          </div>
          <div className="steps">
            <div className="step">
              <div className="num">1</div>
              <h3>Connect your AI agent</h3>
              <p>
                One click links SpecDrive to the AI tools already on your Mac — Claude Code, Cursor
                and friends.
              </p>
            </div>
            <div className="step">
              <div className="num">2</div>
              <h3>Tell it your idea</h3>
              <p>
                Copy our starter prompt, paste it into your agent, and just talk. Every answer
                becomes a card on your board, live.
              </p>
            </div>
            <div className="step">
              <div className="num">3</div>
              <h3>Follow the loop</h3>
              <p>
                The board guides each round: challenge, research, find the hard parts, plan — then
                build, one checked-off step at a time.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className={hasProjects ? 'section-tight' : 'section'} id="connect">
        <div className="section-head" style={{ marginTop: hasProjects ? 36 : 0 }}>
          <h2>Your AI agents</h2>
          <span className="aside">Found on this Mac</span>
        </div>
        <AgentChips agents={agents} connect={connect} />
      </section>

      {anyConnected && (
        <section className="section">
          <div className="section-head">
            <h2>{hasProjects ? 'Start another project' : 'Start your first project'}</h2>
          </div>
          <PromptCard
            stepLabel="Step 1 — Tell your idea"
            title="Paste this into your AI agent, then just talk"
            forHumans="Open your connected agent (a fresh chat), paste the prompt, and describe what you want to build. This board will start filling itself while you speak."
            freshSession={false}
            prompt={START_PROMPT}
          />
        </section>
      )}

      {hasProjects && (
        <section className="section">
          <div className="section-head">
            <h2>Projects</h2>
            <span className="aside">
              {projects.length} project{projects.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="project-grid">
            {projects.map((b) => {
              const doneTasks = b.tasks.filter((t) => t.status === 'done').length
              return (
                <button
                  key={b.project.id}
                  className="project-card"
                  onClick={() => openProject(b.project.id)}
                >
                  <h3>{b.project.name}</h3>
                  <span className="one-liner">{b.project.oneLiner}</span>
                  <div className="meta">
                    <span className="badge badge-blue">
                      <span className="badge-dot" />
                      {PHASE_LABEL[b.project.phase]}
                    </span>
                    <span className="badge">
                      {b.specs.length} specs
                      {b.tasks.length ? ` · ${doneTasks}/${b.tasks.length} steps` : ''}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--smoke)' }}>
                    Updated {timeAgo(b.project.updatedAt)}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
