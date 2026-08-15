/**
 * DeepSeek Harness desktop shell — Electron main process.
 *
 * Boots the `dsh web` host as a sidecar child on a random loopback port,
 * opens one window on the printed origin, and keeps window and host alive
 * together: a host crash restarts the sidecar and reloads the window (the
 * web client's reconnect contract rebuilds its state), and quitting stops
 * the host before the app exits. The window never navigates off the host
 * origin; external links go to the system browser.
 *
 * `DSH_DESKTOP_SMOKE=1` runs a headless acceptance pass: boot the real
 * sidecar, create the window hidden, and exit 0 once the page loaded.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, screen, shell } from 'electron'
import { resolveDshLaunch } from './launch.ts'
import { startSidecar, SidecarStartupError, type SidecarProcess } from './sidecar.ts'

/** Environment variable enabling the headless acceptance pass. */
const SMOKE_ENV = 'DSH_DESKTOP_SMOKE'

/** Overall deadline for the smoke pass, covering first boot of the host. */
const SMOKE_DEADLINE_MS = 120_000

/** Sidecar restarts allowed inside the window before giving up. */
const MAX_RESTARTS = 3

/** Sliding window restarts are counted within. */
const RESTART_WINDOW_MS = 120_000

/** Persisted window geometry, one JSON file under Electron's userData. */
interface WindowState {
  width: number
  height: number
  maximized: boolean
  x?: number
  y?: number
}

const DEFAULT_STATE: WindowState = { width: 1280, height: 800, maximized: false }

const smoke = process.env[SMOKE_ENV] === '1'

let mainWindow: BrowserWindow | undefined
let sidecar: SidecarProcess | undefined
let hostOrigin: string | undefined
let quitting = false
let quitStarted = false
const restarts: number[] = []

// Electron derives userData from the package name by default, which is the
// scoped npm id `@deepseek-ai/dsh-desktop` and nests two directories under
// %APPDATA%. The product name keeps userData at `%APPDATA%\DeepSeek Harness`;
// this must run before the first `app.getPath('userData')` resolution.
app.setName('DeepSeek Harness')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void boot()
}

app.on('second-instance', () => {
  const win = mainWindow
  if (win !== undefined && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  // macOS dock reactivation with no window: the host keeps running, so only
  // the window needs recreating.
  if (BrowserWindow.getAllWindows().length === 0 && hostOrigin !== undefined) openWindow(hostOrigin)
})

app.on('window-all-closed', () => {
  void quit()
})

app.on('before-quit', (event) => {
  if (!quitStarted) {
    event.preventDefault()
    void quit()
  }
})

/** Boot Electron, then the window, then the host sidecar; failures exit loud. */
async function boot(): Promise<void> {
  await app.whenReady()
  installMenu()
  // The window shows immediately as an empty document: the sidecar's cold
  // start takes seconds, and an instant window replaces that dead time with
  // the app's own frame while the host origin loads in place once ready.
  createWindow()
  try {
    await startHost()
  } catch (error) {
    failFast(error)
  }
}

/** Start (or restart) the host sidecar and open the window on its origin. */
async function startHost(): Promise<void> {
  // The unpackaged checkout root (this file sits at <repo>/apps/desktop/lib/);
  // undefined when packaged, where the launch resolves from resources instead.
  const repoRoot = app.isPackaged ? undefined : fileURLToPath(new URL('../../../', import.meta.url))
  const launch = app.isPackaged
    ? resolveDshLaunch({
      packaged: true,
      electronExecPath: process.execPath,
      resourcesPath: process.resourcesPath,
    })
    : resolveDshLaunch({
      packaged: false,
      electronExecPath: process.execPath,
      ...(repoRoot !== undefined ? { repoRoot } : {}),
    })
  const child = startSidecar({
    command: {
      file: launch.file,
      args: [...launch.args, 'web', '--host', '127.0.0.1', '--port', '0'],
      env: launch.env,
    },
    // The sidecar's working directory seeds the default workspace root: the
    // user's home for an installation, the repository for a dev checkout.
    cwd: (app.isPackaged ? homedir() : repoRoot) ?? homedir(),
  })
  sidecar = child
  const url = await child.ready
  hostOrigin = url
  child.exited.then(onHostExit).catch(() => {
    // exited never rejects; an observer failure must not kill the shell.
  })
  loadMainWindow(url)
}

/** Restart a crashed host, or give up and quit once restarts exceed the cap. */
function onHostExit(): void {
  if (quitting || smoke) return
  const now = Date.now()
  while (restarts.length > 0 && now - (restarts[0] ?? 0) > RESTART_WINDOW_MS) restarts.shift()
  restarts.push(now)
  if (restarts.length > MAX_RESTARTS) {
    failFast(new Error(`the dsh host exited ${String(restarts.length - 1)} times within ${String(RESTART_WINDOW_MS / 1000)}s; giving up`))
    return
  }
  startHost().catch(failFast)
}

/** Open (or reload) the window on the host origin. */
function openWindow(url: string): void {
  createWindow()
  loadMainWindow(url)
}

/** Create the window now on an empty document; the host origin loads in place later. */
function createWindow(): void {
  const existing = mainWindow
  if (existing !== undefined && !existing.isDestroyed()) return
  const state = loadWindowState()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    // Shown on creation: the empty first document has no first paint, so
    // `ready-to-show` would withhold the window until the host page loads.
    show: !smoke,
    title: 'DeepSeek Harness',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (state.maximized) win.maximize()
  mainWindow = win
  win.on('close', () => {
    saveWindowState(win)
  })
}

/** Load the host origin into the window; navigation guarding starts here. */
function loadMainWindow(url: string): void {
  const win = mainWindow
  if (win === undefined || win.isDestroyed()) return
  guardNavigation(win, url)
  if (smoke) wireSmoke(win)
  void win.loadURL(url)
}

/** Confine in-window navigation to the host origin; everything else opens externally. */
function guardNavigation(win: BrowserWindow, url: string): void {
  const allowed = new URL(url).origin
  const openOutside = (target: string): void => {
    try {
      const parsed = new URL(target)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(parsed.href)
    } catch {
      // Unparseable targets carry no openable page; dropping them is the fix.
    }
  }
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (new URL(target).origin !== allowed) openOutside(target)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== allowed) {
      event.preventDefault()
      openOutside(target)
    }
  })
}

