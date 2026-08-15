/**
 * The sidebar's workspace file tree: fills the browsing region's files view
 * (ui-workspace's 会话/文件 tab switch owns the framing) with one
 * lazily-loaded level per expanded directory over the wire-facing
 * `listFiles` face. Every row is an HTML5 drag source carrying the entry's
 * absolute path (`text/plain` plus the workspace-path drag flavor), so a
 * file lands in the conversation composer as a path reference the agent can
 * then read — the same gesture as pasting the path by hand.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { FileTreeEntry } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FileTreeInjected } from './inject.ts'
import css from './FileTree.module.css'

/**
 * Drag flavor marking a row dragged from a dsh workspace tree. A stable
 * literal shared with the composer's drop handler (ui-conversation reads the
 * same string); custom MIME values survive only within one document's
 * drags, which is exactly the tree→composer trip.
 */
export const WORKSPACE_PATH_DRAG_MIME = 'application/x-dsh-workspace-path'

/** One loaded level keyed by its absolute directory path. */
interface LevelState {
  status: 'loading' | 'ready' | 'error'
  entries?: readonly FileTreeEntry[]
  truncated?: boolean
}

/** Props: the hole's owner share (workspace path) + the listing face + the locale seat. */
export type FileTreeProps =
  PropsRuntime<'sidebar.workspaces.fileTree'>
  & FileTreeInjected
  & PropsLocale<'fileTree'>

/**
 * Render the workspace file tree.
 * @param props - composed slot props (owner share + listing face + locale seat).
 * @returns the tree section element.
 */
export function FileTree({ path, list, t }: FileTreeProps) {
  const [levels, setLevels] = useState<ReadonlyMap<string, LevelState>>(() => new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // One abort controller per in-flight level load; superseded and unmounted
  // loads cancel through it so a departed caller stops the host scan.
  const loads = useRef(new Map<string, AbortController>())
  const mounted = useRef(true)
  useEffect(() => () => {
    mounted.current = false
    for (const controller of loads.current.values()) controller.abort()
  }, [])

  const loadLevel = useCallback((dir: string): void => {
    loads.current.get(dir)?.abort()
    const controller = new AbortController()
    loads.current.set(dir, controller)
    setLevels(prev => new Map(prev).set(dir, { status: 'loading' }))
    list(dir, controller.signal).then(
      (listing) => {
        if (!mounted.current || controller.signal.aborted) return
        setLevels(prev => new Map(prev).set(dir, { status: 'ready', entries: listing.entries, truncated: listing.truncated }))
      },
      () => {
        if (!mounted.current || controller.signal.aborted) return
        setLevels(prev => new Map(prev).set(dir, { status: 'error' }))
      },
    )
  }, [list])

  // A new workspace path re-roots the tree: paths are absolute, so nothing
  // carries over — drop every cached level and cancel the in-flight loads.
  useEffect(() => {
    for (const controller of loads.current.values()) controller.abort()
    loads.current.clear()
    setLevels(new Map())
    setExpanded(new Set())
  }, [path])

  // The view shows the root level; load it once per path root.
  useEffect(() => {
    if (levels.has(path)) return
    loadLevel(path)
  }, [levels, path, loadLevel])

  const toggleDir = useCallback((dir: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }, [])

  // Expanding a directory with no cached level starts its load (the level
  // renders its loading row until the response lands).
  useEffect(() => {
    for (const dir of expanded) {
      if (!levels.has(dir)) loadLevel(dir)
    }
  }, [expanded, levels, loadLevel])

  return (
    <section className={css.section} aria-label={t('section.aria')}>
      <div className={css.body} role="tree">
        <LevelRows
          dir={path}
          depth={0}
          levels={levels}
          expanded={expanded}
          onToggle={toggleDir}
          onRetry={loadLevel}
          t={t}
        />
      </div>
    </section>
  )
}

/** Props of the recursive level renderer. */
interface LevelRowsProps {
  /** Absolute path of the level's directory. */
  dir: string
  /** Nesting depth (0 = the workspace root) driving the row indent. */
  depth: number
  levels: ReadonlyMap<string, LevelState>
  expanded: ReadonlySet<string>
  onToggle: (dir: string) => void
  onRetry: (dir: string) => void
  t: PropsLocale<'fileTree'>['t']
}

/**
 * Render one directory level: its rows, and for every expanded
 * subdirectory row its own level below (the recursion that shapes the tree).
 */
function LevelRows({ dir, depth, levels, expanded, onToggle, onRetry, t }: LevelRowsProps) {
  const level = levels.get(dir)
  if (level === undefined || level.status === 'loading') {
    return <div className={css.status} role="status">{t('level.loading')}</div>
  }
  if (level.status === 'error') {
    return (
      <div className={css.status}>
        {t('level.error')}
        <button type="button" className={css.retry} onClick={() => { onRetry(dir) }}>{t('level.retry')}</button>
      </div>
    )
  }
  // v8 ignore next -- ready levels always carry entries; the fallback satisfies the shared LevelState shape.
  const entries = level.entries ?? []
  if (entries.length === 0) return <div className={css.status}>{t('level.empty')}</div>
  return (
    <>
      {entries.map(entry => (
        <div key={entry.path} className={css.rowWrap}>
          <TreeRow entry={entry} depth={depth} expanded={expanded.has(entry.path)} onToggle={onToggle} t={t} />
          {entry.kind === 'directory' && expanded.has(entry.path) && (
            <LevelRows
              dir={entry.path}
              depth={depth + 1}
              levels={levels}
              expanded={expanded}
              onToggle={onToggle}
              onRetry={onRetry}
              t={t}
            />
          )}
        </div>
      ))}
      {level.truncated === true && <div className={css.status}>{t('level.truncated')}</div>}
    </>
  )
}

/** Props of one tree row. */
interface TreeRowProps {
  entry: FileTreeEntry
  depth: number
  expanded: boolean
  onToggle: (dir: string) => void
  t: PropsLocale<'fileTree'>['t']
}

/** One file or directory row; both kinds drag as their absolute path. */
function TreeRow({ entry, depth, expanded, onToggle, t }: TreeRowProps) {
  const isDir = entry.kind === 'directory'
  return (
    <div
      className={clsx(css.row, isDir && css.rowDir, entry.hidden && css.rowHidden)}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      role="treeitem"
      aria-expanded={isDir ? expanded : undefined}
      draggable
      onDragStart={(event) => {
        // Both flavors: the custom one marks the drag's origin, text/plain
        // is the universal fallback the composer also accepts.
        event.dataTransfer.setData(WORKSPACE_PATH_DRAG_MIME, entry.path)
        event.dataTransfer.setData('text/plain', entry.path)
        event.dataTransfer.effectAllowed = 'copy'
      }}
    >
      {isDir ? (
        <button
          type="button"
          className={css.rowMain}
          aria-label={t('row.expand', { name: entry.name })}
          onClick={() => { onToggle(entry.path) }}
        >
          <svg className={clsx(css.chevron, expanded && css.chevronOpen)} width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3.5 2.5L7.5 6L3.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={css.rowName}>{entry.name}</span>
        </button>
      ) : (
        <span className={css.rowMain}>
          <svg className={css.fileGlyph} width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 1h4.5L10 3.5V11H3V1z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          </svg>
          <span className={css.rowName}>{entry.name}</span>
        </span>
      )}
    </div>
  )
}
