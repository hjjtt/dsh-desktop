# Agent Note: Workspace file tree — sidebar tree over host.listFiles with drag-to-composer paths

Status: implemented

English | [中文](2026-08-15-workspace-file-tree.zh.md)

## Problem

The web GUI shows workspaces and sessions but nothing of the workspace's contents: an operator cannot see which files a session will act on, and handing a file to the agent means typing its path. The [directory-picker seam](../architecture/2026-07-28-directory-picker-capability-seam.md) lists directories only (its contract is enterable rows for a chooser), so a viewer needs files too.

## Decision

A sidebar file tree over a new host listing service, with tree rows as drag sources:

- **Host service** — [`dsh-host-file-tree`](../../../../packages/host/file-tree/README.md) registers `ctx.fileTree` (`host.listFiles` wire row). One level of files and directories per call, name-sorted, bounded by `maxEntries` (default 1000) with `truncated`, hidden flag (dot convention), symlink kinds resolved by stat probe, broken links skipped, fully-qualified-path fence, abort-threaded scans. It reuses the browse backend's scan engine (`streamLevelWindow` was extracted from the picker's inline loop so the two consumers share one implementation; `raceAbort`/`fullyQualified` were already exported) but is its own service, not a picker capability: the picker's directory-only contract serves every picking consumer, and widening it would re-shape them all for a viewer's need. The seam split waits for a second backend or consumer that evolves independently.
- **Wire** — `host.listFiles { path } → { path, entries: {name, path, kind, hidden}[], truncated }` through the apiproxy chain (types, schemas, rpc-map, fetch client/handler, api-proxy impl via optional `ctx.get('fileTree')` with a loud `internal` error when the service is not composed). Not in the privileged loopback set: any `/api` caller that can start a session already runs `bash` and the fs tools as this process, so a file-name listing adds no capability.
- **Surface** — [`dsh-client-ui-file-tree`](../../../../packages/client/ui-file-tree/README.md) fills ui-workspace's new `sidebar.workspaces.fileTree` hole (`single`, root scope, owner `{ path }` = the current Session's Workspace directory; unoccupied hole renders nothing). The section defaults open, loads the root on mount, lazy-loads expanded directories (loading row until the response lands), keeps collapsed levels cached, re-roots on workspace switch (absolute paths carry nothing over), shows retry rows and the truncation hint, and dims hidden rows instead of filtering them.
- **Drag** — every row is an HTML5 drag source carrying its absolute path under `text/plain` plus the custom `application/x-dsh-workspace-path` flavor. ui-conversation's document-level drop handler (already image-intake) now adopts that flavor: a tree drop anywhere on the page bypasses the attachment rail and lands the path in the draft (appended on a new line; refused while locked). The flavor is a stable literal duplicated in both packages — custom MIME values survive only within one document's drags, so no shared export exists for it.

## Consequences

Operators see the workspace's structure and hand files to the agent with one drag; the agent reads the path with its existing Read tool. The tree is viewer chrome — no model-visible input, no session event, no protocol version bump (client and host ship together). Rows carry names and kinds only; reading content stays in-session.

## Alternatives considered

- **Extend the browse capability with files.** Re-shapes every picking consumer for a viewer's need; the picker's directory-only contract is load-bearing (the browser's "enterable rows" semantics). Rejected.
- **Client-side traversal over the picker seam.** Doubles every level into a directories-only listing plus a second primitive, and couples the tree to the picker's composition (absent under a `native` picker). Rejected.
- **Drag as an attachment.** The attachment seam is image-only (`imageLimits`, base64 intake); a path reference needs no content transfer and stays readable by any model. Rejected for v1, documented as Known Limitations.

## Verification

Host service spec over a real temp tree (kinds, hidden, symlinks, broken links, eviction and in-window cutoff truncation, fences, aborts; the symlink-to-file arm is exercised by the POSIX lanes and ignored on Windows, which denies unprivileged file symlinks); component specs drive the tree (lazy loads, cache, error/retry, re-root, unmount-discarded settlements, drag flavors); a client-flow spec boots the registration through the slot registry (declaration before/after apply, disposal, injected face); input-bar specs cover the tree drop (draft landing, append, locked refusal, no overlay). The scan-engine extraction keeps picker-browse's suite green.
