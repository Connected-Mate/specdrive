import { app, shell, BrowserWindow, ipcMain, clipboard, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import chokidar from 'chokidar'
import {
  listBundles,
  loadBundle,
  readWireframe,
  readDocument,
  deleteProject,
  ensureDataDirs,
  listSessions,
  DATA_DIR,
  PROJECTS_DIR
} from './store'
import { detectAgents, connectAgent, verifyAgent, mcpServerPath, nodeBinPath } from './agents'
import {
  readImage,
  addImage,
  addComment,
  setSyncAgentsMd,
  applyAgentsMdDefault,
  rerunChecks,
  listWaiting,
  listFolders,
  createFolder,
  updateFolder,
  moveFolder,
  setFolderRules,
  deleteFolder,
  assignProjectFolder,
  FOLDERS_DIR
} from './store'
import {
  CREW_DIR,
  agentBrief,
  attachCrew,
  attachCrewOne,
  createAgent,
  crewHouseOptions,
  deleteAgent,
  duplicateAgent,
  ensureCrewDir,
  listCrew,
  setAgentDisabled,
  setAgentScope,
  updateAgent
} from './crew'
import { readSettings, writeSettings } from './settings'
import { syncAllAgentsMd } from './agentsMd'
import { initUpdater, checkForUpdatesInteractive } from './updater'
import { checkForNotifications } from './notify'
import type { AgentDef, AgentId, AgentScope, AppSettings, FolderRule, OwnerComment } from '../shared/types'
import type { PresetKey } from '../shared/folder-presets.mjs'

const isDev = !app.isPackaged

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'SpecDrive',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#f7f7f7',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win?.show())

  // Fullscreen hides the traffic lights — tell the renderer so it can drop
  // the space reserved for them (the logo otherwise floats oddly low).
  const sendFs = (on: boolean): void => win?.webContents.send('window:fullscreen', on)
  win.on('enter-full-screen', () => sendFs(true))
  win.on('leave-full-screen', () => sendFs(false))
  win.webContents.on('did-finish-load', () => sendFs(win?.isFullScreen() ?? false))

  // Dev utility: SPECDRIVE_SHOT=/path.png [SPECDRIVE_ROUTE=projectId] captures a
  // screenshot of the app and exits — used for automated visual checks.
  const shotPath = isDev ? process.env.SPECDRIVE_SHOT : undefined
  if (shotPath) {
    win.webContents.on('did-finish-load', () => {
      const route = process.env.SPECDRIVE_ROUTE
      if (route) {
        setTimeout(() => {
          win?.webContents.executeJavaScript(
            `window.dispatchEvent(new CustomEvent('specdrive:open-project', { detail: ${JSON.stringify(route)} }))`
          )
        }, 1200)
      }
      const clickSel = process.env.SPECDRIVE_CLICK_SEL
      if (clickSel) {
        setTimeout(() => {
          win?.webContents.executeJavaScript(
            `document.querySelector(${JSON.stringify(clickSel)})?.click()`
          )
        }, 1400)
      }
      const tab = process.env.SPECDRIVE_TAB
      if (tab) {
        // Twice: the first list of projects can take a second to arrive, so the
        // screen that listens for this may not exist yet on the first try.
        for (const at of [800, 1800]) {
          setTimeout(() => {
            win?.webContents.executeJavaScript(
              `window.dispatchEvent(new CustomEvent('specdrive:open-tab', { detail: ${JSON.stringify(tab)} }))`
            )
          }, at)
        }
      }
      setTimeout(async () => {
        // Let the screen finish arriving BEFORE scrolling: content that is
        // still loading has nothing to scroll, and the scroll silently does
        // nothing. Settle, then scroll, then shoot.
        const settleFirst = Number(process.env.SPECDRIVE_SHOT_DELAY ?? 0)
        if (settleFirst) await new Promise((r) => setTimeout(r, settleFirst))
        const scroll = Number(process.env.SPECDRIVE_SCROLL ?? 0)
        if (scroll) {
          // Panes scroll themselves, so a check can name the one it means;
          // without a selector this scrolls the window, as it always did.
          const sel = process.env.SPECDRIVE_SCROLL_SEL
          await win!.webContents.executeJavaScript(
            sel
              ? `document.querySelector(${JSON.stringify(sel)})?.scrollTo(0, ${scroll})`
              : `window.scrollTo(0, ${scroll})`
          )
          await new Promise((r) => setTimeout(r, 400))
        }
        if (process.env.SPECDRIVE_CLICK) {
          const dbg = await win!.webContents.executeJavaScript(
            `(() => {
              const target = ${JSON.stringify(process.env.SPECDRIVE_CLICK)};
              const chips = [...document.querySelectorAll('.agent-chip')];
              const chip = chips.find((c) => c.textContent.includes(target));
              if (!chip) return 'chip not found: ' + chips.map((c) => c.textContent).join('|');
              const btn = chip.querySelector('button');
              if (!btn) return 'no button (already connected?): ' + chip.textContent;
              btn.click();
              return 'clicked ' + btn.textContent;
            })()`
          )
          console.log('DEBUG_CLICK', JSON.stringify(dbg))
          await new Promise((r) => setTimeout(r, 2500))
        }
        const img = await win!.webContents.capturePage()
        const fs = await import('node:fs')
        fs.writeFileSync(shotPath, img.toPNG())
        app.quit()
      }, 2200)
    })
  }

  const safeExternal = (url: string): void => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  }
  win.webContents.setWindowOpenHandler((details) => {
    safeExternal(details.url)
    return { action: 'deny' }
  })
  // The renderer is a local file; it never navigates anywhere.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !(isDev && url.startsWith('http://localhost'))) {
      e.preventDefault()
      safeExternal(url)
    }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/** Default macOS menu plus an explicit "Check for Updates…" — an automatic
 *  updater the user can't interrogate is indistinguishable from a broken one. */
