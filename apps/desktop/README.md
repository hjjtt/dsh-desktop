# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The DeepSeek Harness desktop shell: an Electron window over a sidecar `dsh web` host. The main process spawns the host on an OS-assigned loopback port, waits for the `dsh web:` ready line, and loads the window on that origin; the browser client runs unchanged, including its reconnect contract. The design record is the [desktop shell Agent Note](../../.agents/notes/implemented/feature/2026-08-14-desktop-electron-sidecar-shell.md).

## Run from a checkout

```sh
pnpm run build                                    # host lib, tsdown bundle, frontend dist
pnpm --filter @deepseek-ai/dsh-desktop start      # opens the window
```

`DSH_DESKTOP_DSH_BIN=<entry>` overrides the dsh entry file: `.ts` runs under system Node with tsx, anything else runs as plain Node under the Electron binary. `DSH_DESKTOP_SMOKE=1` replaces the visible window with a headless acceptance pass that exits 0 after the page loads.

## Build the application

```sh
pnpm run build                                            # required artifacts for staging
pnpm --filter @deepseek-ai/dsh-desktop run stage          # pnpm deploy closure + completion
pnpm --filter @deepseek-ai/dsh-desktop exec electron-builder --win
```

`stage` runs the repository's `pnpm deploy` recipe into `.stage/dsh`, completes the closure to a fixed point (legacy deploy omits peer-required workspace packages and override-linked vendored packages), makes the tree link-free, asserts every hard requirement resolves inside the staging, and trims build-time weight — TypeScript declarations, source maps, and per-package documentation, about half the closure's file count, are never read at runtime and dominate installer time (measured: 37,485 → 17,253 files, silent install 371 s → 200 s on win-x64). electron-builder then produces `dist-exe/win-unpacked/` (portable app), the NSIS installer, and a portable zip; the closure is copied by the `afterPack` hook because `extraResources` prunes any `node_modules` it carries against this app's own dependency graph. macOS targets need the closure staged on macOS for the platform's native addons; installer icons and code signing are not yet configured.

Installation time is dominated by the payload's file count interacting with real-time antivirus scanning, and the NSIS progress bar can sit on one point while the large compressed block decompresses — that is normal, not a hang. Excluding the install directory from real-time scanning is the remaining lever a user controls.

## Code signing and the free distribution path

Signing activates purely from environment variables — no config change when a certificate arrives:

| Route | Cost | Activation | Effect |
|---|---|---|---|
| None (free) | — | build as-is | Windows shows "Unknown publisher"; users click *More info → Run anyway*; SmartScreen reputation builds slowly over downloads |
| [Certum Open Source](https://certum.eu) certificate | ≈ €25/yr — the cheapest real option, and this MIT project qualifies | `CSC_LINK=<base64 pfx>` + `CSC_KEY_PASSWORD` | Removes "Unknown publisher"; OV-level SmartScreen reputation |
| PFX OV/EV from any CA | OV ≈ $100–400/yr; EV ≈ $300–700/yr | same env vars | EV earns instant SmartScreen reputation |
| Azure Trusted Signing | ≈ $10/mo, no token | `win.azureSignOptions` in `electron-builder.yml` + Entra ID credential env vars; mutually exclusive with `signtoolOptions` | Same SmartScreen effect as OV |

`signtoolOptions.rfc3161TimeStampServer` is already configured: signatures carry an RFC3161 timestamp and stay valid after the certificate expires. The pipeline was verified end to end with a self-signed `CodeSigningCert` (signer subject and timestamp observed on both the app exe and the NSIS installer; status reads `UnknownError` only because a self-signed chain is untrusted). What a real certificate changes is the chain, not the wiring.

### Free tier, maximized

Without a certificate, distribute the **portable zip** and treat the installer as optional: the zip deploys in ~17 s with Windows' bundled `tar -xf` (or any unzip tool) versus ~200 s for the NSIS installer, skips the installer UI and registry entirely, and removes by deleting the folder. Locale packs are pruned to `zh-CN` + `en-US` (53 files, ~40 MB saved). The remaining install-time cost is real-time antivirus scanning over the file count — excluding the destination folder from the scanner is the user-side lever, and signing is the publisher-side one.

## Behavior

| Concern | Contract |
|---|---|
| Host lifecycle | One sidecar per shell; a crash restarts it (at most 3 within 120 s) and reloads the window, then reports and exits. |
| Window | One window; geometry persists under Electron userData and clamps to a visible display; external navigation opens in the system browser. |
| Security | The window never navigates off the loopback origin; the OS-assigned port avoids a guessable one. The host itself has no authentication ([webserver contract](../../packages/host/webserver/README.md)). |
| Shutdown | Quitting stops the host: SIGTERM on POSIX, a forced tree kill on Windows, where child signals are not delivered gracefully. |

## Known Limitations and Deferred Work

- **Installer packaging is naive**: one default Electron icon, no code signing, NSIS on Windows only; macOS and Linux targets and their native-addon staging are untested.
- **The Windows stop path is a hard kill**: `ChildProcess.kill()` on Windows cannot run the host's SIGTERM listeners; the append-durable session log bounds the loss to the in-flight tail.
