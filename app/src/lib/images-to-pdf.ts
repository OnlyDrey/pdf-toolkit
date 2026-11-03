import {
  PDFDocument,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
  concatTransformationMatrix,
  drawObject,
  type PDFRef,
} from 'pdf-lib'
import { MAX_PDF_BYTES } from './pdf-document'
import { ImageInputError } from './image-errors'
export { ImageInputError } from './image-errors'
import {
  readPng,
  canStreamPng,
  preparePng,
  validatePngDataCrc,
  type PreparedPng,
  type PngSource,
} from './png-stream'
export interface PreparedImageData {
  info: ImageInfo
  thumbnail?: Blob
}
export function releaseImage(entry: ImageEntry) {
  if (entry.thumbnail) URL.revokeObjectURL(entry.thumbnail)
  releasePreparedImage(entry.id)
}
export const IMAGE_LIMITS = { count: 100 }
export const IMAGE_DPI = 96
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp'
export interface ImageInfo {
  format: ImageFormat
  width: number
  height: number
  orientation: number
  dpiX?: number
  dpiY?: number
}
export interface ImageEntry extends ImageInfo {
  id: string
  file: File
  thumbnail?: string
}
export interface ImagePdfOptions {
  size: 'a4' | 'letter' | 'original'
  orientation: 'auto' | 'portrait' | 'landscape'
  fit: 'contain' | 'cover'
  margin: 'none' | 'small' | 'normal'
}
export const DEFAULT_IMAGE_OPTIONS: ImagePdfOptions = {
  size: 'a4',
  orientation: 'auto',
  fit: 'contain',
  margin: 'normal',
}
const invalid = (): never => {
  throw new ImageInputError('corrupt')
}
function exifOrientation(bytes: Uint8Array): number {
  // A bounded IFD0 read: no pointers are followed outside this EXIF segment.
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const little = v.getUint16(0) === 0x4949
    if ((!little && v.getUint16(0) !== 0x4d4d) || v.getUint16(2, little) !== 42)
      return 1
    const start = v.getUint32(4, little)
    const count = Math.min(v.getUint16(start, little), 4096)
    for (let n = 0; n < count; n++) {
      const p = start + 2 + n * 12
      if (
        v.getUint16(p, little) === 0x112 &&
        v.getUint16(p + 2, little) === 3 &&
        v.getUint32(p + 4, little) === 1
      ) {
        const value = v.getUint16(p + 8, little)
        return value >= 1 && value <= 8 ? value : 1
      }
    }
  } catch {
    /* Malformed EXIF does not authorize an out-of-bounds read. */
  }
  return 1
}
function exifResolution(bytes: Uint8Array): { dpiX?: number; dpiY?: number } {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      little = v.getUint16(0) === 0x4949,
      start = v.getUint32(4, little),
      count = v.getUint16(start, little)
    let x: number | undefined,
      y: number | undefined,
      unit = 2
    for (let n = 0; n < Math.min(count, 4096); n++) {
      const p = start + 2 + n * 12,
        tag = v.getUint16(p, little),
        type = v.getUint16(p + 2, little)
      if (tag === 0x128 && type === 3) unit = v.getUint16(p + 8, little)
      if (
        (tag === 0x11a || tag === 0x11b) &&
        type === 5 &&
        v.getUint32(p + 4, little) === 1
      ) {
        const offset = v.getUint32(p + 8, little),
          value = v.getUint32(offset, little) / v.getUint32(offset + 4, little)
        if (Number.isFinite(value) && value > 0) {
          if (tag === 0x11a) x = value
          else y = value
        }
      }
    }
    if (x && y && (unit === 2 || unit === 3))
      return {
        dpiX: x * (unit === 3 ? 2.54 : 1),
        dpiY: y * (unit === 3 ? 2.54 : 1),
      }
  } catch {
    /* Invalid metadata is not a physical-size instruction. */
  }
  return {}
}
export function validateImageSize(width: number, height: number) {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) invalid()
}
export function inspectImage(bytes: Uint8Array, headerOnly = false): ImageInfo {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const text = (start: number, length: number) =>
      String.fromCharCode(...bytes.subarray(start, start + length))
    let dpiX: number | undefined, dpiY: number | undefined
    let format: ImageFormat,
      width = 0,
      height = 0,
      orientation = 1
    if (['II*\0', 'MM\0*', 'II+\0', 'MM\0+'].includes(text(0, 4)))
      throw new ImageInputError('tiff')
    if (v.getUint16(0) === 0xffd8) {
      format = 'jpeg'
      let p = 2
      while (p + 4 <= bytes.length) {
        if (bytes[p++] !== 0xff) invalid()
        while (bytes[p] === 0xff) p++
        const marker = bytes[p++]
        if (marker === 0xda || marker === 0xd9) break
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
        const length = v.getUint16(p)
        if (length < 2 || p + length > bytes.length) invalid()
        if (marker === 0xe0 && text(p + 2, 5) === 'JFIF\0' && length >= 16) {
          const unit = bytes[p + 9]
          if (unit === 1 || unit === 2) {
            dpiX = v.getUint16(p + 10) * (unit === 2 ? 2.54 : 1) || undefined
            dpiY = v.getUint16(p + 12) * (unit === 2 ? 2.54 : 1) || undefined
          }
        }
        if (marker === 0xe1 && text(p + 2, 6) === 'Exif\0\0') {
          const exif = bytes.subarray(p + 8, p + length)
          orientation = exifOrientation(exif)
          const dpi = exifResolution(exif)
          dpiX = dpi.dpiX ?? dpiX
          dpiY = dpi.dpiY ?? dpiY
        }
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
          height = v.getUint16(p + 3)
          width = v.getUint16(p + 5)
        }
        p += length
      }
    } else if (text(0, 8) === '\x89PNG\r\n\x1a\n' && text(12, 4) === 'IHDR') {
      format = 'png'
      width = v.getUint32(16)
      height = v.getUint32(20)
      // PNG eXIf stores the TIFF header directly, without an Exif prefix.
      for (let p = 8; p + 12 <= bytes.length;) {
        const length = v.getUint32(p)
        if (p + length + 12 > bytes.length) invalid()
        if (text(p + 4, 4) === 'eXIf')
          orientation = exifOrientation(bytes.subarray(p + 8, p + 8 + length))
        p += length + 12
      }
    } else if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
      format = 'webp'
      const chunk = text(12, 4)
      const u24 = (p: number) =>
        v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16)
      if (chunk === 'VP8X') {
        width = u24(24) + 1
        height = u24(27) + 1
      } else if (chunk === 'VP8 ' && text(23, 3) === '\x9d\x01\x2a') {
        width = v.getUint16(26, true) & 0x3fff
        height = v.getUint16(28, true) & 0x3fff
      } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
        const bits = v.getUint32(21, true)
        width = (bits & 0x3fff) + 1
        height = ((bits >>> 14) & 0x3fff) + 1
      }
      for (let p = 12; p + 8 <= bytes.length;) {
        const length = v.getUint32(p + 4, true)
        if (p + 8 + length > bytes.length) {
          if (headerOnly) break
          invalid()
        }
        if (text(p, 4) === 'EXIF') {
          const start = text(p + 8, 6) === 'Exif\0\0' ? p + 14 : p + 8
          orientation = exifOrientation(bytes.subarray(start, p + 8 + length))
        }
        p += 8 + length + (length % 2)
      }
    } else if (['GIF87a', 'GIF89a'].includes(text(0, 6))) {
      format = 'gif'
      width = v.getUint16(6, true)
      height = v.getUint16(8, true)
    } else if (text(0, 2) === 'BM' && v.getUint32(14, true) >= 40) {
      format = 'bmp'
      width = v.getInt32(18, true)
      height = Math.abs(v.getInt32(22, true))
    } else throw new ImageInputError('type')
    validateImageSize(width, height)
    return {
      format,
      width: orientation >= 5 ? height : width,
      height: orientation >= 5 ? width : height,
      orientation,
      ...(dpiX && dpiY
        ? orientation >= 5
          ? { dpiX: dpiY, dpiY: dpiX }
          : { dpiX, dpiY }
        : {}),
    }
  } catch (error) {
    if (error instanceof ImageInputError) throw error
    return invalid()
  }
}
export function validateImageBatch(files: Pick<File, 'size'>[]) {
  if (!files.length) throw new ImageInputError('empty')
  if (files.length > IMAGE_LIMITS.count) throw new ImageInputError('batch')
}
const prepared = new Map<string, PreparedPng>()
export function releasePreparedImage(key: string) {
  prepared.delete(key)
}
function cachedPng(key: string, data: PreparedPng) {
  let size = data.colors.byteLength + (data.alpha?.byteLength ?? 0)
  for (const [id, value] of prepared)
    if (id !== key)
      size += value.colors.byteLength + (value.alpha?.byteLength ?? 0)
  if (size > MAX_PDF_BYTES) throw new ImageInputError('output')
  prepared.set(key, data)
}
function canvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined')
    return new OffscreenCanvas(width, height)
  const node = document.createElement('canvas')
  node.width = width
  node.height = height
  return node
}
async function canvasBlob(
  node: OffscreenCanvas | HTMLCanvasElement,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && node instanceof OffscreenCanvas)
    return node.convertToBlob({ type: 'image/png' })
  return new Promise((resolve, reject) =>
    (node as HTMLCanvasElement).toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new ImageInputError('resource')),
      'image/png',
    ),
  )
}
// Native full-size decode/canvas fallback needs multiple decoded pixel buffers.
// This working-memory estimate does not apply to direct JPEG or streamed PNG.
export function checkDecodeBudget(
  width: number,
  height: number,
  bytesPerPixel = 16,
) {
  validateImageSize(width, height)
  const memory = (
    globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  )?.deviceMemory
  const budget = Math.min(256, memory ? memory * 64 : 256) * 1024 ** 2
  if (width * height * bytesPerPixel > budget)
    throw new ImageInputError('resource')
}
function pngInfo(png: PngSource): ImageInfo {
  const orientation = png.exif ? exifOrientation(png.exif) : 1
  return {
    format: 'png',
    width: orientation >= 5 ? png.height : png.width,
    height: orientation >= 5 ? png.width : png.height,
    orientation,
    ...(png.dpiX && png.dpiY
      ? orientation >= 5
        ? { dpiX: png.dpiY, dpiY: png.dpiX }
        : { dpiX: png.dpiX, dpiY: png.dpiY }
      : {}),
  }
}
async function pngThumbnail(
  raster: PreparedPng,
  orientation: number,
): Promise<Blob> {
  const raw = canvas(raster.thumbWidth, raster.thumbHeight)
  const target =
    orientation === 1
      ? raw
      : canvas(
          orientation >= 5 ? raster.thumbHeight : raster.thumbWidth,
          orientation >= 5 ? raster.thumbWidth : raster.thumbHeight,
        )
  try {
    const context = raw.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!context) throw new ImageInputError('resource')
    context.putImageData(
      new ImageData(raster.thumbnail, raster.thumbWidth, raster.thumbHeight),
      0,
      0,
    )
    if (target !== raw) {
      const output = target.getContext('2d') as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
      if (!output) throw new ImageInputError('resource')
      const [a, b, c, d, e, f] = orientationMatrix(orientation)
      output.setTransform(
        a * target.width,
        -b * target.height,
        -c * target.width,
        d * target.height,
        (c + e) * target.width,
        (1 - d - f) * target.height,
      )
      output.drawImage(raw, 0, 0, 1, 1)
    }
    return await canvasBlob(target)
  } finally {
    raw.width = raw.height = target.width = target.height = 0
  }
}
async function readInfo(file: File): Promise<ImageInfo> {
  const first = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  if (first[0] === 137 && first[1] === 80) return pngInfo(await readPng(file))
  if (
    String.fromCharCode(...first.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...first.subarray(8, 12)) === 'WEBP'
  ) {
    const info = inspectImage(first, true)
    for (let offset = 12; offset + 8 <= file.size;) {
      const header = new Uint8Array(
          await file.slice(offset, offset + 8).arrayBuffer(),
        ),
        length = new DataView(header.buffer).getUint32(4, true)
      if (offset + 8 + length > file.size) invalid()
      if (
        String.fromCharCode(...header.subarray(0, 4)) === 'EXIF' &&
        length <= 1024 * 1024
      ) {
        let bytes = new Uint8Array(
          await file.slice(offset + 8, offset + 8 + length).arrayBuffer(),
        )
        if (String.fromCharCode(...bytes.subarray(0, 6)) === 'Exif\0\0')
          bytes = bytes.subarray(6)
        const orientation = exifOrientation(bytes),
          dpi = exifResolution(bytes)
        return {
          ...info,
          orientation,
          width: orientation >= 5 ? info.height : info.width,
          height: orientation >= 5 ? info.width : info.height,
          ...(dpi.dpiX && dpi.dpiY
            ? orientation >= 5
              ? { dpiX: dpi.dpiY, dpiY: dpi.dpiX }
              : dpi
            : {}),
        }
      }
      offset += 8 + length + (length % 2)
    }
    return info
  }
  if (first[0] === 255 && first[1] === 216 && file.size > MAX_PDF_BYTES)
    throw new ImageInputError('output')
  // JPEG metadata may precede a large compressed scan. Read only its header.
  let length = Math.min(file.size, 512 * 1024)
  for (;;) {
    try {
      return inspectImage(
        new Uint8Array(await file.slice(0, length).arrayBuffer()),
        true,
      )
    } catch (error) {
      if (first[0] !== 255 || first[1] !== 216 || length === file.size)
        throw error
      length = Math.min(file.size, length * 2)
    }
  }
}
async function nativeThumbnail(
  file: File,
  info: ImageInfo,
): Promise<Blob | undefined> {
  const scale = Math.min(1, 160 / info.width, 160 / info.height),
    width = Math.max(1, Math.round(info.width * scale)),
    height = Math.max(1, Math.round(info.height * scale))
  let bitmap: ImageBitmap | undefined
  const node = canvas(width, height)
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'low',
    })
    const context = node.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!context) throw new ImageInputError('resource')
    context.drawImage(bitmap, 0, 0, width, height)
    return await canvasBlob(node)
  } catch (error) {
    throw error instanceof ImageInputError
      ? error
      : error instanceof RangeError
        ? new ImageInputError('resource')
        : new ImageInputError('corrupt')
  } finally {
    bitmap?.close()
    node.width = node.height = 0
  }
}
export async function prepareImageData(
  file: File,
  key: string,
): Promise<PreparedImageData> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const source =
    head[0] === 137 && head[1] === 80 ? await readPng(file) : undefined
  const info = source ? pngInfo(source) : await readInfo(file)
  if (source) {
    if (
      canStreamPng(source) &&
      typeof CompressionStream !== 'undefined' &&
      typeof DecompressionStream !== 'undefined'
    ) {
      const raster = await preparePng(file, source)
      cachedPng(key, raster)
      // A preview failure must not reject a validated, streamable original.
      let thumbnail: Blob | undefined
      try {
        thumbnail = await pngThumbnail(raster, info.orientation)
      } catch {
        /* UI shows the preview-unavailable placeholder. */
      }
      return { info, thumbnail }
    }
    if (source.depth === 16) throw new ImageInputError('encoding')
    checkDecodeBudget(info.width, info.height, 24)
    await validatePngDataCrc(file, source)
  } else if (info.format !== 'jpeg') checkDecodeBudget(info.width, info.height)
  return { info, thumbnail: await nativeThumbnail(file, info) }
}
let nextImageId = 0
export async function prepareImage(file: File): Promise<ImageEntry> {
  const id = `image-${++nextImageId}`
  try {
    const result = await prepareImageData(file, id)
    return {
      ...result.info,
      id,
      file,
      thumbnail: result.thumbnail
        ? URL.createObjectURL(result.thumbnail)
        : undefined,
    }
  } catch (error) {
    throw error instanceof RangeError ? new ImageInputError('resource') : error
  }
}
export function imageLayout(
  width: number,
  height: number,
  options: ImagePdfOptions,
  dpiX = IMAGE_DPI,
  dpiY = IMAGE_DPI,
) {
  validateImageSize(width, height)
  if (
    !['a4', 'letter', 'original'].includes(options.size) ||
    !['auto', 'portrait', 'landscape'].includes(options.orientation) ||
    !['contain', 'cover'].includes(options.fit) ||
    !['none', 'small', 'normal'].includes(options.margin)
  )
    throw new ImageInputError('processing')
  let [pageWidth, pageHeight] =
    options.size === 'a4'
      ? [595.28, 841.89]
      : options.size === 'letter'
        ? [612, 792]
        : [(width * 72) / dpiX, (height * 72) / dpiY]
  const landscape =
    options.orientation === 'auto'
      ? width > height
      : options.orientation === 'landscape'
  ;[pageWidth, pageHeight] = landscape
    ? [Math.max(pageWidth, pageHeight), Math.min(pageWidth, pageHeight)]
    : [Math.min(pageWidth, pageHeight), Math.max(pageWidth, pageHeight)]
  const margin = { none: 0, small: 12, normal: 24 }[options.margin]
  // Original size describes the image area; margins add to it instead of consuming small images.
  if (options.size === 'original') {
    pageWidth += margin * 2
    pageHeight += margin * 2
  }
  if (
    ![pageWidth, pageHeight].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 14400,
    )
  )
    throw new ImageInputError('pageSize')
  const availableWidth = pageWidth - margin * 2,
    availableHeight = pageHeight - margin * 2
  const factor = (options.fit === 'cover' ? Math.max : Math.min)(
    availableWidth / width,
    availableHeight / height,
  )
  const drawWidth = width * factor,
    drawHeight = height * factor
  return {
    pageWidth,
    pageHeight,
    margin,
    drawWidth,
    drawHeight,
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
  }
}
// Transform raw JPEG unit-square coordinates to its EXIF-oriented unit square.
export function orientationMatrix(
  orientation: number,
): [number, number, number, number, number, number] {
  const matrices: [number, number, number, number, number, number][] = [
    [1, 0, 0, 1, 0, 0],
    [-1, 0, 0, 1, 1, 0],
    [-1, 0, 0, -1, 1, 1],
    [1, 0, 0, -1, 0, 1],
    [0, -1, -1, 0, 1, 1],
    [0, -1, 1, 0, 0, 1],
    [0, 1, 1, 0, 0, 0],
    [0, 1, -1, 0, 1, 0],
  ]
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8)
    throw new ImageInputError('corrupt')
  return matrices[orientation - 1]
}
function pngRef(doc: PDFDocument, raster: PreparedPng): PDFRef {
  const image = (data: Uint8Array, channels: number, mask?: PDFRef) =>
    doc.context.register(
      doc.context.stream(data, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: raster.width,
        Height: raster.height,
        BitsPerComponent: raster.depth,
        ColorSpace: channels === 1 ? 'DeviceGray' : 'DeviceRGB',
        Filter: 'FlateDecode',
        DecodeParms: {
          Predictor: 15,
          Colors: channels,
          BitsPerComponent: raster.depth,
          Columns: raster.width,
        },
        ...(mask ? { SMask: mask } : raster.mask ? { Mask: raster.mask } : {}),
      }),
    )
  const mask = raster.alpha ? image(raster.alpha, 1) : undefined
  return image(raster.colors, raster.channels, mask)
}
export function drawImagePage(
  doc: PDFDocument,
  ref: PDFRef,
  info: ImageInfo,
  options: ImagePdfOptions,
) {
  const l = imageLayout(info.width, info.height, options, info.dpiX, info.dpiY)
  const page = doc.addPage([l.pageWidth, l.pageHeight])
  const [a, b, c, d, e, f] = orientationMatrix(info.orientation)
  const name = page.node.newXObject('Image', ref)
  page.pushOperators(
    pushGraphicsState(),
    rectangle(
      l.margin,
      l.margin,
      l.pageWidth - 2 * l.margin,
      l.pageHeight - 2 * l.margin,
    ),
    clip(),
    endPath(),
    concatTransformationMatrix(
      a * l.drawWidth,
      b * l.drawHeight,
      c * l.drawWidth,
      d * l.drawHeight,
      l.x + e * l.drawWidth,
      l.y + f * l.drawHeight,
    ),
    drawObject(name),
    popGraphicsState(),
  )
}
export async function addImagePage(
  doc: PDFDocument,
  bytes: Uint8Array,
  info: ImageInfo,
  options: ImagePdfOptions,
) {
  const embedded =
    info.format === 'jpeg'
      ? await doc.embedJpg(bytes)
      : await doc.embedPng(bytes)
  await embedded.embed()
  drawImagePage(doc, embedded.ref, info, options)
}
export async function convertImages(
  entries: ImageEntry[],
  options: ImagePdfOptions,
  progress: (done: number, total: number) => void,
) {
  validateImageBatch(entries.map((entry) => entry.file))
  const doc = await PDFDocument.create()
  for (let n = 0; n < entries.length; n++) {
    const entry = entries[n],
      info = entry as ImageInfo
    // Reject physical page sizes before any large data allocation. Pixels stay intact.
    imageLayout(info.width, info.height, options, info.dpiX, info.dpiY)
    if (info.format === 'png') {
      let raster = prepared.get(entry.id)
      if (!raster) {
        const source = await readPng(entry.file)
        if (canStreamPng(source)) raster = await preparePng(entry.file, source)
      }
      if (raster) drawImagePage(doc, pngRef(doc, raster), info, options)
      else {
        checkDecodeBudget(info.width, info.height, 24)
        await addImagePage(
          doc,
          new Uint8Array(await entry.file.arrayBuffer()),
          info,
          options,
        )
      }
    } else if (info.format === 'jpeg')
      await addImagePage(
        doc,
        new Uint8Array(await entry.file.arrayBuffer()),
        info,
        options,
      )
    else {
      checkDecodeBudget(info.width, info.height)
      let bitmap: ImageBitmap | undefined
      const node = canvas(info.width, info.height)
      try {
        bitmap = await createImageBitmap(entry.file, {
          imageOrientation: 'from-image',
        })
        const context = node.getContext('2d') as
          CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
        if (!context) throw new ImageInputError('resource')
        context.drawImage(bitmap, 0, 0)
        const bytes = new Uint8Array(
          await (await canvasBlob(node)).arrayBuffer(),
        )
        await addImagePage(doc, bytes, { ...info, orientation: 1 }, options)
      } catch (error) {
        throw error instanceof ImageInputError
          ? error
          : error instanceof RangeError
            ? new ImageInputError('resource')
            : new ImageInputError('corrupt')
      } finally {
        bitmap?.close()
        node.width = node.height = 0
      }
    }
    let encoded = 0
    for (const [, object] of doc.context.enumerateIndirectObjects())
      if ('getContentsSize' in object)
        encoded += (
          object as { getContentsSize: () => number }
        ).getContentsSize()
    if (encoded > MAX_PDF_BYTES) throw new ImageInputError('output')
    progress(n + 1, entries.length)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const bytes = await doc.save()
  if (bytes.byteLength > MAX_PDF_BYTES) throw new ImageInputError('output')
  return bytes
}
export async function imagesToPdf(
  entries: ImageEntry[],
  options: ImagePdfOptions,
  progress: (done: number, total: number) => void,
) {
  try {
    return await convertImages(entries, options, progress)
  } catch (error) {
    throw error instanceof ImageInputError
      ? error
      : error instanceof RangeError
        ? new ImageInputError('resource')
        : new ImageInputError('processing')
  }
}
