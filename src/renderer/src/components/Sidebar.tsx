import React, { useEffect, useState } from 'react'
import type { DetectedAgent, Folder, ProjectBundle } from '@shared/types'
import { useToast } from './Toast'
import { PHASE_COLOR } from '@/lib/phaseColors'
import { FolderIcon, FolderPlusIcon, GearIcon, PlusIcon } from './Icons'
import { timeAgo, useFolders } from '@/lib/useLive'
import { canParent, chainLabel, houseChain } from '@shared/house-chain.mjs'
import { AgentsPanel } from './AgentsPanel'

const PHASE_SHORT: Record<string, string> = {
  capture: 'Capturing idea',
  challenge: 'Challenging',
  research: 'Researching',
  risks: 'Hard parts',
  plan: 'Planning',
  build: 'Building',
  done: 'Built'
}

const DRAG_TYPE = 'application/x-specdrive-project'
// Houses nest, so a house is draggable too: drop it on another house to put it
// inside, or on the "take it out" strip to bring it back to the top level.
const FOLDER_DRAG_TYPE = 'application/x-specdrive-folder'

export function Sidebar({
  projects,
  agents,
  openId,
  onSelect,
  connect,
  onEgg,
  onToggleSide,
  onOpenSettings,
  settingsOpen,
  onOpenFolder,
  activeFolderId
}: {
  projects: ProjectBundle[]
  agents: DetectedAgent[]
  openId: string | null
  onSelect: (id: string | null) => void
  connect: (id: DetectedAgent['id']) => Promise<void>
  onEgg: () => void
  onToggleSide: () => void
  onOpenSettings: () => void
  settingsOpen: boolean
  /** Open a house page: an existing folder's id, or 'new' for a blank one */
  onOpenFolder: (id: string | 'new') => void
  activeFolderId: string | 'new' | null
}): React.JSX.Element {
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<string | null>(null)
  // Which project's "put it in a folder" menu is open, if any.
  const [movingId, setMovingId] = useState<string | null>(null)
  // Drag and drop: what is being dragged (a project or a whole house), and the
  // folder under the pointer.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragFolderId, setDragFolderId] = useState<string | null>(null)
  const [overFolder, setOverFolder] = useState<string | 'none' | null>(null)
  const { folders } = useFolders()
  const readFolder = (id: string): Folder | null => folders.find((f) => f.id === id) ?? null

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(null), 3500)
    return () => clearTimeout(t)
  }, [confirmDelete])

  useEffect(() => {
    if (!confirmDeleteFolder) return
    const t = setTimeout(() => setConfirmDeleteFolder(null), 3500)
    return () => clearTimeout(t)
  }, [confirmDeleteFolder])

  // The move menu is a light popover: any click elsewhere closes it.
  useEffect(() => {
    if (!movingId) return
    const close = (): void => setMovingId(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [movingId])

  const moveTo = async (b: ProjectBundle, folderId: string | null): Promise<void> => {
    setMovingId(null)
    if ((b.project.folderId ?? null) === folderId) return
    const err = await window.specdrive.assignProjectFolder(b.project.id, folderId)
    if (err) {
      toast(err)
      return
    }
    const target = folderId ? folders.find((f) => f.id === folderId) : null
    toast(
      target
        ? `“${b.project.name}” moved into ${target.name} — its house rules now apply`
        : `“${b.project.name}” is on its own again`
    )
  }

  /** Move a whole house inside another one (or back to the top level). */
  const moveHouse = async (house: Folder, parentId: string | null): Promise<void> => {
    if ((house.parentId ?? null) === parentId) return
    const err = await window.specdrive.moveFolder(house.id, parentId)
    if (err) {
      toast(err)
      return
    }
    const target = parentId ? readFolder(parentId) : null
    toast(
      target
        ? `“${house.name}” now lives inside ${target.name} — its rules apply here too`
        : `“${house.name}” is a house of its own again`
    )
  }

  const dropOn = (folderId: string | null) => (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const houseId = e.dataTransfer.getData(FOLDER_DRAG_TYPE) || dragFolderId
    const id = e.dataTransfer.getData(DRAG_TYPE) || (houseId ? '' : dragId)
    setOverFolder(null)
    setDragId(null)
    setDragFolderId(null)
    if (houseId) {
      const house = readFolder(houseId)
      if (house) void moveHouse(house, folderId)
      return
    }
    const b = projects.find((p) => p.project.id === id)
    if (b) void moveTo(b, folderId)
  }
  const dragOver = (key: string | 'none') => (e: React.DragEvent) => {
    if (!dragId && !dragFolderId) return
    // A house cannot be dropped into itself or into one of its own sub-houses.
    if (dragFolderId && key !== 'none' && canParent(dragFolderId, key, readFolder, folders)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (overFolder !== key) setOverFolder(key)
  }

  // Houses nest, so the sidebar is a TREE: sub-houses inside their house,
  // projects under the house they belong to, loose projects at the bottom.
  const known = new Set(folders.map((f) => f.id))
  const childHouses = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const parent = f.parentId && known.has(f.parentId) ? f.parentId : null
    const list = childHouses.get(parent) ?? []
    list.push(f)
    childHouses.set(parent, list)
  }
  const houseProjects = new Map<string, ProjectBundle[]>()
  const loose: ProjectBundle[] = []
  for (const b of projects) {
    const fid = b.project.folderId
    if (fid && known.has(fid)) {
      const list = houseProjects.get(fid) ?? []
      list.push(b)
      houseProjects.set(fid, list)
    } else loose.push(b)
  }
  const dragged = dragId ? projects.find((p) => p.project.id === dragId) : undefined
  const draggedHouse = dragFolderId ? readFolder(dragFolderId) : null

  let i = 0
  const projectRow = (b: ProjectBundle, depth = 0): React.JSX.Element => {
    const done = b.tasks.filter((t) => t.status === 'done').length
    const confirming = confirmDelete === b.project.id
    const idx = i++
    return (
      <div
        key={b.project.id}
        role="button"
        tabIndex={0}
        draggable
        className={`side-item${openId === b.project.id ? ' active' : ''}${movingId === b.project.id ? ' picking' : ''}${dragId === b.project.id ? ' dragging' : ''}`}
        style={{ '--i': idx, '--depth': depth } as React.CSSProperties}
        onClick={() => onSelect(b.project.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSelect(b.project.id)
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, b.project.id)
          e.dataTransfer.effectAllowed = 'move'
          setDragId(b.project.id)
          setMovingId(null)
        }}
        onDragEnd={() => {
          setDragId(null)
          setOverFolder(null)
        }}
      >
        <span className="name">{b.project.name}</span>
        <span className="sub">
          <span
            className="phase-dot"
            style={{ '--phase-color': PHASE_COLOR[b.project.phase] } as React.CSSProperties}
          />
          {PHASE_SHORT[b.project.phase]}
          {b.tasks.length > 0 && ` · ${done}/${b.tasks.length}`}
          {' · '}
          {timeAgo(b.project.updatedAt)}
        </span>
        <button
          className="side-move"
          aria-label={`Move ${b.project.name} to a folder`}
          title="Put this project in a folder"
          onClick={(e) => {
            e.stopPropagation()
            setMovingId(movingId === b.project.id ? null : b.project.id)
          }}
        >
          <FolderIcon />
        </button>
        {movingId === b.project.id && (
          <div className="side-picker" onClick={(e) => e.stopPropagation()}>
            <p className="side-picker-title">Put this project in…</p>
            {folders.map((f) => (
              <button
                key={f.id}
                className={`side-picker-row${b.project.folderId === f.id ? ' current' : ''}`}
                onClick={() => moveTo(b, f.id)}
              >
                <span className="side-picker-name">
                  {chainLabel(houseChain(f.id, readFolder), ' › ')}
                </span>
                {f.rules.length > 0 && (
                  <span className="side-picker-count">
                    {f.rules.length} rule{f.rules.length > 1 ? 's' : ''}
                  </span>
                )}
              </button>
            ))}
            {b.project.folderId && (
              <button className="side-picker-row" onClick={() => moveTo(b, null)}>
                <span className="side-picker-name">No folder</span>
              </button>
            )}
            <button
              className="side-picker-row new"
              onClick={() => {
                setMovingId(null)
                onOpenFolder('new')
              }}
            >
              <span className="side-picker-name">+ New folder…</span>
            </button>
            <div className="side-picker-sep" />
            <button
              className="side-picker-row quiet"
              onClick={() => {
                setMovingId(null)
                window.specdrive.revealProject(b.project.id)
              }}
            >
              <span className="side-picker-name">Show its files in Finder</span>
            </button>
          </div>
        )}
        <button
          className={`side-delete${confirming ? ' confirming' : ''}`}
          aria-label={confirming ? `Really delete ${b.project.name}` : `Delete ${b.project.name}`}
          onClick={async (e) => {
            e.stopPropagation()
            if (!confirming) {
              setConfirmDelete(b.project.id)
              return
            }
            setConfirmDelete(null)
            await window.specdrive.deleteProject(b.project.id)
            if (openId === b.project.id) onSelect(null)
            toast(`"${b.project.name}" moved to SpecDrive's trash`)
          }}
        >
          {confirming ? 'Sure?' : '✕'}
        </button>
      </div>
    )
  }

  /** One house and everything under it — sub-houses first, then its projects. */
  const houseBranch = (folder: Folder, depth: number): React.JSX.Element => {
    const kids = childHouses.get(folder.id) ?? []
    const items = houseProjects.get(folder.id) ?? []
    const refused = dragFolderId ? canParent(dragFolderId, folder.id, readFolder, folders) : ''
    return (
      <div
        key={folder.id}
        className={`side-folder${activeFolderId === folder.id ? ' active' : ''}${overFolder === folder.id ? ' drop-over' : ''}${depth ? ' nested' : ''}${confirmDeleteFolder === folder.id ? ' confirming' : ''}`}
        style={{ '--depth': depth } as React.CSSProperties}
        onDragOver={dragOver(folder.id)}
        onDragLeave={() => {
          if (overFolder === folder.id) setOverFolder('none')
        }}
        onDrop={dropOn(folder.id)}
      >
        <button
          className={`side-folder-head${dragFolderId === folder.id ? ' dragging' : ''}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id)
            e.dataTransfer.effectAllowed = 'move'
            setDragFolderId(folder.id)
            setMovingId(null)
          }}
          onDragEnd={() => {
            setDragFolderId(null)
            setOverFolder(null)
          }}
          onClick={() => onOpenFolder(folder.id)}
          title={
            dragFolderId && refused
              ? refused
              : folder.description || 'Open this house and its rules — drag it onto another house to nest it'
          }
        >
          <span className="side-folder-icon">
            <FolderIcon size={12} />
          </span>
          <span className="side-folder-name">{folder.name}</span>
          <span className="side-folder-rules">
            {folder.rules.length === 0 ? 'no rules' : `${folder.rules.length} rule${folder.rules.length > 1 ? 's' : ''}`}
          </span>
        </button>
        <button
          className={`side-folder-delete${confirmDeleteFolder === folder.id ? ' confirming' : ''}`}
          aria-label={confirmDeleteFolder === folder.id ? `Really delete ${folder.name}` : `Delete ${folder.name}`}
          title="Delete this house — what is inside moves up, nothing is lost"
          onClick={async (e) => {
            e.stopPropagation()
            if (confirmDeleteFolder !== folder.id) {
              setConfirmDeleteFolder(folder.id)
              return
            }
            setConfirmDeleteFolder(null)
            const inside = projects.filter((b) => b.project.folderId === folder.id).length
            const subs = folders.filter((f) => f.parentId === folder.id).length
            const err = await window.specdrive.deleteFolder(folder.id)
            if (err) {
              toast(err)
              return
            }
            if (activeFolderId === folder.id) onSelect(null)
            const moved = [
              inside ? `${inside} project${inside > 1 ? 's' : ''}` : '',
              subs ? `${subs} house${subs > 1 ? 's' : ''}` : ''
            ].filter(Boolean)
            toast(moved.length ? `“${folder.name}” deleted — ${moved.join(' and ')} moved up` : `“${folder.name}” deleted`)
          }}
        >
          {confirmDeleteFolder === folder.id ? 'Sure?' : '✕'}
        </button>
        {kids.map((k) => houseBranch(k, depth + 1))}
        {items.map((b) => projectRow(b, depth + 1))}
        {kids.length === 0 && items.length === 0 && (
          <p className="side-folder-empty" style={{ '--depth': depth + 1 } as React.CSSProperties}>
            {dragId ? 'Drop it here' : 'Empty — drag a project in'}
          </p>
        )}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <button className="sidebar-brand" onClick={() => onSelect(null)} onDoubleClick={onEgg}>
        <span className="brand-stamp">
          SpecDrive
          <span className="brand-cursor" aria-hidden>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path
                d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L5.94 2.47a.5.5 0 0 0-.44.74Z"
                fill="#7b7ed8"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <span className="brand-cursor-pill">agents</span>
          </span>
        </span>
      </button>

      <div className="sidebar-label-row">
        <span className="sidebar-label">Projects</span>
        <span className="sidebar-label-actions">
          <button
            className="sidebar-iconbtn"
            title="New project"
            aria-label="New project"
            onClick={() => onSelect(null)}
          >
            <PlusIcon />
          </button>
          <button
            className={`sidebar-iconbtn${activeFolderId === 'new' ? ' active' : ''}`}
            title="New folder — a house with rules every project inside follows"
            aria-label="New folder"
            onClick={() => onOpenFolder('new')}
          >
            <FolderPlusIcon />
          </button>
        </span>
      </div>

      <div
        className={`sidebar-projects${dragId ? ' dragging' : ''}${dragFolderId ? ' dragging-house' : ''}`}
        onDragOver={dragOver('none')}
        onDrop={dropOn(null)}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setOverFolder(null)
        }}
      >
        {(childHouses.get(null) ?? []).map((f) => houseBranch(f, 0))}
        {loose.map((b) => projectRow(b))}
        {((dragId && dragged?.project.folderId) || (dragFolderId && draggedHouse?.parentId)) && (
          <div className={`side-dropout${overFolder === 'none' ? ' drop-over' : ''}`}>
            {dragFolderId ? 'Drop here to make it a house of its own' : 'Drop here to take it out of its folder'}
          </div>
        )}
        {projects.length === 0 && folders.length === 0 && (
          <p className="side-empty">No project yet. Copy the starter prompt on the right and tell your agent your idea.</p>
        )}
      </div>

      <div className="sidebar-agents">
        <div className="sidebar-label" style={{ padding: '4px 10px 6px' }}>
          Your AI agents
        </div>
        <AgentsPanel agents={agents} connect={connect} />
      </div>

      <div className="sidebar-foot">
        <button
          className={`sidebar-settings${settingsOpen ? ' active' : ''}`}
          title="Settings (⌘,)"
          aria-label="Open settings"
          aria-pressed={settingsOpen}
          onClick={onOpenSettings}
        >
          <GearIcon />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
