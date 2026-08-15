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

import { stat } from 'node:fs/promises'
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

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileTree: FileTree
  }
}

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one tree level; see {@link FileTree.Config}. */
  maxEntries: number
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
   * entries.
   */
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
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
