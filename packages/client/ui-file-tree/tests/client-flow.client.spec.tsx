// @vitest-environment jsdom
/** Client-half composition: registration lifecycle into the file-tree hole and the injected listing face. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { FileTreeListing } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import type { FileTreeInjected } from '../src/client/inject.ts'

const HOLE = 'sidebar.workspaces.fileTree' as const

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const listFiles = vi.fn(async (): Promise<FileTreeListing> =>
    ({ path: '/w', entries: [], truncated: false }))
  ctx.provide('workspaces', { listFiles } as never)
  ctx.provide('locale', { register: () => () => {} } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => slots.register({
    name: 'root',
    children: { [HOLE]: { kind: 'single', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots, listFiles, declare }
}

describe('ui-file-tree client half', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'workspaces', 'locale'])
  })

  it('fills the file-tree hole for declarations before or after apply, and leaves with its fiber', async () => {
    const before = await bench()
    before.declare()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(before.slots.entries(HOLE)).toHaveLength(1)
    // Registry-contribution disposal proof: the fiber going down empties the hole.
    await fiber.dispose()
    expect(before.slots.entries(HOLE)).toHaveLength(0)

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries(HOLE)).toHaveLength(0)
    after.declare()
    await Promise.resolve()
    expect(after.slots.entries(HOLE)).toHaveLength(1)
  })

  it('drives the injected listing face through the hole entry', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries(HOLE)[0]!
    const injected = (entry.inject as () => FileTreeInjected)()
    await expect(injected.list('/w', new AbortController().signal)).resolves.toEqual({
      path: '/w', entries: [], truncated: false,
    })
    expect(b.listFiles).toHaveBeenCalledOnce()
    expect(b.listFiles).toHaveBeenCalledWith('/w', expect.any(AbortSignal))
  })
})
