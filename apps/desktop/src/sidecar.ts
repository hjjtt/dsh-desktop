/**
 * Sidecar supervisor for one `dsh web` host process.
 *
 * The supervisor owns exactly one child from spawn to exit: it resolves
 * `ready` with the printed loopback origin, settles `exited` on process
 * close, and `stop()` escalates from a graceful signal to a forced tree kill.
 * Restart policy belongs to the caller, not the supervisor. Pure Node — no
 * Electron imports.
 *
 * On Windows `ChildProcess.kill('SIGTERM')` terminates the child without
 * running its SIGTERM listeners, so `stop()` force-kills the process tree
 * there directly; the host's session log is append-durable per event, which
 * bounds the loss to the in-flight tail.
 * @module @deepseek-ai/dsh-desktop/sidecar
 */

import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { parseWebUrlLine } from './urls.ts'

/** Default deadline for the host's ready line. */
const READY_TIMEOUT_MS = 60_000

/** Default grace before `stop()` escalates to a forced kill. */
const STOP_TIMEOUT_MS = 8_000

/** Output lines retained for a startup-failure report. */
const OUTPUT_TAIL_LINES = 40

/** The child command plus the environment overlay for one host process. */
export interface SidecarCommand {
  file: string
  args: readonly string[]
  /**
   * Overlay applied over this process's environment. `undefined` values
   * delete the key.
   */
  env?: Readonly<Record<string, string | undefined>>
}

/** Options for {@link startSidecar}. */
export interface SidecarOptions {
  command: SidecarCommand
  /** Working directory for the child; omitted inherits the current one. */
  cwd?: string
  /** Deadline in ms for the ready line; defaults to 60 000. */
  readyTimeoutMs?: number
  /** Grace in ms before `stop()` escalates; defaults to 8 000. */
  stopTimeoutMs?: number
  /** Observer receiving every child output line, for logs. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  /**
   * Durable log file: every child line and the exit code are appended here,
   * best-effort. A child that dies before printing anything leaves the
   * failure visible only in this file — the dialog alone cannot carry what
   * the process never said.
   */
  logFile?: string
}

/** Startup failure: the reason plus the retained child output tail. */
export class SidecarStartupError extends Error {
  /** The last child output lines, prefixed `stdout:`/`stderr:`, for the error dialog. */
  readonly output: string

  constructor(message: string, output: string) {
    super(message)
    this.name = 'SidecarStartupError'
    this.output = output
  }
}

/** One supervised host process. */
export interface SidecarProcess {
  /**
   * The printed loopback origin. Rejects with {@link SidecarStartupError} on
   * spawn failure, early exit, or ready-line timeout.
   */
  readonly ready: Promise<string>
  /** Settles with the child's exit code (`null` for termination by signal) whenever it exits. */
  readonly exited: Promise<number | null>
  /**
   * Stop the child: a graceful SIGTERM (POSIX) or a forced tree kill
   * (Windows), escalating after the grace period. Idempotent and safe for a
   * child that already exited.
   */
  stop(): Promise<void>
}

/**
 * Start one `dsh web` host process and supervise it.
 *
 * @param options - the command, deadlines, and output observer.
 * @returns the supervised process.
 */
export function startSidecar(options: SidecarOptions): SidecarProcess {
  const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS
  const logFile = options.logFile
  const tail: string[] = []
  let readyUrl: string | undefined
  let exited = false

  /** Best-effort durable line; a log write failure must not disturb the child. */
  const log = (line: string): void => {
    if (logFile === undefined) return
    void appendFile(logFile, `${line}\n`, 'utf8').catch(() => {
      // An unwritable log path loses diagnostics only; the sidecar proceeds.
    })
  }

  const env: Record<string, string | undefined> = { ...process.env }
  for (const [key, value] of Object.entries(options.command.env ?? {})) {
    env[key] = value
  }
  const child = spawn(options.command.file, [...options.command.args], {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let resolveExit!: (code: number | null) => void
  const exitedPromise = new Promise<number | null>((resolve) => {
    resolveExit = resolve
  })

  let resolveReady!: (url: string) => void
  let rejectReady!: (error: SidecarStartupError) => void
  const ready = new Promise<string>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  const report = (reason: string): SidecarStartupError =>
    new SidecarStartupError(`${reason}\n${tail.join('\n')}`, tail.join('\n'))

  const observe = (stream: 'stdout' | 'stderr') => (line: string): void => {
    options.onLine?.(line, stream)
    log(`${stream}: ${line}`)
    tail.push(`${stream}: ${line}`)
    if (tail.length > OUTPUT_TAIL_LINES) tail.shift()
    if (stream === 'stdout' && readyUrl === undefined) {
      const url = parseWebUrlLine(line)
      if (url !== undefined) {
        readyUrl = url
        clearTimeout(readyTimer)
        resolveReady(url)
      }
    }
  }
  createInterface({ input: child.stdout }).on('line', observe('stdout'))
  createInterface({ input: child.stderr }).on('line', observe('stderr'))

  const readyTimer = setTimeout(() => {
    rejectReady(report(`dsh web did not print its URL within ${String(readyTimeoutMs)}ms`))
    void stop()
  }, readyTimeoutMs)

  child.on('error', (error) => {
    exited = true
    clearTimeout(readyTimer)
    resolveExit(null)
    if (readyUrl === undefined) {
      rejectReady(report(`failed to start ${options.command.file}: ${error.message}`))
    }
  })

  child.on('close', (code) => {
    exited = true
    clearTimeout(readyTimer)
    log(`exit: code=${String(code ?? 'null')}`)
    resolveExit(code ?? null)
    if (readyUrl === undefined) {
      rejectReady(report(`dsh web exited before printing its URL (exit code ${String(code ?? 'null')})`))
    }
  })

  /** Resolve when `exitedPromise` settles, or `false` after `ms`. */
  const exitsWithin = async (ms: number): Promise<boolean> =>
    await Promise.race([exitedPromise.then(() => true), delay(ms).then(() => false)])

  /** Windows tree termination: `kill()` alone covers neither grandchildren nor graceful exits. */
  const taskkillTree = async (): Promise<void> => {
    if (child.pid === undefined) return
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.on('close', () => { resolve() })
      killer.on('error', () => {
        // The child may have exited between the decision and the kill; its
        // own close event is the authority.
        resolve()
      })
    })
  }

  async function stop(): Promise<void> {
    if (exited || child.exitCode !== null || child.signalCode !== null) {
      await exitedPromise
      return
    }
    if (process.platform === 'win32') {
      await taskkillTree()
    } else {
      child.kill('SIGTERM')
      if (!await exitsWithin(stopTimeoutMs)) child.kill('SIGKILL')
    }
    await exitsWithin(stopTimeoutMs)
  }

  return { ready, exited: exitedPromise, stop }
}

/**
 * Classify one {@link SidecarStartupError} as a transient startup death: a
 * child that exited without emitting any output died before its own failure
 * reporting existed (module-load and spawn-window failures — freshly written
 * install files under scanner locks behave this way), so an immediate retry
 * can succeed. A child that said something failed for a stated reason and
 * would fail again.
 * @param error - the rejection from `ready`.
 * @returns true when a retry has a realistic chance.
 */
export function isTransientStartupFailure(error: unknown): boolean {
  return error instanceof SidecarStartupError && error.output.trim() === ''
}

/** @returns a promise resolving after `ms`. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
