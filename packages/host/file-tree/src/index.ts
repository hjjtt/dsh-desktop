/**
 * Workspace file-tree service for the web GUI host: one-level listings of
 * **files and directories** over Node's stdlib, consumed by the API proxy's
 * `host.listFiles` for the sidebar file tree. Sibling of the
 * directory-picker's browse backend — it reuses that package's scan engine
 * (`streamLevelWindow`, `raceAbort`, `fullyQualified`) but answers a
 * different question (what is in this directory, files included) for a
 * different consumer, so it is its own service rather than a picker
 * capability: the picker's contract returns enterable directories only, and
 * widening it would re-shape every picking consumer for a viewer's need.
 * Failures throw the picker seam's typed `DirectoryPickerError`
 * (`directory-unreadable`), which the consuming gateway already maps 1:1
 * onto the wire.
 * @module @deepseek-ai/dsh-host-file-tree
 */

import { open, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import { fullyQualified, raceAbort, streamLevelWindow } from '@deepseek-ai/dsh-host-directory-picker-browse'

/** One row of a file-tree level: a file or a directory. */
export interface FileTreeEntry {
  /** Base name shown in the tree row. */
  name: string
  /** Absolute host path — the client never joins path segments itself. */
  path: string
  /** Whether the row names a directory (expandable) or a file. */
  kind: 'file' | 'directory'
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
}

/** One listed level of the tree, as {@link FileTree.list} reports it. */
export interface FileTreeListing {
  /** Absolute path of the listed directory. */
  path: string
  /** Direct children (files and directories), name-sorted. */
  entries: FileTreeEntry[]
  /** True when the backend cut `entries` at its complete-result bound (the name-sorted tail is absent). */
  truncated: boolean
}

/** One read file's content, as {@link FileTree.read} reports it. */
export interface FileContent {
  /** Absolute path of the read file. */
  path: string
  /** `'text'` (content carries the file's UTF-8 text) or `'binary'` (a NUL byte was seen; content is empty). */
  kind: 'text' | 'binary'
  /** The file's text, cut at the complete-result bound; always empty for `'binary'`. */
  content: string
  /** The file's complete size in bytes, before any bound cut. */
  bytes: number
  /** True when `content` was cut at the bound (the tail is absent). */
  truncated: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileTree: FileTree
  }
}

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one tree level; see {@link FileTree.Config}. */
  maxEntries: number
  /** Complete-result bound of one read file; see {@link FileTree.Config}. */
  maxBytes: number
}

/**
 * The `ctx.fileTree` service: one backend (the host filesystem), one
 * consumer face (the sidebar tree's lazy level loads), so Definition and
 * provider ship as this one class rather than a capability seam — a second
 * backend or consumer that evolves independently is the splitting point.
 */