/** Wire the smoke pass: exit 0 on first load, exit 1 on failure or deadline. */
function wireSmoke(win: BrowserWindow): void {
  const deadline = setTimeout(() => {
    console.error('dsh desktop smoke: timed out')
    app.exit(1)
  }, SMOKE_DEADLINE_MS)
  win.webContents.once('did-finish-load', () => {
    clearTimeout(deadline)
    console.log(`dsh desktop smoke: ok ${hostOrigin ?? ''}`)
    void quit()
  })
  win.webContents.once('did-fail-load', (_event, code, description) => {
    clearTimeout(deadline)
    console.error(`dsh desktop smoke: page failed to load (${String(code)} ${description})`)
    app.exit(1)
  })
}

/** The minimal role-based menu: no file menu, nothing that navigates elsewhere. */
function installMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { role: 'editMenu' } as const,
    { role: 'viewMenu' } as const,
    { role: 'windowMenu' } as const,
  ]))
}

/** @returns the persisted window state, clamped to a visible display. */
function loadWindowState(): WindowState {
  let raw: Partial<WindowState> = {}
  try {
    raw = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<WindowState>
  } catch {
    // A missing or corrupt state file on first run falls back to the defaults.
  }
  const width = typeof raw.width === 'number' && raw.width >= 400 ? Math.floor(raw.width) : DEFAULT_STATE.width
  const height = typeof raw.height === 'number' && raw.height >= 300 ? Math.floor(raw.height) : DEFAULT_STATE.height
  const x = typeof raw.x === 'number' ? Math.floor(raw.x) : undefined
  const y = typeof raw.y === 'number' ? Math.floor(raw.y) : undefined
  let visibleX = x
  let visibleY = y
  if (visibleX !== undefined && visibleY !== undefined) {
    const workArea = screen.getDisplayMatching({ x: visibleX, y: visibleY, width, height }).workArea
    const offScreen = visibleX + width <= workArea.x
      || visibleY + height <= workArea.y
      || visibleX >= workArea.x + workArea.width
      || visibleY >= workArea.y + workArea.height
    if (offScreen) {
      visibleX = undefined
      visibleY = undefined
    }
  }
  return {
    width,
    height,
    maximized: raw.maximized === true,
    ...(visibleX !== undefined && visibleY !== undefined ? { x: visibleX, y: visibleY } : {}),
  }
}

/** Persist the window geometry; best-effort, a failed write only loses the geometry. */
function saveWindowState(win: BrowserWindow): void {
  const bounds = win.getNormalBounds()
  const state: WindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: win.isMaximized(),
  }
  try {
    mkdirSync(dirname(statePath()), { recursive: true })
    writeFileSync(statePath(), `${JSON.stringify(state)}\n`)
  } catch {
    // A read-only userData directory must not break closing the window.
  }
}

/** @returns the window-state file path under Electron's userData directory. */
function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** Stop the host, then exit the app. Re-entrant calls collapse into one run. */
async function quit(): Promise<void> {
  if (quitStarted) return
  quitStarted = true
  quitting = true
  await sidecar?.stop()
  app.exit(0)
}

/** Report a fatal startup error and exit nonzero; the smoke pass stays on stdout/stderr. */
function failFast(error: unknown): void {
  const detail = error instanceof SidecarStartupError ? error.message : error instanceof Error ? error.message : String(error)
  if (smoke) {
    console.error(`dsh desktop smoke: ${detail}`)
    app.exit(1)
    return
  }
  dialog.showErrorBox('DeepSeek Harness', `Failed to start the dsh host:\n${detail}`)
  app.exit(1)
}
