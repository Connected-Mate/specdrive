import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Welcome } from './screens/Welcome'
import { Project } from './screens/Project'
import { Settings } from './screens/Settings'
import { FolderScreen } from './screens/FolderScreen'
import { CrewScreen } from './screens/CrewScreen'
import { Sidebar } from './components/Sidebar'
import { GuideRail } from './components/GuideRail'
import { ToastProvider } from './components/Toast'
import { useAgents, useFolders, useProjects } from './lib/useLive'
import { RailIcon, SidebarIcon } from './components/Icons'
import { EasterEgg } from './components/scene/EasterEgg'
import { SearchOverlay } from './components/SearchOverlay'

const SIDE_KEY = 'specdrive-sidebar'
const RAIL_KEY = 'specdrive-rail'
const NARROW = 1080

export default function App(): React.JSX.Element {
  const { projects, loaded } = useProjects()
  const { agents, connect } = useAgents()
  const { folders } = useFolders()
  const [openId, setOpenId] = useState<string | null>(null)
  const [eggOn, setEggOn] = useState(false)
  const [searchOn, setSearchOn] = useState(false)
  // Settings is a sheet over the board (⌘,). A house (folder) is a page of its
  // own, like a project: 'new' for a blank one, or the folder's id.
  // 'open' → 'closing' (exit animation plays) → unmounted.
  const [settingsState, setSettingsState] = useState<'closed' | 'open' | 'closing'>('closed')
  const settingsOn = settingsState !== 'closed'
  const closeSettings = useCallback(() => {
    setSettingsState((s) => (s === 'open' ? 'closing' : s))
  }, [])
  useEffect(() => {
    if (settingsState !== 'closing') return
    const t = setTimeout(() => setSettingsState('closed'), 240)
    return () => clearTimeout(t)
  }, [settingsState])
  const [folderId, setFolderId] = useState<string | 'new' | null>(null)
  // The Agents (crew) screen: a page of its own, like a house — 'on' shows it,
  // and it remembers which agent was last open so a jump from a house or a
  // project (an "Agents of this house" card, a project's agent strip) lands on
  // the right one.
  const [crewOn, setCrewOn] = useState(false)
  const [crewAgentId, setCrewAgentId] = useState<string | null>(null)
  const selectProject = useCallback((id: string | null) => {
    setFolderId(null)
    setCrewOn(false)
    setOpenId(id)
  }, [])
  const openFolder = useCallback((id: string | 'new') => {
    setOpenId(null)
    setCrewOn(false)
    setFolderId(id)
  }, [])
  const openCrew = useCallback((agentId?: string | null) => {
    setOpenId(null)
    setFolderId(null)
    setCrewOn(true)
    if (agentId !== undefined) setCrewAgentId(agentId)
  }, [])
  // The open house was deleted (here or by an agent): back to the welcome screen.
  useEffect(() => {
    if (folderId && folderId !== 'new' && folders.length && !folders.some((f) => f.id === folderId)) {
      setFolderId(null)
    }
  }, [folders, folderId])

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

  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const toggleRail = useCallback(() => {
    setRailOpen((v) => {
      try {
        localStorage.setItem(RAIL_KEY, v ? 'closed' : 'open')
      } catch {}
      return !v
    })
  }, [])
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

  // Cmd+\ toggles the sidebar, Cmd+Shift+\ the guide; Cmd+F opens search —
  // like native Mac apps. Both panes answer to the same key, mirrored.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && (e.key === '\\' || e.key === '|')) {
        e.preventDefault()
        if (e.shiftKey) toggleRail()
        else toggleSide()
      }
      if (e.metaKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOn(true)
      }
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        setSettingsState((s) => (s === 'open' ? 'closing' : 'open'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSide, toggleRail])

  // A brand-new project created by the agent? Jump into it — the magic moment.
  const prevCount = useRef<number>(-1)
  useEffect(() => {
    if (!loaded) return
    if (prevCount.current >= 0 && projects.length === prevCount.current + 1) {
      const newest = projects.reduce((a, b) =>
        a.project.createdAt > b.project.createdAt ? a : b
      )
      setFolderId(null)
      setCrewOn(false)
      setOpenId(newest.project.id)
    }
    prevCount.current = projects.length
  }, [projects, loaded])

  // A house an AGENT just created over MCP? Jump into it, the same way a new
  // project opens itself — the owner asked for it in their chat, they should
  // land on it.
  const prevFolders = useRef<number>(-1)
  useEffect(() => {
    if (prevFolders.current >= 0 && folders.length === prevFolders.current + 1) {
      const newest = folders.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
      setOpenId(null)
      setCrewOn(false)
      setFolderId(newest.id)
    }
    prevFolders.current = folders.length
  }, [folders])

  // First launch with existing projects: open the most recent one. The first
  // load can take a second or two (it asks git whether each codebase moved), so
  // the owner may already have opened Agents or a house by the time it lands —
  // never yank them back to a project they did not ask for.
  const booted = useRef(false)
  useEffect(() => {
    if (loaded && !booted.current) {
      booted.current = true
      if (crewOn || folderId) return
      if (projects.length) setOpenId(projects[0].project.id)
    }
  }, [loaded, projects, crewOn, folderId])

  // Automated visual checks can force a project open. It wins over the
  // first-launch auto-open, which may still be waiting on the project list.
  useEffect(() => {
    const h = (e: Event): void => {
      booted.current = true
      setFolderId(null)
      setCrewOn(false)
      setOpenId((e as CustomEvent<string>).detail)
    }
    window.addEventListener('specdrive:open-project', h)
    return () => window.removeEventListener('specdrive:open-project', h)
  }, [])

  const open = openId ? projects.find((p) => p.project.id === openId) : undefined

  return (
    <ToastProvider>
      <div className={`shell${sideOpen ? '' : ' side-closed'}${railOpen ? '' : ' rail-closed'}`}>
        <Sidebar
          projects={projects}
          agents={agents}
          openId={open ? open.project.id : null}
          onSelect={selectProject}
          connect={connect}
          onEgg={() => setEggOn(true)}
          onToggleSide={toggleSide}
          onOpenSettings={() => setSettingsState('open')}
          settingsOpen={settingsState === 'open'}
          onOpenFolder={openFolder}
          activeFolderId={folderId}
          onOpenCrew={() => openCrew()}
          crewActive={crewOn}
        />
        {/* One strip, one vocabulary: the same button closes the pane on its
            own side, on every screen. */}
        <div className="content-top">
          <button
            className={`pane-toggle${sideOpen ? ' on' : ''}`}
            title={sideOpen ? 'Hide the sidebar (⌘\\)' : 'Show the sidebar (⌘\\)'}
            aria-label={sideOpen ? 'Hide the sidebar' : 'Show the sidebar'}
            aria-pressed={sideOpen}
            onClick={toggleSide}
          >
            <SidebarIcon />
          </button>
          <button
            className={`pane-toggle${railOpen ? ' on' : ''}`}
            title={railOpen ? 'Hide the guide (⌘⇧\\)' : 'Show the guide (⌘⇧\\)'}
            aria-label={railOpen ? 'Hide the guide' : 'Show the guide'}
            aria-pressed={railOpen}
            onClick={toggleRail}
          >
            <RailIcon />
          </button>
        </div>
        {crewOn ? (
          <CrewScreen
            projects={projects}
            openId={crewAgentId}
            onSelect={setCrewAgentId}
          />
        ) : folderId ? (
          <FolderScreen
            folder={folderId === 'new' ? null : (folders.find((f) => f.id === folderId) ?? null)}
            projects={projects}
            onCreated={(id) => setFolderId(id)}
            onGone={() => setFolderId(null)}
            onOpenFolder={openFolder}
            onOpenProject={selectProject}
            onOpenAgent={(id) => openCrew(id)}
          />
        ) : open ? (
          <Project key={open.project.id} bundle={open} />
        ) : (
          <main className="content">
            <div className="content-head">
              <div className="content-title">
                <h1>Welcome</h1>
              </div>
            </div>
            <Welcome onOpenProject={selectProject} />
          </main>
        )}
        <GuideRail
          bundle={open ?? null}
          crewView={crewOn}
          folderView={
            folderId === 'new'
              ? { kind: 'new' }
              : folderId
                ? (() => {
                    const f = folders.find((x) => x.id === folderId)
                    return f ? { kind: 'existing' as const, folder: f } : null
                  })()
                : null
          }
        />
        {settingsOn && (
          <Settings
            agents={agents}
            connect={connect}
            closing={settingsState === 'closing'}
            onClose={closeSettings}
          />
        )}
        {eggOn && <EasterEgg onClose={() => setEggOn(false)} />}
        {searchOn && (
          <SearchOverlay
            projects={projects}
            onClose={() => setSearchOn(false)}
            onJump={(id) => {
              selectProject(id)
              setSearchOn(false)
            }}
          />
        )}
      </div>
    </ToastProvider>
  )
}