export default class FileTree extends Service {
  /**
   * `maxEntries` bounds the complete tree level a single `list` call may
   * materialize and put on the wire: at most this many child rows (hidden
   * rows included), with `truncated` flagging a cut level. The default
   * follows GitHub's web UI, which truncates directory listings at 1,000
   * entries. `maxBytes` bounds the text a single `read` call returns the
   * same way (1 MiB by default), with `truncated` flagging the cut tail.
   */
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
    maxBytes: z.natural().min(1).default(1_048_576),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'fileTree')
  }

  /**
   * List one directory level of the workspace tree.
   * @param path - absolute directory to list.
   * @param signal - caller lifetime; abort stops the scan (a stalled network
   * directory must not outlive a departed caller) and rejects with the abort
   * reason.
   * @returns the level's file and directory rows, name-sorted.
   * @throws {DirectoryPickerError} `directory-unreadable` when the path is not
   * fully qualified (a wire value must never resolve against the host cwd or,
   * on Windows, its current drive) or cannot be listed.
   */
  async list(path: string, signal?: AbortSignal): Promise<FileTreeListing> {
    // Same fence as the picker's browse backend: never rebase a relative or
    // rooted drive-less wire value under the process cwd or current drive.
    if (!fullyQualified(path)) {
      throw new DirectoryPickerError('directory-unreadable', path, `cannot list "${path}": not a fully qualified path`)
    }
    const target = resolve(path)
    // Every dirent contends for the window (files included); a symlink row
    // resolves its kind by the stat probe below. The +1 slot proves a cut.
    const { window, evicted } = await streamLevelWindow(
      target,
      this.config.maxEntries + 1,
      signal,
      (name, isDirectory, isSymbolicLink) => ({ name, isDirectory, isSymbolicLink }),
    )
    const entries: FileTreeEntry[] = []
    let truncated = evicted
    for (const candidate of window) {
      // A caller that departed between reads and probes stops before the
      // next probe (the probe's own await is raced inside treeKind).
      signal?.throwIfAborted()
      const kind = await treeKind(target, candidate, signal)
      // A broken or cyclic symlink is skipped silently: the tree shows what
      // exists behind the name, and a broken link names nothing.
      if (kind === null) continue
      if (entries.length === this.config.maxEntries) {
        truncated = true
        break
      }
      entries.push({
        name: candidate.name,
        path: join(target, candidate.name),
        kind,
        hidden: candidate.name.startsWith('.'),
      })
    }
    return { path: target, entries, truncated }
  }

  /**
   * Read one file's content for in-app viewing, bounded by `maxBytes`.
   * @param path - absolute file to read.
   * @param signal - caller lifetime; abort stops the read and rejects with
   * the abort reason.
   * @returns the file's text (cut at the bound, `truncated` flagging it) or
   * a `'binary'` marker (content empty) when a NUL byte was seen.
   * @throws {DirectoryPickerError} `file-unreadable` when the path is not
   * fully qualified, names a directory, or cannot be read.
   */
  async read(path: string, signal?: AbortSignal): Promise<FileContent> {
    // Same fence as `list`: never rebase a relative or rooted drive-less wire
    // value under the process cwd or current drive.
    if (!fullyQualified(path)) {
      throw new DirectoryPickerError('file-unreadable', path, `cannot read "${path}": not a fully qualified path`)
    }
    const target = resolve(path)
    // One bounded read window: maxBytes plus the one byte that proves a cut.
    const window = this.config.maxBytes + 1
    let buffer: Buffer
    let bytes: number
    let truncated: boolean
    try {
      const info = await raceAbort(stat(target), signal)
      if (info.isDirectory()) {
        throw new DirectoryPickerError('file-unreadable', target, `cannot read "${target}": it is a directory`)
      }
      bytes = info.size
      truncated = info.size > this.config.maxBytes
      const handle = await raceAbort(open(target, 'r'), signal)
      try {
        const capacity = Math.min(info.size, window)
        buffer = Buffer.alloc(capacity)
        const { bytesRead } = await raceAbort(handle.read(buffer, 0, capacity, 0), signal)
        buffer = buffer.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
    } catch (error: unknown) {
      if (signal?.aborted || error instanceof DirectoryPickerError) throw error
      throw new DirectoryPickerError('file-unreadable', target, `cannot read "${target}": ${error instanceof Error ? error.message : String(error)}`)
    }
    // A NUL byte names a binary file; the viewer shows the marker, not mojibake.
    const binary = buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)
    const content = binary || truncated ? buffer.subarray(0, this.config.maxBytes).toString('utf8') : buffer.toString('utf8')
    return { path: target, kind: binary ? 'binary' : 'text', content: binary ? '' : content, bytes, truncated }
  }
}

/**
 * Resolve one candidate's tree kind: dirents carry it outright, a symlink
 * needs the stat probe (its target decides directory vs file).
 * @param parent - absolute listed directory.
 * @param candidate - the window candidate.
 * @param signal - caller lifetime raced with the probe.
 * @returns `'directory'`, `'file'`, or null for a broken/cyclic symlink.
 */
async function treeKind(
  parent: string,
  candidate: { name: string; isDirectory: boolean; isSymbolicLink: boolean },
  signal: AbortSignal | undefined,
): Promise<'file' | 'directory' | null> {
  if (!candidate.isSymbolicLink) return candidate.isDirectory ? 'directory' : 'file'
  try {
    // v8 ignore next -- a successful probe's file result needs a file symlink, which
    // Windows denies to unprivileged callers; the POSIX lanes exercise it.
    return (await raceAbort(stat(join(parent, candidate.name)), signal)).isDirectory() ? 'directory' : 'file'
  } catch (error: unknown) {
    /* v8 ignore next 2 -- an abort landing mid-probe needs a stalled stat; the settled broken-link arm is the normal null path. */
    if (signal?.aborted) throw error
    return null
  }
}
