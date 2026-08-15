/**
 * Browser half of the workspace file-tree surface: fills ui-workspace's
 * `sidebar.workspaces.fileTree` hole with the expandable directory tree,
 * driving `host.listFiles` (the node half's listing service) through the
 * wire-facing workspaces face. Every row drags as its absolute path, which
 * the conversation composer adopts as a draft path reference.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotMap merge declaring the file-tree hole.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { FileTreeInjected } from './inject.ts'
import { FileTree } from './FileTree.tsx'
import { en, zh, type FileTreeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace file-tree section copy. */
    fileTree: FileTreeKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'fileTree'

/**
 * Required services (cordis fiber inject): the slot registry, the
 * wire-facing workspace service, and the locale registry.
 */
export const inject = ['slots', 'workspaces', 'locale']

/**
 * Client plugin body: register the tree into ui-workspace's file-tree hole
 * through `slots.inject()` because the ui-workspace entry may activate
 * later or replace its declaration.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-tree: dictionaries')
  const injected = (): FileTreeInjected => ({
    list: (path, signal) => ctx.workspaces.listFiles(path, signal),
  })
  ctx.slots.inject('sidebar.workspaces.fileTree', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces.fileTree',
      inject: injected,
      locale: NS,
    },
    FileTree,
  ))
}
