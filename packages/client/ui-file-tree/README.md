# @deepseek-ai/dsh-client-ui-file-tree

English | [中文](README.zh.md)

The workspace **file-tree surface**: the sidebar browsing region's full-height files view, listing the current Workspace's directory tree over `host.listFiles` (the [`dsh-host-file-tree`](../../host/file-tree/README.md) backend), one lazily-loaded level per expanded directory. It fills [ui-workspace's](../../client/ui-workspace/README.md) `sidebar.workspaces.fileTree` hole, which the browsing region renders when its 会话/文件 (Sessions/Files) tab switch is on the files view; an unoccupied hole renders nothing, so a composition without this package simply shows an empty files view.

Behavior facts: the tree loads the Workspace root on mount; expanding a directory starts its level load (loading row until the response lands), collapsing keeps the cached level, and switching Workspaces re-roots the tree (cached levels and in-flight loads are dropped — paths are absolute, so nothing carries over). Rows render files and directories name-sorted as the host reported them, with hidden rows (dot-prefixed) dimmed rather than filtered. A failed level shows a retry row; a host-truncated level shows a truncation hint. **Every row is an HTML5 drag source** carrying its absolute path under both `text/plain` and the `application/x-dsh-workspace-path` flavor, which the conversation composer adopts as a draft path reference (ui-conversation reads the same literal; custom MIME values survive only within one document's drags, so no shared export exists). Dragging a directory row references the directory itself.

## Model Experience

None, as the surface feeds the GUI only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No refresh or watch** — the tree lists on expand only; external file changes appear after a re-root (Workspace switch) or a page reload.
- **Drag lands the path, not the content** — the composer receives a path reference for the agent to read; binary/file content upload belongs to the image-intake rail.
- **Hidden rows are shown** — dotfiles render dimmed, never filtered client-side; hiding them entirely is a display-policy follow-up.
