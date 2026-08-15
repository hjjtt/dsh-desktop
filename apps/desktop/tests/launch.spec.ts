import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DSH_BIN_OVERRIDE_ENV, resolveDshLaunch } from '../src/launch.ts'

const base = {
  packaged: false,
  electronExecPath: '/usr/lib/electron/electron',
  repoRoot: '/repo',
  env: {} as Record<string, string | undefined>,
} as const

describe('resolveDshLaunch', () => {
  it('runs the repository source entry under system node with tsx', () => {
    const launch = resolveDshLaunch(base)
    expect(launch.kind).toBe('system-node-ts')
    expect(launch.file).toBe('node')
    expect(launch.args).toEqual(['--import', 'tsx/esm', join('/repo', 'apps', 'cli', 'src', 'bin.ts')])
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('runs the bundled closure through the electron binary as node when packaged', () => {
    const launch = resolveDshLaunch({
      packaged: true,
      electronExecPath: '/opt/dsh-desktop/dsh-desktop',
      resourcesPath: '/opt/dsh-desktop/resources',
    })
    expect(launch.kind).toBe('electron-as-node')
    expect(launch.file).toBe('/opt/dsh-desktop/dsh-desktop')
    expect(launch.args).toEqual([join('/opt/dsh-desktop/resources', 'dsh', 'lib', 'bin.js')])
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('honors the DSH_DESKTOP_DSH_BIN override for both entry kinds', () => {
    const source = resolveDshLaunch({ ...base, env: { [DSH_BIN_OVERRIDE_ENV]: '/elsewhere/bin.ts' } })
    expect(source.kind).toBe('system-node-ts')
    expect(source.args.at(-1)).toBe('/elsewhere/bin.ts')

    const built = resolveDshLaunch({ ...base, env: { [DSH_BIN_OVERRIDE_ENV]: '/elsewhere/lib/bin.js' } })
    expect(built.kind).toBe('electron-as-node')
    expect(built.args).toEqual(['/elsewhere/lib/bin.js'])
  })

  it('fails loud when the selected shape lacks its root', () => {
    expect(() => resolveDshLaunch({ packaged: false, electronExecPath: 'e', env: {} })).toThrow(/repoRoot/)
    expect(() => resolveDshLaunch({ packaged: true, electronExecPath: 'e', env: {} })).toThrow(/resourcesPath/)
  })
})
