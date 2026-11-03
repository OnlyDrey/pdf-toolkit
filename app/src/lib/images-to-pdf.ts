import {
  PDFDocument,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
  concatTransformationMatrix,
} from 'pdf-lib'
import { MAX_PDF_BYTES } from './pdf-document'

export const IMAGE_LIMITS = {
  fileBytes: 20 * 1024 ** 2,
  batchBytes: 100 * 1024 ** 2,
  pixels: 40_000_000,
  batchPixels: 100_000_000,
  dimension: 16_384,
  count: 100,
}
export const IMAGE_DPI = 96
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp'
export interface ImageInfo {
  format: ImageFormat
  width: number
  height: number
  orientation: number
}
export interface ImageEntry extends ImageInfo {
  id: string
  file: File
  thumbnail: string
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
export class ImageInputError extends Error {
  constructor(
    public code:
      | 'type'
      | 'tiff'
      | 'corrupt'
      | 'large'
      | 'batch'
      | 'empty'
      | 'processing'
      | 'output',
  ) {
    super(code)
  }
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
export function validateImageSize(width: number, height: number) {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) invalid()
  if (
    width > IMAGE_LIMITS.dimension ||
    height > IMAGE_LIMITS.dimension ||
    width * height > IMAGE_LIMITS.pixels
  )
    throw new ImageInputError('large')
}
export function inspectImage(bytes: Uint8Array): ImageInfo {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const text = (start: number, length: number) =>
      String.fromCharCode(...bytes.subarray(start, start + length))
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
        if (marker === 0xe1 && text(p + 2, 6) === 'Exif\0\0')
          orientation = exifOrientation(bytes.subarray(p + 8, p + length))
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
        if (p + 8 + length > bytes.length) invalid()
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
    }
  } catch (error) {
    if (error instanceof ImageInputError) throw error
    return invalid()
  }
}
export function validateImageBatch(files: Pick<File, 'size'>[], pixels = 0) {
  if (!files.length) throw new ImageInputError('empty')
  if (
    pixels > IMAGE_LIMITS.batchPixels ||
    files.length > IMAGE_LIMITS.count ||
    files.reduce((total, file) => total + file.size, 0) >
      IMAGE_LIMITS.batchBytes
  )
    throw new ImageInputError('batch')
  if (files.some((file) => file.size > IMAGE_LIMITS.fileBytes))
    throw new ImageInputError('large')
}
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new ImageInputError('processing')),
      'image/png',
    ),
  )
}
async function decode(file: File) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return invalid()
  }
}
export async function prepareImage(file: File): Promise<ImageEntry> {
  validateImageBatch([file])
  const info = inspectImage(new Uint8Array(await file.arrayBuffer()))
  const bitmap = await decode(file)
  const canvas = document.createElement('canvas')
  try {
    validateImageSize(bitmap.width, bitmap.height)
    if (bitmap.width !== info.width || bitmap.height !== info.height) invalid()
    const scale = Math.min(1, 160 / bitmap.width, 160 / bitmap.height)
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new ImageInputError('processing')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return {
      ...info,
      id: crypto.randomUUID(),
      file,
      thumbnail: URL.createObjectURL(await canvasBlob(canvas)),
    }
  } finally {
    bitmap.close()
    canvas.width = canvas.height = 0
  }
}
export function imageLayout(
  width: number,
  height: number,
  options: ImagePdfOptions,
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
        : [(width * 72) / IMAGE_DPI, (height * 72) / IMAGE_DPI]
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
export async function addImagePage(
  doc: PDFDocument,
  bytes: Uint8Array,
  info: ImageInfo,
  options: ImagePdfOptions,
) {
  const image =
    info.format === 'jpeg'
      ? await doc.embedJpg(bytes)
      : await doc.embedPng(bytes)
  const l = imageLayout(info.width, info.height, options)
  const page = doc.addPage([l.pageWidth, l.pageHeight])
  const [a, b, c, d, e, f] = orientationMatrix(
    info.format === 'jpeg' ? info.orientation : 1,
  )
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
  )
  page.drawImage(image, { x: 0, y: 0, width: 1, height: 1 })
  page.pushOperators(popGraphicsState())
}
export async function imagesToPdf(
  entries: ImageEntry[],
  options: ImagePdfOptions,
  progress: (done: number, total: number) => void,
) {
  validateImageBatch(
    entries.map((entry) => entry.file),
    entries.reduce((sum, entry) => sum + entry.width * entry.height, 0),
  )
  const doc = await PDFDocument.create()
  for (let n = 0; n < entries.length; n++) {
    const entry = entries[n]
    let bytes = new Uint8Array(await entry.file.arrayBuffer())
    const info = inspectImage(bytes)
    if (
      info.format !== 'jpeg' &&
      !(info.format === 'png' && info.orientation === 1)
    ) {
      const bitmap = await decode(entry.file)
      const canvas = document.createElement('canvas')
      try {
        validateImageSize(bitmap.width, bitmap.height)
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (!context) throw new ImageInputError('processing')
        context.drawImage(bitmap, 0, 0)
        bytes = new Uint8Array(await (await canvasBlob(canvas)).arrayBuffer())
      } finally {
        bitmap.close()
        canvas.width = canvas.height = 0
      }
    }
    await addImagePage(doc, bytes, info, options)
    progress(n + 1, entries.length)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const bytes = await doc.save()
  if (bytes.byteLength > MAX_PDF_BYTES) throw new ImageInputError('output')
  return bytes
}
