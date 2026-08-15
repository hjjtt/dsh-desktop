import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { startSidecar, SidecarStartupError, type SidecarCommand } from '../src/sidecar.ts'

const fixture = fileURLToPath(new URL('./fixtures/fake-dsh-web.mjs', import.meta.url))

/** A fixture command with extra environment, hermetic from the test runner's. */
function command(env: Record<string, string | undefined> = {}): SidecarCommand {
  return { file: process.execPath, args: [fixture], env }
}

describe('startSidecar', () => {
  it(
    'resolves ready with the printed origin and stops on demand',
    async () => {
      const lines: Array<[string, string]> = []
      const sidecar = startSidecar({
        command: command({ FAKE_PORT: '4569' }),
        readyTimeoutMs: 10_000,
        onLine: (line, stream) => lines.push([line, stream]),
      })
      await expect(sidecar.ready).resolves.toBe('http://127.0.0.1:4569')
      expect(lines).toContainEqual(['dsh web: http://127.0.0.1:4569', 'stdout'])
      await sidecar.stop()
      await sidecar.exited
    },
    15_000,
  )

  it(
    'rejects with the output tail when the host exits before printing its URL',
    async () => {
      const sidecar = startSidecar({
        command: command({ FAKE_FAIL_FAST: '1' }),
        readyTimeoutMs: 10_000,
      })
      const error = await sidecar.ready.then(
        () => { throw new Error('expected the sidecar ready promise to reject') },
        (rejection: unknown) => rejection as SidecarStartupError,
      )
      expect(error).toBeInstanceOf(SidecarStartupError)
      expect(error.output).toContain('fake dsh: configured to fail')
      await sidecar.exited
    },
    15_000,
  )

  it(
    'rejects on the ready deadline and terminates the child',
    async () => {
      const sidecar = startSidecar({
        command: command({ FAKE_DELAY_MS: String(60_000) }),
        readyTimeoutMs: 300,
      })
      await expect(sidecar.ready).rejects.toThrow(/did not print its URL within 300ms/)
      // The timeout path owns the kill; exited settles without hanging.
      await sidecar.exited
    },
    15_000,
  )

  it(
    'stops gracefully on posix and stays idempotent',
    async () => {
      const sidecar = startSidecar({ command: command(), readyTimeoutMs: 10_000 })
      await sidecar.ready
      await sidecar.stop()
      const code = await sidecar.exited
      // Windows kill() terminates without running the child's SIGTERM
      // listener, so only POSIX observes the graceful exit code.
      if (process.platform !== 'win32') expect(code).toBe(0)
      await expect(sidecar.stop()).resolves.toBeUndefined()
    },
    15_000,
  )
})
