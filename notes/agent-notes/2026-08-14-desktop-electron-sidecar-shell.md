# Agent Note: Desktop shell — an Electron window over a sidecar dsh web host

Status: implemented

English | [中文](2026-08-14-desktop-electron-sidecar-shell.zh.md)

## Problem

DeepSeek Harness ships a browser GUI: `dsh web` serves the built frontend on a loopback HTTP server. A desktop delivery needs a native window without forking the client stack or touching the wire protocol. The [GUI layering note](../architecture/2026-07-19-gui-layering-and-rpc-protocol.md) reserves an Electron seat but scopes it to the IPC fetch carrier — loading dist over `file://` with fetch over an IPC bridge — which requires a bundle carrier and downlink rework before any window exists. The gap is a first shippable desktop step that reuses the web surface verbatim.

## Decision

`apps/desktop` (`@deepseek-ai/dsh-desktop`) is an Electron main process that runs the existing web host as a child process and loads the served URL — no protocol, bundle, or client change:

- **Sidecar, not in-process host.** The main process spawns the dsh CLI with `web --host 127.0.0.1 --port 0`, so the OS picks the port. Readiness is the stdout line `dsh web: http://127.0.0.1:<port>` (printed by `dsh-web-app` after its Loader tree settles); [`src/urls.ts`](../../../../apps/desktop/src/urls.ts) accepts loopback origins only. A host crash restarts the sidecar (at most 3 within 120 s) and reloads the window — the web client's reconnect-equals-rebuild contract absorbs the gap.
- **Launch shapes.** Packaged: `<resources>/dsh/lib/bin.js` runs as plain Node under the app's own Electron binary (`ELECTRON_RUN_AS_NODE=1`), so no system Node is required. Repository: `apps/cli/src/bin.ts` runs under system Node with tsx's ESM hook, matching `pnpm dsh` source launches. `DSH_DESKTOP_DSH_BIN` overrides the entry either way ([`src/launch.ts`](../../../../apps/desktop/src/launch.ts)).
- **Supervisor scope.** [`src/sidecar.ts`](../../../../apps/desktop/src/sidecar.ts) owns exactly one child: a `ready` promise for the URL line, an `exited` promise, and an idempotent `stop()` that escalates from SIGTERM to a forced tree kill. Restart policy lives in the main process, not the supervisor.
- **Window posture.** One `BrowserWindow`, hidden until `ready-to-show`, geometry persisted under Electron userData and clamped to a visible display, `contextIsolation` + `sandbox` on, no preload. Navigation is confined to the host origin; everything else opens in the system browser.
- **Acceptance path.** `DSH_DESKTOP_SMOKE=1` boots the real sidecar with a hidden window and exits 0 after `did-finish-load`, giving the shell a headless end-to-end check.

## Repository wiring

The package is a release member under `apps/` like its siblings: the root tsdown workspace bundles `lib/types/main.js` into `lib/main.js` (Electron stays external — it is a dev-time runtime, and the npm payload ships only the main bundle, per `appPackageFiles`). The Host aggregate references the project; `pnpm-workspace.yaml` allows Electron's install script (it downloads the platform binary) and denies `electron-winstaller`'s (the unused Squirrel transitive); knip treats the `.mjs` test fixture and staging scripts as spawned entries.

## Application packaging

The installable application is produced from the same sidecar design, no protocol change:

