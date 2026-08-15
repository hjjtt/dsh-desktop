#!/usr/bin/env node
/**
 * Stage the dsh production closure for desktop packaging.
 *
 * Runs the repo's measurement-grounded `pnpm deploy` recipe (flags owned by
 * the single-exe Agent Note) into apps/desktop/.stage/dsh, then completes the
 * closure to a fixed point: legacy deploy with auto-install-peers off omits
 * peer-required workspace packages and override-linked vendored dependencies
 * (cosmokit, schemastery), so every dependency or peer a staged manifest names
 * and the staging lacks is copied from the repository install (dereferenced,
 * nested node_modules skipped — the hoisted root satisfies them). Finally the
 * tree is made link-free and the closure is re-asserted complete, plus the two
 * artifacts the packaged launch resolves (lib/bin.js, the frontend dist).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { cp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..', '..')
const staging = resolve(root, 'apps', 'desktop', '.stage', 'dsh')
const cliDir = resolve(root, 'apps', 'cli')
const stagedNodeModules = join(staging, 'node_modules')

/**
 * Vendored framework packages resolve to their pinned source directories, not
 * node_modules entries. The directory name is the package name's tail.
 */
const VENDORED_PACKAGE_DIRS = new Set([
  'cordis',
  'cosmokit',
  'schemastery',
  'cordis-plugin-loader',
  'cordis-plugin-include',
  'cordis-plugin-group',
  'cordis-plugin-timer',
  'cordis-plugin-hmr',
  'cordis-plugin-logger-console',
])

/**
 * Candidate source directories for one missing package: the two hoisted
 * install roots, the vendored source for vendored names, then every `.pnpm`
 * store entry carrying that package (transitive deps absent from both roots).
 */
function sourceCandidates(name) {
  const candidates = [
    join(cliDir, 'node_modules', ...name.split('/')),
    join(root, 'node_modules', ...name.split('/')),
  ]
  const unscoped = name.replace('@deepseek-ai/', '')
  if (VENDORED_PACKAGE_DIRS.has(unscoped)) {
    candidates.push(join(root, 'vendor', unscoped.replace('cordis-plugin-', '')))
  }
  return [...candidates, ...pnpmStoreCandidates(name)]
}

/** `.pnpm` store entries whose nested node_modules carry `name`. */
function pnpmStoreCandidates(name) {
  const store = join(root, 'node_modules', '.pnpm')
  if (!existsSync(store)) return []
  const segments = name.split('/')
  return readdirSync(store, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(store, entry.name, 'node_modules', ...segments))
    .filter(path => existsSync(path))
}

/** @returns {never} prints the reason and exits nonzero. */
function fail(message) {
  console.error(`stage-dsh: ${message}`)
  process.exit(1)
}

if (!existsSync(join(cliDir, 'lib', 'bin.js'))) {
  fail('apps/cli/lib/bin.js is missing — run `pnpm run build` first.')
}
if (!existsSync(join(root, 'apps', 'web', 'dist', 'index.html'))) {
  fail('apps/web/dist/index.html is missing — run `pnpm run build` first.')
}

await rm(staging, { recursive: true, force: true })
// shell:true (needed for pnpm.cmd on Windows) does not quote arguments, and
// this checkout's path contains a space, so quote every argument ourselves.
const quote = value => /[ \t"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
const deploy = spawnSync('pnpm', [
  '--filter', '@deepseek-ai/dsh',
  'deploy', '--legacy', '--prod',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true',
  quote(staging),
], { cwd: root, stdio: 'inherit', shell: true })
if (deploy.status !== 0) fail('pnpm deploy failed')

/** Package names present in the staging root (hoisted layout, no nesting). */
async function presentPackages() {
  const names = new Set()
  for (const entry of await readdir(stagedNodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('@')) {
      names.add(entry.name)
      continue
    }
    for (const child of await readdir(join(stagedNodeModules, entry.name), { withFileTypes: true })) {
      if (child.isDirectory()) names.add(`${entry.name}/${child.name}`)
    }
  }
  return names
}

/** Every dependency or peer a staged manifest names; optionals included only when `withOptional`. */
async function requiredPackages(present, withOptional) {
  const required = new Set()
  const sections = withOptional
    ? ['dependencies', 'peerDependencies', 'optionalDependencies']
    : ['dependencies', 'peerDependencies']
  for (const name of present) {
    const manifestPath = join(stagedNodeModules, ...name.split('/'), 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    for (const section of sections) {
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        // A peer marked optional in peerDependenciesMeta may stay absent.
        if (manifest.peerDependenciesMeta?.[dependency]?.optional === true) continue
        required.add(dependency)
      }
    }
  }
  return required
}

/** Copy one package from a source directory, dereferencing links, skipping its nested tree. */
async function copyPackage(name, source) {
  const destination = join(stagedNodeModules, ...name.split('/'))
  // Clear partial destinations left by an earlier failed round.
  await rm(destination, { recursive: true, force: true })
  const nestedNodeModules = join(source, 'node_modules')
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => path !== nestedNodeModules && !path.startsWith(`${nestedNodeModules}\\`) && !path.startsWith(`${nestedNodeModules}/`),
  })
}

