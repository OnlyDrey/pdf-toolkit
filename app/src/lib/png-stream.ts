import { ImageInputError } from './image-errors'
import { MAX_PDF_BYTES } from './pdf-document'

// PNG scanlines, not full-image RGBA buffers. Only non-interlaced 8-bit gray/RGB
// (+ alpha) use this path. Other encodings use the explicitly budgeted decoder.
export interface PngSource {
  width: number
  height: number
  depth: number
  color: number
  interlace: number
  idat: { start: number; length: number; crc: number }[]
  dpiX?: number
  dpiY?: number
  exif?: Uint8Array
  transparency?: Uint8Array
}
export interface PreparedPng {
  colors: Uint8Array
  alpha?: Uint8Array
  channels: number
  depth: number
  width: number
  height: number
  thumbnail: Uint8ClampedArray<ArrayBuffer>
  thumbWidth: number
  thumbHeight: number
  mask?: number[]
}
const bad = (): never => {
  throw new ImageInputError('corrupt')
}
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
export function crc32(bytes: Uint8Array, value = 0xffffffff) {
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8)
  return value >>> 0
}
const typeBytes = (type: string) => new TextEncoder().encode(type)
async function bytes(file: Blob, start: number, length: number) {
  const data = new Uint8Array(
    await file.slice(start, start + length).arrayBuffer(),
  )
  if (data.length !== length) bad()
  return data
}
export async function readPng(file: Blob): Promise<PngSource> {
  const header = await bytes(file, 0, 8)
  if (!header.every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i])) bad()
  let result: PngSource | undefined,
    ended = false,
    afterData = false,
    seenData = false,
    palette = false
  for (let offset = 8; offset < file.size;) {
    const h = await bytes(file, offset, 8),
      v = new DataView(h.buffer)
    const length = v.getUint32(0),
      type = String.fromCharCode(...h.subarray(4))
    if (
      length > 0x7fffffff ||
      offset + length + 12 > file.size ||
      !/^[A-Za-z]{4}$/.test(type)
    )
      bad()
    const crc = new DataView(
      (await bytes(file, offset + 8 + length, 4)).buffer,
    ).getUint32(0)
    if (!result && type !== 'IHDR') bad()
    if (type === 'IDAT') {
      if (afterData || !result || (result.color === 3 && !palette)) bad()
      result!.idat.push({ start: offset + 8, length, crc })
      seenData = true
    } else {
      if (seenData) afterData = true
      // CRC even for ignored ancillary chunks, with bounded reads.
      let check = crc32(h.subarray(4))
      for (let p = 0; p < length; p += 65536)
        check = crc32(
          await bytes(file, offset + 8 + p, Math.min(65536, length - p)),
          check,
        )
      if ((check ^ 0xffffffff) >>> 0 !== crc) bad()
      if (type === 'IHDR') {
        if (result || length !== 13) bad()
        const raw = await bytes(file, offset + 8, 13),
          data = new DataView(raw.buffer)
        const width = data.getUint32(0),
          height = data.getUint32(4),
          depth = raw[8],
          color = raw[9]
        const depths: Record<number, number[]> = {
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16],
        }
        if (
          !width ||
          !height ||
          width > 0x7fffffff ||
          height > 0x7fffffff ||
          !depths[color]?.includes(depth) ||
          raw[10] ||
          raw[11] ||
          raw[12] > 1
        )
          bad()
        result = { width, height, depth, color, interlace: raw[12], idat: [] }
      } else if (type === 'pHYs' && length === 9 && !seenData) {
        const raw = await bytes(file, offset + 8, 9),
          data = new DataView(raw.buffer)
        if (raw[8] === 1) {
          result!.dpiX = data.getUint32(0) * 0.0254 || undefined
          result!.dpiY = data.getUint32(4) * 0.0254 || undefined
        }
      } else if (type === 'eXIf' && length <= 1024 * 1024)
        result!.exif = await bytes(file, offset + 8, length)
      else if (type === 'tRNS') {
        if (seenData || length > 256) bad()
        result!.transparency = await bytes(file, offset + 8, length)
      } else if (type === 'PLTE') {
        if (seenData || !length || length > 768 || length % 3) bad()
        palette = true
      } else if (type === 'IEND') {
        if (length || !seenData || offset + 12 !== file.size) bad()
        ended = true
      } else if (type[0] === type[0].toUpperCase() && type !== 'IHDR')
        throw new ImageInputError('encoding')
    }
    offset += length + 12
  }
  if (!result || !ended || !result.idat.length) bad()
  return result!
}
export const canStreamPng = (png: PngSource) =>
  [8, 16].includes(png.depth) &&
  png.interlace === 0 &&
  [0, 2, 4, 6].includes(png.color)
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
export function unfilterRow(
  row: Uint8Array,
  previous: Uint8Array,
  channels: number,
  filter: number,
) {
  if (filter > 4) bad()
  for (let x = 0; x < row.length; x++) {
    const a = x >= channels ? row[x - channels] : 0,
      b = previous[x],
      c = x >= channels ? previous[x - channels] : 0
    if (filter)
      row[x] =
        (row[x] +
          (filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? Math.floor((a + b) / 2)
                : paeth(a, b, c))) &
        255
  }
}
async function collect(
  stream: ReadableStream<Uint8Array>,
  budget: { bytes: number },
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of stream) {
    length += chunk.length
    budget.bytes += chunk.length
    if (budget.bytes > MAX_PDF_BYTES) throw new ImageInputError('output')
    chunks.push(chunk)
  }
  const data = new Uint8Array(length)
  let p = 0
  for (const chunk of chunks) {
    data.set(chunk, p)
    p += chunk.length
  }
  return data
}
export async function preparePng(
  file: Blob,
  png: PngSource,
): Promise<PreparedPng> {
  if (!canStreamPng(png)) throw new ImageInputError('encoding')
  if (
    typeof DecompressionStream === 'undefined' ||
    typeof CompressionStream === 'undefined'
  )
    throw new ImageInputError('encoding')
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[
      png.color
    ],
    alpha = png.color === 4 || png.color === 6,
    colors = alpha ? channels - 1 : channels
  const sampleBytes = png.depth / 8
  const rowLength = png.width * channels * sampleBytes
  // Protect row allocations themselves; this is a working-buffer budget, not a pixel cap.
  if (!Number.isSafeInteger(rowLength) || rowLength * 4 > 64 * 1024 ** 2)
    throw new ImageInputError('resource')
  const total = png.idat.reduce((sum, c) => sum + c.length, 0)
  if (!alpha && total > MAX_PDF_BYTES) throw new ImageInputError('output')
  const direct = alpha ? undefined : new Uint8Array(total)
  let directOffset = 0
  async function* chunks() {
    for (const part of png.idat) {
      let crc = crc32(typeBytes('IDAT'))
      const source = file
        .slice(part.start, part.start + part.length)
        .stream()
        .getReader()
      try {
        while (true) {
          const { done, value } = await source.read()
          if (done) break
          crc = crc32(value, crc)
          if (direct) {
            direct.set(value, directOffset)
            directOffset += value.length
          }
          yield value
        }
      } finally {
        await source.cancel()
        source.releaseLock()
      }
      if ((crc ^ 0xffffffff) >>> 0 !== part.crc) bad()
    }
  }
  const iterator = chunks()
  const compressed = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return(undefined)
    },
  })
  const reader = compressed
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader()
  const budget = { bytes: 0 },
    colorCompression = alpha ? new CompressionStream('deflate') : undefined,
    alphaCompression = alpha ? new CompressionStream('deflate') : undefined
  const colorOutput = colorCompression
      ? collect(colorCompression.readable, budget)
      : undefined,
    alphaOutput = alphaCompression
      ? collect(alphaCompression.readable, budget)
      : undefined
  // Install rejection handlers immediately while writes are still in progress.
  colorOutput?.catch(() => {})
  alphaOutput?.catch(() => {})
  const colorWriter = colorCompression?.writable.getWriter(),
    alphaWriter = alphaCompression?.writable.getWriter()
  const scale = Math.min(1, 160 / png.width, 160 / png.height),
    thumbWidth = Math.max(1, Math.round(png.width * scale)),
    thumbHeight = Math.max(1, Math.round(png.height * scale))
  const thumbnail = new Uint8ClampedArray(thumbWidth * thumbHeight * 4)
  let row = new Uint8Array(rowLength),
    previous = new Uint8Array(rowLength),
    offset = 0,
    filter = -1,
    y = 0,
    thumbY = 0
  let rgb = alpha
      ? new Uint8Array(png.width * colors * sampleBytes + 1)
      : undefined,
    mask = alpha ? new Uint8Array(png.width * sampleBytes + 1) : undefined
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      let position = 0
      while (position < value.length) {
        if (y >= png.height) bad()
        if (filter < 0) {
          filter = value[position++]
          if (filter > 4) bad()
        }
        const count = Math.min(rowLength - offset, value.length - position)
        row.set(value.subarray(position, position + count), offset)
        offset += count
        position += count
        if (offset !== rowLength) continue
        unfilterRow(row, previous, channels * sampleBytes, filter)
        while (
          thumbY < thumbHeight &&
          Math.min(
            png.height - 1,
            Math.floor(((thumbY + 0.5) * png.height) / thumbHeight),
          ) === y
        ) {
          for (let x = 0; x < thumbWidth; x++) {
            const source =
                Math.min(
                  png.width - 1,
                  Math.floor(((x + 0.5) * png.width) / thumbWidth),
                ) *
                channels *
                sampleBytes,
              target = (thumbY * thumbWidth + x) * 4
            thumbnail[target] = row[source]
            thumbnail[target + 1] =
              colors === 1 ? row[source] : row[source + sampleBytes]
            thumbnail[target + 2] =
              colors === 1 ? row[source] : row[source + 2 * sampleBytes]
            thumbnail[target + 3] = alpha
              ? row[source + (channels - 1) * sampleBytes]
              : 255
            if (png.transparency && !alpha) {
              const t = png.transparency
              const match =
                t.length === colors * 2 &&
                Array.from({ length: colors }, (_, n) => n).every((n) => {
                  const value =
                    sampleBytes === 1
                      ? row[source + n]
                      : row[source + n * 2] * 256 + row[source + n * 2 + 1]
                  return value === t[n * 2] * 256 + t[n * 2 + 1]
                })
              if (match) thumbnail[target + 3] = 0
            }
          }
          thumbY++
        }
        if (rgb && mask) {
          for (let x = 0; x < png.width; x++) {
            for (let c = 0; c < colors; c++)
              for (let byte = 0; byte < sampleBytes; byte++)
                rgb[1 + (x * colors + c) * sampleBytes + byte] =
                  row[(x * channels + c) * sampleBytes + byte]
            for (let byte = 0; byte < sampleBytes; byte++)
              mask[1 + x * sampleBytes + byte] =
                row[(x * channels + channels - 1) * sampleBytes + byte]
          }
          // write() consumes the row before it is reused; bounded stream queues.
          await colorWriter!.write(rgb)
          await alphaWriter!.write(mask)
          rgb = new Uint8Array(rgb.length)
          mask = new Uint8Array(mask.length)
        }
        ;[row, previous] = [previous, row]
        offset = 0
        filter = -1
        y++
        if (y % 32 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    if (y !== png.height || offset || filter !== -1) bad()
    await colorWriter?.close()
    await alphaWriter?.close()
    let colorMask: number[] | undefined
    if (png.transparency && !alpha) {
      const t = png.transparency
      if (t.length !== colors * 2) bad()
      colorMask = []
      for (let c = 0; c < colors; c++) {
        const n = t[c * 2] * 256 + t[c * 2 + 1]
        if (n > (png.depth === 16 ? 65535 : 255)) bad()
        colorMask.push(n, n)
      }
    }
    return {
      colors: direct ?? (await colorOutput!),
      alpha: alphaOutput ? await alphaOutput : undefined,
      channels: colors,
      depth: png.depth,
      width: png.width,
      height: png.height,
      thumbnail,
      thumbWidth,
      thumbHeight,
      mask: colorMask,
    }
  } catch (error) {
    await Promise.allSettled([
      reader.cancel(error),
      colorWriter?.abort(error),
      alphaWriter?.abort(error),
    ])
    throw budget.bytes > MAX_PDF_BYTES
      ? new ImageInputError('output')
      : error instanceof ImageInputError
        ? error
        : new ImageInputError('corrupt')
  } finally {
    reader.releaseLock()
    colorWriter?.releaseLock()
    alphaWriter?.releaseLock()
  }
}
// Fallback codecs still validate IDAT CRCs before invoking a native/full decoder.
export async function validatePngDataCrc(file: Blob, png: PngSource) {
  for (const part of png.idat) {
    let crc = crc32(typeBytes('IDAT'))
    const reader = file
      .slice(part.start, part.start + part.length)
      .stream()
      .getReader()
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        crc = crc32(next.value, crc)
      }
    } finally {
      reader.releaseLock()
    }
    if ((crc ^ 0xffffffff) >>> 0 !== part.crc) bad()
  }
}
