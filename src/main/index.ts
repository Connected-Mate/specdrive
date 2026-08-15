import { app, shell, BrowserWindow, ipcMain, clipboard } from 'electron'
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
import { exportProject } from './exporter'
import { readImage, addImage } from './store'
import type { AgentId } from '../shared/types'

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

  // Dev utility: SPECDRIVE_SHOT=/path.png [SPECDRIVE_ROUTE=projectId] captures a
  // screenshot of the app and exits — used for automated visual checks.
  const shotPath = process.env.SPECDRIVE_SHOT
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
        setTimeout(() => {
          win?.webContents.executeJavaScript(
            `window.dispatchEvent(new CustomEvent('specdrive:open-tab', { detail: ${JSON.stringify(tab)} }))`
          )
        }, 800)
      }
      setTimeout(async () => {
        const scroll = Number(process.env.SPECDRIVE_SCROLL ?? 0)
        if (scroll) {
          await win!.webContents.executeJavaScript(`window.scrollTo(0, ${scroll})`)
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

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
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

  ipcMain.handle('projects:list', () => listBundles())
  ipcMain.handle('sessions:list', () => listSessions())
  ipcMain.handle('mcp:info', async () => ({ serverPath, nodeBin: await nodeBinPath() }))
  ipcMain.handle('projects:get', (_e, id: string) => loadBundle(id))
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
  ipcMain.handle('project:export', async (_e, id: string) => {
    const bundle = loadBundle(id)
    if (!bundle) return null
    return exportProject(bundle)
  })
  ipcMain.handle('agents:detect', () => detectAgents(serverPath))
  ipcMain.handle('agents:verify', (_e, id: AgentId) => verifyAgent(id))
  ipcMain.handle('agents:connect', async (_e, id: AgentId) => {
    await connectAgent(id, serverPath)
    const all = await detectAgents(serverPath)
    return all.find((a) => a.id === id)
  })
  ipcMain.handle('clipboard:copy', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
  })

  // Live updates: the MCP server writes files; we push a change signal to the UI.
  const watcher = chokidar.watch([PROJECTS_DIR, path.join(DATA_DIR, 'sessions')], {
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
    }, 80)
  }
  watcher.on('all', notify)
  watcher.on('error', (err) => console.error('[specdrive] watcher error:', err))
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
