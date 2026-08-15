#!/usr/bin/env node
/**
 * Test double for the `dsh web` host sidecar: prints the same ready line
 * after FAKE_DELAY_MS, then idles until SIGTERM/SIGINT. FAKE_FAIL_FAST=1
 * exits nonzero before printing anything, exercising the early-exit path.
 */

const delayMs = Number(process.env.FAKE_DELAY_MS ?? '0')
const failFast = process.env.FAKE_FAIL_FAST === '1'
const port = process.env.FAKE_PORT ?? '4567'

if (failFast) {
  console.error('fake dsh: configured to fail')
  process.exit(3)
}

const readyLine = setTimeout(() => {
  console.log(`dsh web: http://127.0.0.1:${port}`)
}, delayMs)

const stop = (signal) => {
  clearTimeout(readyLine)
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

// Idle like a real server until signaled.
setInterval(() => {}, 60_000)
