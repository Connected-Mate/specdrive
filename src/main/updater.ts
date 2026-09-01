import { app, dialog } from 'electron'

// Auto-update via electron-updater, backed by GitHub Releases.
// Every path here is defensive: this must never crash the app, block startup,
// or nag the user when there's no network / no publish config / dev mode.

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

let started = false

export function initUpdater(): void {
  if (started) return
  started = true

  // Never run in dev — there's no packaged app to replace, and no feed configured.
  if (!app.isPackaged) return

  void (async () => {
    try {
      const { autoUpdater } = await import('electron-updater')

      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('update-downloaded', () => {
        try {
          dialog
            .showMessageBox({
              type: 'info',
              title: 'SpecDrive update ready',
              message: 'A new version of SpecDrive is ready — restart now?',
              buttons: ['Restart now', 'Later'],
              defaultId: 0,
              cancelId: 1
            })
            .then((result) => {
              if (result.response === 0) {
                try {
                  autoUpdater.quitAndInstall()
                } catch {
                  // Never let a failed install attempt crash the app.
                }
              }
            })
            .catch(() => {
              // Dialog failed to show — silently skip, update installs on next quit anyway.
            })
        } catch {
          // Never let update UI take the app down.
        }
      })

      // Silence every other event — this must stay invisible until an update is ready.
      autoUpdater.on('error', () => {})

      const checkSafely = (): void => {
        try {
          autoUpdater.checkForUpdates().catch(() => {
            // No network, no feed, no releases yet — all fine, just skip silently.
          })
        } catch {
          // Synchronous failure guard.
        }
      }

      checkSafely()
      setInterval(checkSafely, FOUR_HOURS_MS).unref()
    } catch {
      // electron-updater failed to load or init — app must keep working regardless.
    }
  })()
}
