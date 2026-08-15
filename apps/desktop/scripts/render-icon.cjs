/**
 * Rasterize build/icon.svg to exact-size PNGs with Electron's offscreen
 * renderer. Run under the dev electron binary (NOT Node mode):
 *
 *   electron scripts/render-icon.cjs <svg> <outDir>
 *
 * One reused offscreen window (GPU disabled — the renderer composites in
 * software, which stays reliable in nested/CI environments); content size is
 * reset per capture. `force-device-scale-factor=1` pins the backing scale so
 * each capture is exactly the requested pixel size on any display.
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  const [svgPath, outDir] = process.argv.slice(2)
  if (svgPath === undefined || outDir === undefined) {
    console.error('usage: electron render-icon.cjs <svg> <outDir>')
    app.exit(1)
    return
  }
  // Every failure must exit: a rejected ready handler leaves a windowless
  // GUI process running forever (the leak this guard closes).
  try {
    const svg = fs.readFileSync(svgPath, 'utf8')
    // A frame HTML on disk (loaded via file://) instead of a data URL: long
    // data URLs fail intermittently under Chromium.
    fs.mkdirSync(outDir, { recursive: true })
    const framePath = path.join(path.resolve(outDir), 'frame.html')
    fs.writeFileSync(framePath, `<!doctype html><html><head><style>
html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}
svg{display:block;width:100%;height:100%}
</style></head><body>${svg}</body></html>`)

    const win = new BrowserWindow({
      width: SIZES[0],
      height: SIZES[0],
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: true },
    })
    await win.loadFile(framePath)
    for (const size of SIZES) {
      win.setContentSize(size, size)
      await new Promise((resolve) => { win.webContents.once('paint', resolve) })
      const image = await win.webContents.capturePage()
      fs.writeFileSync(path.join(outDir, `icon-${size}.png`), image.toPNG())
      console.log(`rendered ${size}x${size} (${image.getSize().width}x${image.getSize().height})`)
    }
    win.destroy()
    app.exit(0)
  } catch (error) {
    console.error(`render-icon failed: ${error instanceof Error ? error.message : String(error)}`)
    app.exit(1)
  }
})
