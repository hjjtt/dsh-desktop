import { describe, expect, it } from 'vitest'
import { parseWebUrlLine } from '../src/urls.ts'

describe('parseWebUrlLine', () => {
  it('extracts the loopback origin from the ready line', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:3080')).toBe('http://127.0.0.1:3080')
  })

  it('keeps the local origin when the LAN candidate follows on the same line', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:4123 (LAN: http://192.168.1.4:4123)')).toBe('http://127.0.0.1:4123')
  })

  it('accepts the ipv6 and localhost loopback names', () => {
    expect(parseWebUrlLine('dsh web: http://[::1]:3080')).toBe('http://[::1]:3080')
    expect(parseWebUrlLine('dsh web: http://localhost:3080')).toBe('http://localhost:3080')
  })

  it('refuses a non-loopback origin', () => {
    expect(parseWebUrlLine('dsh web: http://0.0.0.0:3080')).toBeUndefined()
    expect(parseWebUrlLine('dsh web: http://192.168.1.4:3080')).toBeUndefined()
  })

  it('ignores other output lines', () => {
    expect(parseWebUrlLine('some plugin loaded')).toBeUndefined()
    expect(parseWebUrlLine('dsh web:http://127.0.0.1:3080')).toBeUndefined()
  })
})