function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        {
          label: 'Check for Updates…',
          click: () => {
            void checkForUpdatesInteractive()
          }
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  initUpdater()
  buildMenu()
  ensureDataDirs()
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    const devIcon = path.resolve(__dirname, '..', '..', 'resources', 'icon.png')
    try {
      app.dock.setIcon(devIcon)
    } catch {
      // cosmetic only
    }
  }
  const serverPath = mcpServerPath(__dirname, app.isPackaged)

  ipcMain.handle('projects:list', () => attachCrew(listBundles()))
  ipcMain.handle('sessions:list', () => listSessions())
  ipcMain.handle('mcp:info', async () => ({ serverPath, nodeBin: await nodeBinPath() }))
  ipcMain.handle('projects:get', (_e, id: string) => attachCrewOne(loadBundle(id)))
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id))
  ipcMain.handle('wireframe:read', (_e, projectId: string, file: string) =>
    readWireframe(projectId, file)
  )
  ipcMain.handle('document:read', (_e, projectId: string, file: string) =>
    readDocument(projectId, file)
  )
  ipcMain.handle('document:read-image', (_e, projectId: string, file: string) =>
    readImage(projectId, file)
  )
  ipcMain.handle('document:add-image', (_e, projectId: string, name: string, b64: string) =>
    addImage(projectId, name, b64)
  )
  ipcMain.handle(
    'comment:add',
    (_e, projectId: string, target: OwnerComment['target'], text: string) =>
      addComment(projectId, target, text)
  )
  ipcMain.handle('project:set-sync-agents-md', (_e, projectId: string, on: boolean) => {
    setSyncAgentsMd(projectId, on)
    scheduleAgentsMdSync()
  })
  ipcMain.handle('waiting:list', () => listWaiting())
  ipcMain.handle('project:rerun-checks', (_e, id: string) => rerunChecks(id))
  ipcMain.handle('project:reveal', (_e, id: string) => {
    const dir = path.join(PROJECTS_DIR, path.basename(id))
    if (fs.existsSync(dir)) shell.showItemInFolder(dir)
  })
  ipcMain.handle('agents:detect', () => detectAgents(serverPath))
  ipcMain.handle('agents:verify', (_e, id: AgentId) => verifyAgent(id))
  ipcMain.handle('agents:connect', async (_e, id: AgentId) => {
    await connectAgent(id, serverPath)
    const all = await detectAgents(serverPath)
    return all.find((a) => a.id === id)
  })
  // House folders — the same writes the MCP server makes for an agent, done by
  // the owner in the app. Every one of them returns a plain-words error string.
  ipcMain.handle('folders:list', () => listFolders())
  ipcMain.handle(
    'folders:create',
    (
      _e,
      name: string,
      description: string,
      rules: FolderRule[],
      presets: string[],
      parentId?: string | null
    ) => createFolder(name, description, rules, presets as PresetKey[], parentId)
  )
  ipcMain.handle(
    'folders:update',
    (_e, id: string, patch: { name?: string; description?: string; parentId?: string | null }) => {
      const err = updateFolder(id, patch)
      // Moving a house changes which rules every project under it inherits.
      if (!err && patch.parentId !== undefined) scheduleAgentsMdSync()
      return err
    }
  )
  ipcMain.handle('folders:move', (_e, id: string, parentId: string | null) => {
    const err = moveFolder(id, parentId)
    if (!err) scheduleAgentsMdSync()
    return err
  })
  ipcMain.handle('folders:set-rules', (_e, id: string, rules: FolderRule[]) => {
    const err = setFolderRules(id, rules)
    if (!err) scheduleAgentsMdSync()
    return err
  })
  ipcMain.handle('folders:delete', (_e, id: string) => {
    const err = deleteFolder(id)
    if (!err) scheduleAgentsMdSync()
    return err
  })
  ipcMain.handle('project:assign-folder', (_e, projectId: string, folderId: string | null) => {
    const err = assignProjectFolder(projectId, folderId)
    if (!err) scheduleAgentsMdSync()
    return err
  })

  // The owner's own agents — the same writes an agent makes over MCP, done by
  // the owner in the app. Every one returns a plain-words error string.
  ipcMain.handle('crew:list', () => listCrew())
  ipcMain.handle('crew:houses', () => crewHouseOptions())
  ipcMain.handle('crew:create', (_e, input: Partial<AgentDef> & { preset?: string }) => {
    const r = createAgent(input)
    if (!r.error) scheduleAgentsMdSync()
    return r
  })
  ipcMain.handle('crew:update', (_e, id: string, patch: Partial<AgentDef>) => {
    const err = updateAgent(id, patch)
    if (!err) scheduleAgentsMdSync()
    return err
  })
  ipcMain.handle('crew:set-scope', (_e, id: string, scope: AgentScope, folderId: string | null) => {
    const err = setAgentScope(id, scope, folderId)
    if (!err) scheduleAgentsMdSync()
    return err
  })
  ipcMain.handle('crew:set-disabled', (_e, id: string, folderId: string, off: boolean) => {
    const err = setAgentDisabled(id, folderId, off)
    if (!err) scheduleAgentsMdSync()
    return err
  })
  ipcMain.handle('crew:duplicate', (_e, id: string) => {
    const r = duplicateAgent(id)
    if (!r.error) scheduleAgentsMdSync()
    return r
  })
  ipcMain.handle('crew:delete', (_e, id: string) => {
    const err = deleteAgent(id)
    if (!err) scheduleAgentsMdSync()
    return err
  })
  ipcMain.handle('crew:brief', (_e, id: string, projectId: string | null) =>
    agentBrief(id, projectId ? loadBundle(projectId) : null)
  )

  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const next = writeSettings(patch)
    scheduleAgentsMdSync()
    return next
  })
  ipcMain.handle('app:about', async () => ({
    version: app.getVersion(),
    dataDir: DATA_DIR,
    serverPath,
    nodeBin: await nodeBinPath()
  }))
  ipcMain.handle('app:check-updates', () => checkForUpdatesInteractive())
  ipcMain.handle('shell:reveal', (_e, what: 'data' | 'server') => {
    shell.showItemInFolder(what === 'server' ? serverPath : DATA_DIR)
  })
  ipcMain.handle('clipboard:copy', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
  })

  // Live updates: the MCP server writes files; we push a change signal to the UI.
  ensureCrewDir()
  const watcher = chokidar.watch([PROJECTS_DIR, path.join(DATA_DIR, 'sessions'), FOLDERS_DIR, CREW_DIR], {
    ignoreInitial: true,
    ignored: (p) => /\.tmp$|\.lock$|\.bak$|\.DS_Store$|\.corrupt-/.test(p),
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    depth: 3
  })
  let pending: NodeJS.Timeout | null = null
  const notify = (): void => {
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('projects:changed'))
      checkForNotifications()
    }, 80)
  }
  // AGENTS.md export: regenerated after every board change, on its own 2s
  // debounce (separate from the 80ms UI-refresh one above — this one writes
  // into the owner's actual codebase, so it can afford to be lazier).
  let agentsMdTimer: NodeJS.Timeout | null = null
  const scheduleAgentsMdSync = (): void => {
    if (agentsMdTimer) clearTimeout(agentsMdTimer)
    agentsMdTimer = setTimeout(() => {
      // A project that has never been told either way inherits the owner's
      // preference — once, explicitly, so its own toggle always tells the truth.
      applyAgentsMdDefault(readSettings().agentsMdForNewProjects)
      // The export carries the crew too (AGENTS.md section + .claude/agents).
      syncAllAgentsMd(attachCrew(listBundles()))
    }, 2000)
  }
  watcher.on('all', () => {
    notify()
    scheduleAgentsMdSync()
  })
  watcher.on('error', (err) => console.error('[specdrive] watcher error:', err))
  // Seed the notifier's snapshots silently so the first real change after
  // boot doesn't look like every task just flipped to done.
  checkForNotifications()
  scheduleAgentsMdSync()
  app.on('before-quit', () => {
    watcher.close().catch(() => {})
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
