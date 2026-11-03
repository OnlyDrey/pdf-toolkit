/// <reference types="node" />
import { createDeflate, crc32 } from 'node:zlib'
import { once } from 'node:events'
export function pngChunk(type: string, data: Uint8Array) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([size, name, data, crc])
}
export async function generatedPng(
  width: number,
  height: number,
  {
    alpha = true,
    depth = 8,
    dpi = 300,
  }: { alpha?: boolean; depth?: number; dpi?: number } = {},
) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = depth
  header[9] = alpha ? 6 : 2
  const phys = Buffer.alloc(9)
  phys.writeUInt32BE(Math.round(dpi / 0.0254), 0)
  phys.writeUInt32BE(Math.round(dpi / 0.0254), 4)
  phys[8] = 1
  const channels = alpha ? 4 : 3,
    pixel =
      depth === 8
        ? Buffer.from(alpha ? [40, 90, 160, 128] : [40, 90, 160])
        : Buffer.from(
            alpha ? [40, 0, 90, 0, 160, 0, 128, 0] : [40, 0, 90, 0, 160, 0],
          )
  // Sub filtering: one pixel followed by zero deltas, avoiding a giant fixture allocation.
  const row = Buffer.alloc(width * channels * (depth / 8) + 1)
  row[0] = 1
  pixel.copy(row, 1)
  const compressor = createDeflate({ level: 1 })
  const chunks: Buffer[] = []
  compressor.on('data', (c) => chunks.push(c))
  for (let y = 0; y < height; y++)
    if (!compressor.write(row)) await once(compressor, 'drain')
  compressor.end()
  await once(compressor, 'end')
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('pHYs', phys),
    pngChunk('IDAT', Buffer.concat(chunks)),
    pngChunk('IEND', new Uint8Array()),
  ])
}
