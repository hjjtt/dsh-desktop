/**
 * Resolution of the dsh CLI launch the desktop shell spawns as its host
 * sidecar. Pure Node — no Electron imports — so tests cover every branch
 * without a display.
 *
 * Three shapes exist:
 * - **Packaged** (electron-builder install): the bundled dsh closure runs as
 *   plain Node under this app's own Electron binary
 *   (`ELECTRON_RUN_AS_NODE=1`), so no system Node is required.
 * - **Repository checkout**: the CLI source entry runs under the system Node
 *   with tsx's ESM hook, matching `pnpm dsh` source launches.
 * - **Override** (`DSH_DESKTOP_DSH_BIN`): an explicit entry file; `.ts` runs
 *   the source way, anything else the packaged way.
 * @module @deepseek-ai/dsh-desktop/launch
 */

import { join } from 'node:path'

/** Environment variable that overrides the dsh entry file. */
export const DSH_BIN_OVERRIDE_ENV = 'DSH_DESKTOP_DSH_BIN'

/** How the resolved launch executes. */
type DshLaunchKind =
  | 'electron-as-node'
  | 'system-node-ts'

/** One resolved dsh launch: executable, arguments, and environment overlay. */
export interface DshLaunch {
  readonly kind: DshLaunchKind
  readonly file: string
  readonly args: readonly string[]
  /**
   * Overlay applied over the shell's environment. `undefined` values delete
   * the key, so Electron-run-as-node never leaks into the host's children.
   */
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Inputs {@link resolveDshLaunch} needs; every Electron-specific value is injected. */
export interface ResolveDshLaunchInput {
  /** Whether the Electron app runs from an installation (`app.isPackaged`). */
  readonly packaged: boolean
  /** The Electron binary path (`process.execPath`); the packaged launch runs dsh through it. */
  readonly electronExecPath: string
  /** Read-only resources directory (`process.resourcesPath`); required when packaged. */
  readonly resourcesPath?: string
  /** Repository root; required when neither packaged nor overridden. */
  readonly repoRoot?: string
  /** Environment to read the override from; defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** System Node executable for source launches; defaults to `node` on PATH. */
  readonly systemNodeFile?: string
}

/** Launch `entry` as plain Node under the Electron binary. */
function electronAsNode(entry: string, electronExecPath: string): DshLaunch {
  return {
    kind: 'electron-as-node',
    file: electronExecPath,
    args: [entry],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

/** Launch the TypeScript `entry` under system Node with tsx's ESM hook. */
function systemNodeTs(entry: string, input: ResolveDshLaunchInput): DshLaunch {
  return {
    kind: 'system-node-ts',
    file: input.systemNodeFile ?? 'node',
    args: ['--import', 'tsx/esm', entry],
    env: { ELECTRON_RUN_AS_NODE: undefined },
  }
}

/**
 * Resolve the dsh CLI launch for this shell instance.
 *
 * @param input - packaging flag, Electron binary and root paths, environment.
 * @returns the launch to hand to the sidecar supervisor.
 * @throws when a required root is missing for the selected shape.
 */
export function resolveDshLaunch(input: ResolveDshLaunchInput): DshLaunch {
  const env = input.env ?? process.env
  const override = env[DSH_BIN_OVERRIDE_ENV]?.trim()
  if (override !== undefined && override !== '') {
    return override.endsWith('.ts')
      ? systemNodeTs(override, input)
      : electronAsNode(override, input.electronExecPath)
  }
  if (input.packaged) {
    if (input.resourcesPath === undefined) {
      throw new Error('dsh desktop: a packaged launch requires resourcesPath (the bundled dsh closure)')
    }
    return electronAsNode(join(input.resourcesPath, 'dsh', 'lib', 'bin.js'), input.electronExecPath)
  }
  if (input.repoRoot === undefined) {
    throw new Error('dsh desktop: a repository launch requires repoRoot (apps/cli/src/bin.ts)')
  }
  return systemNodeTs(join(input.repoRoot, 'apps', 'cli', 'src', 'bin.ts'), input)
}
