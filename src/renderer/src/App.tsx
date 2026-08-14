import React, { useEffect, useRef, useState } from 'react'
import { Welcome } from './screens/Welcome'
import { Project } from './screens/Project'
import { Sidebar } from './components/Sidebar'
import { GuideRail } from './components/GuideRail'
import { ToastProvider } from './components/Toast'
import { useAgents, useProjects } from './lib/useLive'

export default function App(): React.JSX.Element {
  const { projects, loaded } = useProjects()
  const { agents, connect } = useAgents()
  const [openId, setOpenId] = useState<string | null>(null)

  // A brand-new project created by the agent? Jump into it — the magic moment.
  const prevCount = useRef<number>(-1)
  useEffect(() => {
    if (!loaded) return
    if (prevCount.current >= 0 && projects.length === prevCount.current + 1) {
      const newest = projects.reduce((a, b) =>
        a.project.createdAt > b.project.createdAt ? a : b
      )
      setOpenId(newest.project.id)
    }
    prevCount.current = projects.length
  }, [projects, loaded])

  // First launch with existing projects: open the most recent one (app, not landing page).
  const booted = useRef(false)
  useEffect(() => {
    if (loaded && !booted.current) {
      booted.current = true
      if (projects.length) setOpenId(projects[0].project.id)
    }
  }, [loaded, projects])

  // Automated visual checks can force a project open.
  useEffect(() => {
    const h = (e: Event): void => setOpenId((e as CustomEvent<string>).detail)
    window.addEventListener('specdrive:open-project', h)
    return () => window.removeEventListener('specdrive:open-project', h)
  }, [])

  const open = openId ? projects.find((p) => p.project.id === openId) : undefined

  return (
    <ToastProvider>
      <div className="shell">
        <Sidebar
          projects={projects}
          agents={agents}
          openId={open ? open.project.id : null}
          onSelect={setOpenId}
          connect={connect}
        />
        {open ? (
          <Project bundle={open} />
        ) : (
          <main className="content">
            <div className="content-head">
              <div className="content-title">
                <h1>Welcome</h1>
              </div>
            </div>
            <Welcome />
          </main>
        )}
        <GuideRail bundle={open ?? null} />
      </div>
    </ToastProvider>
  )
}
