import React, { useEffect, useState } from 'react'
import { Home } from './screens/Home'
import { Project } from './screens/Project'
import { ToastProvider } from './components/Toast'
import { useAgents, useProjects } from './lib/useLive'
import { PlaneIcon, BackIcon } from './components/Icons'

export default function App(): React.JSX.Element {
  const { projects, loaded } = useProjects()
  const { agents, connect, refresh } = useAgents()
  const [openId, setOpenId] = useState<string | null>(null)

  // A brand-new project created by the agent while we're on Home? Jump into it.
  const prevCount = React.useRef<number>(-1)
  useEffect(() => {
    if (!loaded) return
    if (prevCount.current >= 0 && projects.length === prevCount.current + 1 && openId === null) {
      const newest = projects.reduce((a, b) =>
        a.project.createdAt > b.project.createdAt ? a : b
      )
      setOpenId(newest.project.id)
    }
    prevCount.current = projects.length
  }, [projects, loaded, openId])

  // Automated visual checks can force a project open.
  useEffect(() => {
    const h = (e: Event): void => setOpenId((e as CustomEvent<string>).detail)
    window.addEventListener('specdrive:open-project', h)
    return () => window.removeEventListener('specdrive:open-project', h)
  }, [])

  const open = openId ? projects.find((p) => p.project.id === openId) : undefined

  return (
    <ToastProvider>
      <div className="drag-strip" />
      <div style={{ padding: '0 36px' }}>
        <nav className="nav-capsule">
          <button
            className="brand"
            onClick={() => {
              setOpenId(null)
              refresh()
            }}
          >
            <span className="brand-orb">
              <PlaneIcon />
            </span>
            SpecDrive
          </button>
          <div className="nav-right">
            {open ? (
              <button
                className="pill pill-quiet"
                onClick={() => setOpenId(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <BackIcon />
                All projects
              </button>
            ) : (
              <span>Free · works with your AI agents</span>
            )}
          </div>
        </nav>
      </div>
      {open ? (
        <Project bundle={open} onBack={() => setOpenId(null)} />
      ) : (
        <Home projects={projects} agents={agents} connect={connect} openProject={setOpenId} />
      )}
    </ToastProvider>
  )
}
