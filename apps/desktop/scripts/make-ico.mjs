/**
 * Compose a Windows .ico from exact-size PNG renders (PNG-in-ICO, supported
 * since Vista). Usage: node scripts/make-ico.mjs <pngDir> <out.ico>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [pngDir, outPath] = process.argv.slice(2)
if (pngDir === undefined || outPath === undefined) {
  throw new Error('usage: node make-ico.mjs <pngDir> <out.ico>')
}

const pngs = readdirSync(pngDir)
  .filter((name) => /^icon-(\d+)\.png$/.exec(name) !== null)
  .map((name) => {
    const size = Number.parseInt(/^icon-(\d+)\.png$/.exec(name)[1], 10)
    return { size, data: readFileSync(join(pngDir, name)) }
  })
  .sort((a, b) => a.size - b.size)
if (pngs.length === 0) throw new Error(`no icon-<size>.png files under ${pngDir}`)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // icon type
header.writeUInt16LE(pngs.length, 4)

const entries = Buffer.alloc(16 * pngs.length)
let offset = header.length + entries.length
const blobs = []
pngs.forEach(({ size, data }, index) => {
  const base = index * 16
  entries.writeUInt8(size >= 256 ? 0 : size, base)
  entries.writeUInt8(size >= 256 ? 0 : size, base + 1)
  entries.writeUInt8(0, base + 2) // palette
  entries.writeUInt8(0, base + 3)
  entries.writeUInt16LE(1, base + 4) // planes
  entries.writeUInt16LE(32, base + 6) // bit count
  entries.writeUInt32LE(data.length, base + 8)
  entries.writeUInt32LE(offset, base + 12)
  offset += data.length
  blobs.push(data)
})

writeFileSync(outPath, Buffer.concat([header, entries, ...blobs]))
console.log(`wrote ${outPath}: ${pngs.map((p) => p.size).join(', ')} px, ${offset} bytes`)
