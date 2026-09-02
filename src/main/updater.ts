import { app, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Auto-update via electron-updater, backed by GitHub Releases on the PUBLIC
// site repo. Every path here is defensive: this must never crash the app or
// block startup. But it must also never fail *silently* — a user who is told
// "updates are automatic" and gets nothing has no way to know why, so every
// step is written to a small log the app can show.

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
// Checking only at launch means a long-running window never notices a release.
const FIRST_CHECK_DELAY_MS = 4000

let started = false
let logFile: string | null = null

function log(line: string): void {
  try {
    if (!logFile) {
      const dir = path.join(app.getPath('logs'))
      fs.mkdirSync(dir, { recursive: true })
      logFile = path.join(dir, 'updates.log')
    }
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // Logging must never break anything.
  }
}

/** Where the update log lives — the app can offer to reveal it. */
export function updateLogPath(): string | null {
  return logFile
}

export function initUpdater(): void {
  if (started) return
  started = true

  if (!app.isPackaged) return // dev: nothing packaged to replace

  void (async () => {
    try {
      // The packaged main bundle sees electron-updater as CommonJS: the dynamic
      // import may hand back { default: { autoUpdater } } instead of the named
      // export. Accept both — this exact line was silently killing updates.
      const mod = (await import('electron-updater')) as unknown as {
        autoUpdater?: import('electron-updater').AppUpdater
        default?: { autoUpdater?: import('electron-updater').AppUpdater }
      }
      const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
      if (!autoUpdater) throw new Error('electron-updater exported no autoUpdater')

      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('checking-for-update', () => log('checking for update'))
      autoUpdater.on('update-not-available', (info) =>
        log(`up to date (running ${app.getVersion()}, published ${info?.version ?? '?'})`)
      )
      autoUpdater.on('update-available', (info) => {
        log(`update available: ${info?.version} (running ${app.getVersion()}) — downloading`)
      })
      autoUpdater.on('download-progress', (p) => {
        if (Math.round(p.percent) % 25 === 0) log(`downloading ${Math.round(p.percent)}%`)
      })

      autoUpdater.on('update-downloaded', (info) => {
        log(`update ${info?.version} downloaded — prompting`)
        try {
          dialog
            .showMessageBox({
              type: 'info',
              title: 'SpecDrive update ready',
              message: `SpecDrive ${info?.version ?? ''} is ready — restart now?`,
              detail: 'Your projects and board are untouched by the update.',
              buttons: ['Restart now', 'Later'],
              defaultId: 0,
              cancelId: 1
            })
            .then((result) => {
              if (result.response === 0) {
                try {
                  autoUpdater.quitAndInstall()
                } catch (e) {
                  log(`quitAndInstall failed: ${String(e)}`)
                }
              } else {
                log('user chose Later — will install on quit')
              }
            })
            .catch(() => {
              // Dialog failed; the update still installs on next quit.
            })
        } catch (e) {
          log(`prompt failed: ${String(e)}`)
        }
      })

      // Failures are logged, never shown — but no longer swallowed blindly.
      autoUpdater.on('error', (err) => log(`error: ${err?.message ?? String(err)}`))

      const checkSafely = (): void => {
        try {
          autoUpdater.checkForUpdates().catch((e) => log(`check failed: ${String(e?.message ?? e)}`))
        } catch (e) {
          log(`check threw: ${String(e)}`)
        }
      }

      log(`updater started — running ${app.getVersion()}`)
      setTimeout(checkSafely, FIRST_CHECK_DELAY_MS).unref?.()
      setInterval(checkSafely, FOUR_HOURS_MS).unref()

      // A window that stays open for days should still notice a release when
      // the user comes back to it.
      app.on('browser-window-focus', () => {
        const now = Date.now()
        if (now - lastFocusCheck > 30 * 60 * 1000) {
          lastFocusCheck = now
          checkSafely()
        }
      })
    } catch (e) {
      log(`updater init failed: ${String(e)}`)
    }
  })()
}

let lastFocusCheck = 0

/** Manual "Check for updates…" — always answers the user, success or not. */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Development build',
      message: 'Updates only apply to the installed app.'
    })
    return
  }
  try {
    const mod = (await import('electron-updater')) as unknown as {
      autoUpdater?: import('electron-updater').AppUpdater
      default?: { autoUpdater?: import('electron-updater').AppUpdater }
    }
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
    if (!autoUpdater) throw new Error('electron-updater exported no autoUpdater')
    const result = await autoUpdater.checkForUpdates()
    const remote = result?.updateInfo?.version
    if (remote && remote !== app.getVersion()) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Update found',
        message: `SpecDrive ${remote} is available — downloading now.`,
        detail: `You are running ${app.getVersion()}. You will be asked to restart when it is ready.`
      })
    } else {
      await dialog.showMessageBox({
        type: 'info',
        title: 'You are up to date',
        message: `SpecDrive ${app.getVersion()} is the latest version.`
      })
    }
  } catch (e) {
    log(`interactive check failed: ${String(e)}`)
    const r = await dialog.showMessageBox({
      type: 'warning',
      title: 'Could not check for updates',
      message: 'SpecDrive could not reach the update server just now.',
      detail: 'Check your internet connection and try again.',
      buttons: ['OK', 'Open the log'],
      defaultId: 0
    })
    if (r.response === 1 && logFile) shell.showItemInFolder(logFile)
  }
}