/** Complete the closure to a fixed point, copying omitted packages from the repository install. */
async function completeClosure() {
  for (let round = 1; ; round += 1) {
    const present = await presentPackages()
    const missing = [...await requiredPackages(present, true)].filter(name => !present.has(name)).sort()
    if (missing.length === 0) return
    let copied = 0
    for (const name of missing) {
      const source = sourceCandidates(name).find(existsSync)
      if (source === undefined) {
        // Platform-conditional optionals absent on this machine are legitimately
        // unstaged; a missing hard requirement fails the final assertion.
        console.log(`stage-dsh: no repository source for ${name}, leaving it absent`)
        continue
      }
      await copyPackage(name, source)
      copied += 1
    }
    console.log(`stage-dsh: round ${String(round)} completed ${String(copied)} omitted package(s)`)
    // When nothing more has a repository source, the remaining names are
    // platform-conditional optionals; the final hard assertion decides.
    if (copied === 0) return
  }
}
await completeClosure()

/**
 * File names whose staged copies are pure build-time weight: TypeScript
 * declarations, source maps, and per-package documentation are never read at
 * runtime (the Loader imports package.json + lib/*.js), and they are roughly
 * half the closure's file count — the dominant installer-time cost. The
 * runtime-JS tree under lib/types is kept: several packages ship browser-safe
 * channels there.
 */
const TRIM_FILE_PATTERNS = [
  /\.d\.cts$/,
  /\.d\.mts$/,
  /\.d\.ts$/,
  /\.map$/,
  /\.tsbuildinfo$/,
  /^README\.md$/,
  /^README\.zh\.md$/,
  /^README\.i18n\.yaml$/,
]

/**
 * Remove every build-time-weight file from the staging, skipping the shipped
 * `config/` tree (agent presets and skills may carry their own documents).
 */
async function trimRuntimeWeight() {
  let removed = 0
  let bytes = 0
  const configDir = join(staging, 'config')
  const stack = [staging]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        if (path === configDir) continue
        stack.push(path)
        continue
      }
      if (!TRIM_FILE_PATTERNS.some(pattern => pattern.test(entry.name))) continue
      const info = await stat(path)
      await rm(path, { force: true })
      removed += 1
      bytes += info.size
    }
  }
  console.log(`stage-dsh: trimmed ${String(removed)} build-time file(s), ${(bytes / 1_000_000).toFixed(1)} MB`)
}

/**
 * Replace every staged link (symlink or Windows junction — both resolve away
 * from their own path) with its target bytes, dropping `.bin` link farms.
 * Loops until the tree is link-free.
 */
async function materializeLinks() {
  let replaced = 0
  for (;;) {
    const link = await findLink(stagedNodeModules)
    if (link === undefined) break
    const source = await realpath(link)
    const nestedNodeModules = join(source, 'node_modules')
    await rm(link, { recursive: true, force: true })
    await cp(source, link, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(`${nestedNodeModules}\\`) && !path.startsWith(`${nestedNodeModules}/`),
    })
    replaced += 1
  }
  if (replaced > 0) console.log(`stage-dsh: materialized ${String(replaced)} staged link(s)`)
}

/** Depth-first search for the first link under `dir`; removes `.bin` dirs on sight. */
async function findLink(dir) {
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.name === '.bin' && entry.isDirectory()) {
        await rm(path, { recursive: true, force: true })
        continue
      }
      if (entry.isDirectory()) {
        // Junctions report as directories; a path that resolves elsewhere is a link.
        if (await realpath(path) !== path) return path
        stack.push(path)
        continue
      }
      if (entry.isSymbolicLink()) return path
    }
  }
  return undefined
}
await materializeLinks()
await trimRuntimeWeight()

// Final assertion: every hard requirement resolves inside the staging. A gap
// here is a deployment bug (a runtime import would fail the same way).
// Platform-conditional optionals are exempt — they are absent by design.
const present = await presentPackages()
const hardMissing = [...await requiredPackages(present, false)]
  .filter(name => !present.has(name))
  .sort()
if (hardMissing.length > 0) fail(`staged closure misses required package(s): ${hardMissing.join(', ')}`)

const stagedBin = join(staging, 'lib', 'bin.js')
const stagedDist = join(staging, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
if (!existsSync(stagedBin)) fail(`expected ${stagedBin} after deploy`)
if (!existsSync(stagedDist)) fail(`expected the bundled frontend dist at ${stagedDist} after deploy`)
console.log(`stage-dsh: staged closure at ${staging}`)
