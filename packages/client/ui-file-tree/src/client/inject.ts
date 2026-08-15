/** Injected share of the file-tree entry: the wire-facing listing face. */
import type { FileTreeListing } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * The tree's one injected capability: one level of files and directories.
 * Narrowed from the workspaces service in the apply closure; components
 * never see the service itself.
 */
export type FileTreeInjected = {
  /**
   * List one directory level.
   * @param path - absolute directory to list.
   * @param signal - aborts the wire request (and the host scan) when the
   * caller supersedes it (a faster re-expand or unmount).
   * @returns the level's file and directory rows.
   */
  list: (path: string, signal: AbortSignal) => Promise<FileTreeListing>
}
