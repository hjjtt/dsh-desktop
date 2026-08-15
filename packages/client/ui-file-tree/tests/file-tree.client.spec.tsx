// @vitest-environment jsdom
/** FileTree presentation behavior over a stubbed listing face. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { FileTreeListing } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as nodeApply } from '../src/index.ts'
import { FileTree, WORKSPACE_PATH_DRAG_MIME } from '../src/client/FileTree.tsx'

/** Identity-ish translator over the zh dictionary (assertions use zh copy). */
const t = (key: string, params?: Record<string, unknown>): string => {
  const zh: Record<string, string> = {
    'section.aria': '工作区文件树',
    'level.loading': '加载中…',
    'level.error': '加载失败',
    'level.retry': '重试',
    'level.truncated': '条目过多，已截断',
    'level.empty': '空目录',
    'row.expand': '展开 {name}',
  }
  const name = typeof params?.name === 'string' ? params.name : ''
  return (zh[key] ?? key).replace('{name}', name)
}

const listing = (path: string, entries: FileTreeListing['entries'], truncated = false): FileTreeListing =>
  ({ path, entries, truncated })

/** Full component props: the root-scope runtime share's standard hooks are
 * unused by the tree, so the bench feeds no-op stubs. */
const fileTreeProps = (path: string, list: (p: string, s: AbortSignal) => Promise<FileTreeListing>): Parameters<typeof FileTree>[0] => ({
  path,
  list,
  t,
  useSessions: (() => undefined) as Parameters<typeof FileTree>[0]['useSessions'],
  useWorkspaces: (() => undefined) as Parameters<typeof FileTree>[0]['useWorkspaces'],
})

// No vitest globals → no auto-cleanup; each case owns its DOM teardown.
afterEach(() => { cleanup() })

describe('FileTree', () => {
  it('renders the root level and lazily loads an expanded subdirectory', async () => {
    const list = vi.fn(async (path: string): Promise<FileTreeListing> => {
      if (path === '/w') return listing('/w', [
        { name: 'src', path: '/w/src', kind: 'directory', hidden: false },
        { name: 'README.md', path: '/w/README.md', kind: 'file', hidden: false },
        { name: '.env.local', path: '/w/.env.local', kind: 'file', hidden: true },
      ])
      return listing(path, [{ name: 'main.ts', path: '/w/src/main.ts', kind: 'file', hidden: false }])
    })
    render(<FileTree {...fileTreeProps('/w', list)} />)
    expect(await screen.findByText('README.md')).toBeTruthy()
    // Hidden rows render (dimmed via CSS class), never filtered client-side.
    expect(screen.getByText('.env.local')).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith('/w', expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('button', { name: '展开 src' }))
    expect(await screen.findByText('main.ts')).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenLastCalledWith('/w/src', expect.any(AbortSignal))
  })

  it('re-roots the tree when the workspace path changes', async () => {
    const list = vi.fn(async (path: string): Promise<FileTreeListing> =>
      listing(path, [
        { name: 'src', path: `${path}/src`, kind: 'directory', hidden: false },
        { name: 'top.txt', path: `${path}/top.txt`, kind: 'file', hidden: false },
      ]))
    const view = render(<FileTree {...fileTreeProps('/w', list)} />)
    await screen.findByText('top.txt')
    fireEvent.click(screen.getByRole('button', { name: '展开 src' }))
    expect(list).toHaveBeenCalledWith('/w/src', expect.any(AbortSignal))
    view.rerender(<FileTree {...fileTreeProps('/v', list)} />)
    // The new root re-lists from scratch and the old expansion is dropped:
    // /v loads once, /v/src never auto-loads.
    await waitFor(() => {
      expect(list.mock.calls.map(call => call[0])).toEqual(['/w', '/w/src', '/v'])
    })
  })

  it('collapses a directory without dropping its cached level', async () => {
    const list = vi.fn(async (path: string): Promise<FileTreeListing> => {
      if (path === '/w') return listing('/w', [{ name: 'src', path: '/w/src', kind: 'directory', hidden: false }])
      return listing(path, [{ name: 'inner', path: `${path}/inner`, kind: 'file', hidden: false }])
    })
    render(<FileTree {...fileTreeProps('/w', list)} />)
    fireEvent.click(await screen.findByRole('button', { name: '展开 src' }))
    expect(await screen.findByText('inner')).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '展开 src' }))
    expect(screen.queryByText('inner')).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('shows the error row with a working retry', async () => {
    let fails = true
    const list = vi.fn(async (path: string): Promise<FileTreeListing> => {
      if (fails) {
        fails = false
        throw new Error('scan refused')
      }
      return listing(path, [])
    })
    render(<FileTree {...fileTreeProps('/w', list)} />)
    expect(await screen.findByText('加载失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(screen.getByText('空目录')).toBeTruthy() })
  })

  it('drags a row as its absolute path under both flavors', async () => {
    const list = vi.fn(async (): Promise<FileTreeListing> =>
      listing('/w', [{ name: 'README.md', path: '/w/README.md', kind: 'file', hidden: false }]))
    render(<FileTree {...fileTreeProps('/w', list)} />)
    const row = (await screen.findByText('README.md')).closest('[role="treeitem"]') as HTMLElement
    const store = new Map<string, string>()
    fireEvent.dragStart(row, {
      dataTransfer: {
        setData: (type: string, value: string) => { store.set(type, value) },
        effectAllowed: '',
      },
    })
    expect(store.get('text/plain')).toBe('/w/README.md')
    expect(store.get(WORKSPACE_PATH_DRAG_MIME)).toBe('/w/README.md')
  })

  it('flags a truncated level', async () => {
    const list = vi.fn(async (): Promise<FileTreeListing> => listing('/w', [
      { name: 'a', path: '/w/a', kind: 'file', hidden: false },
    ], true))
    render(<FileTree {...fileTreeProps('/w', list)} />)
    expect(await screen.findByText('条目过多，已截断')).toBeTruthy()
  })

  it('discards settlements that land after unmount', async () => {
    let resolveReady!: (listing: FileTreeListing) => void
    const list = vi.fn((_path: string): Promise<FileTreeListing> =>
      new Promise((resolve) => { resolveReady = resolve }))
    const view = render(<FileTree {...fileTreeProps('/w', list)} />)
    view.unmount()
    // The dead instance must not act on the orphaned response.
    await act(async () => {
      resolveReady({ path: '/w', entries: [], truncated: false })
    })
    expect(list).toHaveBeenCalledOnce()

    let rejectReady!: (reason: unknown) => void
    const failing = vi.fn((_path: string): Promise<FileTreeListing> =>
      new Promise((_resolve, reject) => { rejectReady = reject }))
    const failingView = render(<FileTree {...fileTreeProps('/w', failing)} />)
    failingView.unmount()
    await act(async () => {
      rejectReady(new Error('too late'))
    })
    expect(failing).toHaveBeenCalledOnce()
  })

})

describe('ui-file-tree node half', () => {
  // The invariant companion is mounted by the vitest-wide invariant host on
  // the Context this registration creates; its registration is covered there.
  it('the node apply is an inert loader seat', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(nodeApply)
    await fiber.await()
    await fiber.dispose()
  })
})
