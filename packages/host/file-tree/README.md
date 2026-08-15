# @deepseek-ai/dsh-host-file-tree

English | [中文](README.zh.md)

The workspace **file-tree service** for the web GUI host: `FileTree` registers `ctx.fileTree` with one-level listings of **files and directories** over Node's stdlib, consumed by the API proxy's `host.listFiles` for the sidebar workspace tree. It shares the [directory-picker browse backend](../directory-picker-browse/README.md)'s scan engine (`streamLevelWindow`, `raceAbort`, `fullyQualified`) but answers a different question — what is in this directory, files included — for a different consumer, so it is its own service rather than a picker capability: the picker's contract returns enterable directories only, and widening it would re-shape every picking consumer for a viewer's need. The splitting point for a capability seam is a second backend or consumer that evolves independently.

Behavior facts: one `list(path, signal)` call returns at most `maxEntries` rows (config, default 1000 — the bound GitHub's web UI applies to directory listings), name-sorted across files and directories, each row carrying its absolute host path (clients never join segments), its `kind` (`file`/`directory` — a symlink's kind comes from its target's stat probe), and a host-owned `hidden` flag (POSIX dot convention). The level streams through a bounded window so memory stays O(maxEntries) no matter how many children the directory holds; a cut level keeps the name-sorted head, counts hidden rows against the bound, and reports `truncated: true`. Broken or cyclic symlinks are skipped silently (the tree shows what exists behind a name). `path` must be fully qualified — relative forms, and on Windows the rooted drive-less forms (`\foo`, `/foo`) and incomplete UNC prefixes (`\\`, `\\server`) that `isAbsolute` accepts — rejected with `directory-unreadable` instead of letting `resolve` rebase the wire value under the host process cwd or current drive; the caller's `AbortSignal` stops the scan (a stalled network directory must not outlive a departed caller). Failures throw the picker seam's typed `DirectoryPickerError`, which the consuming gateway maps 1:1 onto the wire.

One `read(path, signal)` call returns one file's content for in-app viewing, consumed by the API proxy's `host.readFile`: the text is cut at `maxBytes` (config, default 1 MiB, a complete-result bound symmetric to `maxEntries`) with `truncated: true` flagging the cut tail, and `bytes` always reporting the file's complete size. A file whose first 8 KiB contains a NUL byte answers `kind: 'binary'` with empty content — the viewer shows a marker, not mojibake. The same fully-qualified fence and signal handoff apply; a directory, a missing file, or an unreadable target fails `file-unreadable`.

## Model Experience

None, as the service feeds the GUI host's file tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Windows hidden attribute is not read** — Node dirents do not expose `FILE_ATTRIBUTE_HIDDEN`, so `hidden` means dot-prefixed on every platform until a native probe is worth its cost.
- **Whole-filesystem scope** — there is no per-deployment listing-root restriction. `workspace.create` accepts arbitrary paths, so a root here would be UX scoping rather than a security boundary.
- **No content or metadata beyond names** — rows carry no sizes, mtimes, or file contents; the tree shows structure, and reading a file belongs to the session's Read tool after its path lands in a prompt.
