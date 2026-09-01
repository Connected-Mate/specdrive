import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Welcome } from './screens/Welcome'
import { Project } from './screens/Project'
import { Sidebar } from './components/Sidebar'
import { GuideRail } from './components/GuideRail'
import { ToastProvider } from './components/Toast'
import { useAgents, useProjects } from './lib/useLive'
import { SidebarIcon } from './components/Icons'
import { EasterEgg } from './components/scene/EasterEgg'
import { SearchOverlay } from './components/SearchOverlay'

const SIDE_KEY = 'specdrive-sidebar'
const NARROW = 1080

export default function App(): React.JSX.Element {
  const { projects, loaded } = useProjects()
  const { agents, connect } = useAgents()
  const [openId, setOpenId] = useState<string | null>(null)
  const [eggOn, setEggOn] = useState(false)
  const [searchOn, setSearchOn] = useState(false)

  // Fullscreen hides the traffic lights — collapse the space kept for them.
  useEffect(() => {
    return window.specdrive.onFullScreenChanged((on) => {
      document.body.classList.toggle('is-fullscreen', on)
    })
  }, [])
  const [sideOpen, setSideOpen] = useState<boolean>(() => {
    if (window.innerWidth < NARROW) return false
    return localStorage.getItem(SIDE_KEY) !== 'closed'
  })

  const toggleSide = useCallback(() => {
    setSideOpen((v) => {
      localStorage.setItem(SIDE_KEY, v ? 'closed' : 'open')
      return !v
    })
  }, [])

  // Auto-collapse on narrow windows; restore the user's preference when wide again.
  useEffect(() => {
    const onResize = (): void => {
      if (window.innerWidth < NARROW) setSideOpen(false)
      else setSideOpen(localStorage.getItem(SIDE_KEY) !== 'closed')
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Cmd+\ toggles the sidebar; Cmd+F opens search — like native Mac apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key === '\\') {
        e.preventDefault()
        toggleSide()
      }
      if (e.metaKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOn(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSide])

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

  // First launch with existing projects: open the most recent one.
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
      <div className={`shell${sideOpen ? '' : ' side-closed'}`}>
        <Sidebar
          projects={projects}
          agents={agents}
          openId={open ? open.project.id : null}
          onSelect={setOpenId}
          connect={connect}
          onEgg={() => setEggOn(true)}
        />
        {open ? (
          <Project key={open.project.id} bundle={open} />
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
        {eggOn && <EasterEgg onClose={() => setEggOn(false)} />}
        {searchOn && (
          <SearchOverlay
            projects={projects}
            onClose={() => setSearchOn(false)}
            onJump={(id) => {
              setOpenId(id)
              setSearchOn(false)
            }}
          />
        )}
        <button
          className="side-toggle"
          title="Hide or show the sidebar (⌘\)"
          aria-label="Toggle sidebar"
          onClick={toggleSide}
        >
          <SidebarIcon />
        </button>
      </div>
    </ToastProvider>
  )
}
