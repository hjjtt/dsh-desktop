import { defineConfig } from 'tsdown'

/**
 * The desktop shell ships one entry: the Electron main process from
 * `package.json` `main`. Electron is a dev-time runtime (the packaged app
 * carries its own copy), so it stays unbundled.
 */
export default defineConfig({
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron'] },
})
