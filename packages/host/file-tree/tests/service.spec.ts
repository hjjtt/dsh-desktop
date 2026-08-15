/** Behavior of the workspace file-tree service over a real temporary directory tree. */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import FileTree from '../src/index.ts'

let root: string
let fileTree: FileTree
let dispose: () => Promise<void>

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-file-tree-'))
  await mkdir(join(root, 'projects'))
  await mkdir(join(root, '.hidden-dir'))
  await writeFile(join(root, 'notes.txt'), 'a file row')
  await writeFile(join(root, '.env.local'), 'hidden file row')
  await symlink(join(root, 'projects'), join(root, 'linked'), 'junction')
  await symlink(join(root, 'gone'), join(root, 'broken'), 'junction')
  try {
    await symlink(join(root, 'notes.txt'), join(root, 'file-link'))
  } catch {
    // Windows denies unprivileged file symlinks; the file-link row only
    // feeds the POSIX lanes' coverage of the symlink-to-file arm, and the
    // row assertions below tolerate its absence.
  }

  const ctx = new Context()
  const fiber = ctx.plugin(FileTree)
  await fiber.await()
  fileTree = ctx.get('fileTree')!
  dispose = () => fiber.dispose()
})

afterAll(async () => {
  await dispose()
  await rm(root, { recursive: true, force: true })
})

describe('FileTree', () => {
  it('lists files and directories name-sorted with kinds, hidden flags, and absolute paths', async () => {
    const listing = await fileTree.list(root)
    expect(listing.path).toBe(root)
    // POSIX lanes also carry the `file-link` symlink-to-file row (sorted
    // between the dot rows and `linked`); Windows denies creating it.
    expect(listing.entries.map(entry => entry.name)).toEqual([
      '.env.local', '.hidden-dir', 'file-link', 'linked', 'notes.txt', 'projects',
    ].filter(name => name !== 'file-link' || process.platform !== 'win32'))
    const byName = new Map(listing.entries.map(entry => [entry.name, entry]))
    expect(byName.get('projects')!.kind).toBe('directory')
    expect(byName.get('notes.txt')!.kind).toBe('file')
    expect(byName.get('.hidden-dir')!.kind).toBe('directory')
    expect(byName.get('.hidden-dir')!.hidden).toBe(true)
    expect(byName.get('.env.local')!.hidden).toBe(true)
    expect(byName.get('notes.txt')!.hidden).toBe(false)
    // A symlink to a directory is a directory row (expandable); on POSIX a
    // symlink to a file is a file row.
    expect(byName.get('linked')!.kind).toBe('directory')
    if (byName.has('file-link')) expect(byName.get('file-link')!.kind).toBe('file')
    // Every entry path is absolute and host-joined — clients never join segments.
    expect(listing.entries.every(entry => entry.path === join(root, entry.name))).toBe(true)
    expect(listing.truncated).toBe(false)
  })

  it('skips a broken symlink silently', async () => {
    const listing = await fileTree.list(root)
    expect(listing.entries.some(entry => entry.name === 'broken')).toBe(false)
  })

  it('cuts a level at maxEntries keeping the name-sorted head, and flags the cut', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(FileTree, { maxEntries: 2 })
    await fiber.await()
    const bounded = ctx.get('fileTree')!
    try {
      // Eviction path: the root level overflows the window, so the cut is
      // proven by a name-larger candidate beyond the bound.
      const cut = await bounded.list(root)
      expect(cut.entries.map(entry => entry.name)).toEqual(['.env.local', '.hidden-dir'])
      expect(cut.truncated).toBe(true)
      // In-window cutoff path: exactly three valid candidates fit the
      // window (no eviction), so the third row proves the cut inside the
      // loop and flags truncated on its own.
      await mkdir(join(root, 'projects', 'a'))
      await mkdir(join(root, 'projects', 'b'))
      await mkdir(join(root, 'projects', 'c'))
      const inWindow = await bounded.list(join(root, 'projects'))
      expect(inWindow.entries.map(entry => entry.name)).toEqual(['a', 'b'])
      expect(inWindow.truncated).toBe(true)
      // A level that fits the bound is complete, not truncated.
      const exact = await bounded.list(join(root, 'projects', 'a'))
      expect(exact.entries).toEqual([])
      expect(exact.truncated).toBe(false)
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects a path that is not fully qualified', async () => {
    await expect(fileTree.list('relative/path')).rejects.toMatchObject({
      name: 'DirectoryPickerError',
      code: 'directory-unreadable',
    })
  })

  it('rejects an unreadable target with directory-unreadable', async () => {
    const missing = join(root, 'no-such-dir')
    await expect(fileTree.list(missing)).rejects.toMatchObject({
      name: 'DirectoryPickerError',
      code: 'directory-unreadable',
      path: missing,
    })
  })

  it('rejects an already-aborted call without touching the filesystem', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(fileTree.list(root, controller.signal)).rejects.toThrow()
  })
})
