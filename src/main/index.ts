import { app, shell, BrowserWindow, ipcMain, clipboard } from 'electron'
import path from 'node:path'
import chokidar from 'chokidar'
import { listBundles, loadBundle, readWireframe, deleteProject, ensureDataDirs, PROJECTS_DIR } from './store'
import { detectAgents, connectAgent, mcpServerPath } from './agents'
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
        win?.webContents.executeJavaScript(
          `window.dispatchEvent(new CustomEvent('specdrive:open-project', { detail: ${JSON.stringify(route)} }))`
        )
      }
      setTimeout(async () => {
        const scroll = Number(process.env.SPECDRIVE_SCROLL ?? 0)
        if (scroll) {
          await win!.webContents.executeJavaScript(`window.scrollTo(0, ${scroll})`)
          await new Promise((r) => setTimeout(r, 400))
        }
        if (process.env.SPECDRIVE_DEBUG) {
          const dbg = await win!.webContents.executeJavaScript(
            `(() => { const i = document.querySelector('.hero-art img'); if (!i) return 'no img'; const r = i.getBoundingClientRect(); return { nw: i.naturalWidth, complete: i.complete, src: i.currentSrc, rect: [r.x, r.y, r.width, r.height] } })()`
          )
          console.log('DEBUG_WF', JSON.stringify(dbg))
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
  const serverPath = mcpServerPath(app.getAppPath(), app.isPackaged)

  ipcMain.handle('projects:list', () => listBundles())
  ipcMain.handle('projects:get', (_e, id: string) => loadBundle(id))
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id))
  ipcMain.handle('wireframe:read', (_e, projectId: string, file: string) =>
    readWireframe(projectId, file)
  )
  ipcMain.handle('agents:detect', () => detectAgents(serverPath))
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
  const watcher = chokidar.watch(PROJECTS_DIR, {
    ignoreInitial: true,
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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