- **Staging** ([`scripts/stage-dsh.mjs`](../../../../apps/desktop/scripts/stage-dsh.mjs)): the repository's `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod` recipe (flags owned by the [single-exe note](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md)) runs into `apps/desktop/.stage/dsh`. Because auto-install-peers is off, the deploy omits peer-required workspace packages (the same class the exe manifest closes by hand), and the pnpm override leaves vendored packages (`@deepseek-ai/cosmokit`, `schemastery`) unlinked; the script therefore completes the closure to a fixed point — every dependency or peer a staged manifest names and the staging lacks is copied from the repository install (hoisted roots, `vendor/` sources, then `.pnpm` store entries) — then materializes every link into bytes and asserts every non-optional requirement resolves inside the staging. `apps/cli`'s dependencies list the omitted runtime peers explicitly, closing the same gap for a plain `npm i -g @deepseek-ai/dsh` install. Finally the staging is trimmed of build-time weight: TypeScript declarations, source maps, and per-package documentation are never read at runtime (the Loader imports `package.json` + `lib/*.js`; the runtime-JS tree under `lib/types` stays because some packages ship browser-safe channels there) and were measured at about half the closure's file count — 20,234 files / 73.7 MB removed, silent install 371 s → 200 s. Installer time is file-count bound through NSIS per-file overhead and real-time antivirus scanning; a progress bar resting on one point during the large compressed block's decompression is normal.
- **electron-builder** ([`electron-builder.yml`](../../../../apps/desktop/electron-builder.yml) + `scripts/after-pack.cjs`): the main bundle rides the asar; the staged closure is copied by an `afterPack` hook because `extraResources` prunes any `node_modules` it carries against the app's own dependency graph ("no node modules returned" — this app has only dev dependencies). Windows ships a portable `win-unpacked/`, an NSIS installer, and a portable zip; Electron locales are pruned to `zh-CN` + `en-US` (53 files, ~40 MB). Without a certificate the zip is the distribution path: `tar -xf` deploys it in ~17 s versus ~200 s for the installer, with no installer UI or registry. Code signing activates from environment variables alone — `CSC_LINK`/`CSC_KEY_PASSWORD` for a PFX certificate (cheapest real option: Certum Open Source, ≈ €25/yr, open-source-qualified), or `win.azureSignOptions` (mutually exclusive) for Azure Trusted Signing; `signtoolOptions.rfc3161TimeStampServer` is pinned so signatures outlive the certificate. The pipeline is verified end to end with a self-signed `CodeSigningCert`: signer subject and RFC3161 timestamp land on the app exe and the installer (`UnknownError` is only the untrusted self-signed chain). The closure's `.node` addons stay unsigned — Windows neither requires them signed nor attaches SmartScreen reputation to them; a macOS notarization target will have to sign every nested binary in `resources/dsh`.
- **Packaged acceptance**: `DSH_DESKTOP_SMOKE=1` against the packaged `DeepSeek Harness.exe` boots the bundled closure through the Electron binary (`ELECTRON_RUN_AS_NODE`) and exits 0 after the page loads; verified on win-x64 with the 146 MB NSIS installer.

## Alternatives considered

- **Host in-process inside the Electron main.** Saves a process, but couples host crashes to the GUI, forces native-module (node-pty, koffi) rebuilds against Electron's ABI, and contradicts the product's one-process-one-surface launches. Rejected.
- **Implement the IPC fetch carrier now.** The layering note's end-state (`file://` dist, `doFetch` over IPC) removes the loopback port entirely, but requires a custom bundle carrier for `__DSH_BOOT__` and the plugin-bundle endpoint plus downlink virtual overrides. Deferred until the sidecar shell is on its feet; this note does not supersede that design.
- **Tauri.** A Rust shell still needs a Node sidecar for the harness runtime, adding a third language to the product with no repo seat reserved for it. Rejected.
- **extraResources for the closure.** electron-builder prunes `node_modules` trees it copies against the app's dependency graph; with only dev dependencies the closure arrives empty. The afterPack hook copies verbatim instead. Rejected after measurement (`filter: ['**/*']` did not bypass the pruner).
- **Bundling the host into the asar.** The closure carries native addons (node-pty, koffi), `.node` binaries, and a profile tree the Loader writes; plain files under `resources/` keep those executable and writable. Rejected.

## Consequences

The desktop surface rides every web change for free and adds no wire surface of its own. Costs accepted: one extra process and its boot latency; an unauthenticated loopback server on a random port (the same posture as `dsh web`, documented in the [webserver contract](../../../../packages/host/webserver/README.md)); a hard-kill stop path on Windows, where child signals are not delivered gracefully — the append-durable session log bounds the loss to the in-flight tail; and an Electron binary download on every workspace install.

## Testing

The pure halves are covered without a display: `urls.spec.ts` (ready-line parsing, loopback-only acceptance), `launch.spec.ts` (all three launch shapes plus failure), and `sidecar.spec.ts` (ready resolution, early-exit rejection with output tail, ready-deadline kill, idempotent stop; the graceful SIGTERM exit code asserts on POSIX only). The smoke pass exercises the assembled shell: real Electron main, real sidecar boot, page load.

## Deferred

- macOS and Linux packaging targets (native-addon staging per platform), application icons, code signing, and auto-update wiring.
- An Electron provider for the directory picker's `native` interaction ([capability seam](../architecture/2026-07-28-directory-picker-capability-seam.md)).
- The IPC fetch carrier as the portless end-state.
