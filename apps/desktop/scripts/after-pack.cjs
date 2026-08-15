/**
 * electron-builder afterPack hook: copy the staged dsh closure into the app's
 * resources verbatim. extraResources cannot carry it — electron-builder prunes
 * any node_modules tree it copies against the app's own dependency graph
 * ("no node modules returned"), which would strip the closure. The staging
 * tree is already link-free, so a dereferencing copy is plain bytes.
 */

const { cp, rm } = require('node:fs/promises')
const { join, resolve } = require('node:path')

module.exports = async function afterPack(context) {
  const staging = resolve(__dirname, '..', '.stage', 'dsh')
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  await rm(join(resourcesDir, 'dsh'), { recursive: true, force: true })
  await cp(staging, join(resourcesDir, 'dsh'), { recursive: true, dereference: true })
  console.log(`after-pack: staged dsh closure into ${join(resourcesDir, 'dsh')}`)
}
