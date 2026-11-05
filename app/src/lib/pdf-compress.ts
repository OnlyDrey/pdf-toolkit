import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib'
import { loadPdf } from './pdf-document'

export type CompressionMode = 'lossless' | 'balanced' | 'maximum'
export const COMPRESSION_MODES: CompressionMode[] = [
  'lossless',
  'balanced',
  'maximum',
]
export const DEFAULT_COMPRESSION_MODE: CompressionMode = 'balanced'

/** Each mode changes the strategy, not just a number: lossless never touches pixels. */
export interface ModeSettings {
  recompressImages: boolean
  /** Longest effective resolution kept, measured against the page the image is used on. */
  maxDpi: number
  jpegQuality: number
  /** Convert photographic Flate rasters to JPEG (otherwise they are only downsampled). */
  photoToJpeg: boolean
  /** Replace an image only if it becomes at least this much smaller. */
  minGain: number
}
export const MODE_SETTINGS: Record<CompressionMode, ModeSettings> = {
  lossless: {
    recompressImages: false,
    maxDpi: Infinity,
    jpegQuality: 1,
    photoToJpeg: false,
    minGain: 1,
  },
  balanced: {
    recompressImages: true,
    maxDpi: 150,
    jpegQuality: 0.72,
    photoToJpeg: true,
    minGain: 0.9,
  },
  maximum: {
    recompressImages: true,
    maxDpi: 100,
    jpegQuality: 0.5,
    photoToJpeg: true,
    minGain: 0.95,
  },
}

/** Pixel work is delegated so the engine stays testable and the browser owns decoding. */
export interface RasterCodec {
  /** Decode (JPEG bytes or raw samples), scale and return JPEG bytes, or null if unsupported. */
  toJpeg(
    source:
      | { kind: 'jpeg'; bytes: Uint8Array }
      | { kind: 'raw'; pixels: Uint8Array; components: 1 | 3 },
    size: { width: number; height: number },
    target: { width: number; height: number },
    quality: number,
  ): Promise<Uint8Array | null>
  /** Scale raw 8-bit samples without changing their format. */
  scaleRaw(
    pixels: Uint8Array,
    components: 1 | 3,
    size: { width: number; height: number },
    target: { width: number; height: number },
  ): Promise<Uint8Array | null>
}

export interface CompressProgress {
  phase: 'analyzing' | 'images' | 'structure' | 'saving'
  done: number
  total: number
}
export interface CompressStats {
  mode: CompressionMode
  originalBytes: number
  outputBytes: number
  images: { found: number; optimized: number; skipped: number }
  duplicates: number
  removedObjects: number
  deflatedStreams: number
}
export type CompressOutcome =
  | { kind: 'reduced'; bytes: Uint8Array; stats: CompressStats }
  | { kind: 'unchanged'; bytes: Uint8Array; stats: CompressStats }
  | { kind: 'signed'; bytes: Uint8Array; stats: CompressStats }

export const MAX_DECODE_PIXELS = 48 * 1024 ** 2
const cancelled = () => new DOMException('Cancelled', 'AbortError')
const N = PDFName.of

async function flate(
  data: Uint8Array,
  direction: 'compress' | 'decompress',
): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(
      direction === 'compress'
        ? new CompressionStream('deflate')
        : new DecompressionStream('deflate'),
    )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function num(dict: PDFDict, key: string) {
  const value = dict.lookup(N(key))
  return value instanceof PDFNumber ? value.asNumber() : undefined
}
function filterName(dict: PDFDict): string | undefined {
  const filter = dict.lookup(N('Filter'))
  if (!filter) return ''
  if (filter instanceof PDFName) return filter.decodeText()
  if (filter instanceof PDFArray && filter.size() === 1) {
    const first = filter.lookup(0)
    if (first instanceof PDFName) return first.decodeText()
  }
  return undefined
}
function children(object: PDFObject | undefined): PDFObject[] {
  if (object instanceof PDFDict) return object.values()
  if (object instanceof PDFRawStream) return object.dict.values()
  if (object instanceof PDFArray) return object.asArray()
  return []
}

/** Objects reachable from the trailer. Everything else (old revisions, dead streams) is dropped. */
function reachable(context: PDFContext) {
  const seen = new Set<string>()
  const stack: PDFObject[] = [
    context.trailerInfo.Root,
    context.trailerInfo.Info,
  ].filter((value): value is PDFRef => value instanceof PDFRef)
  while (stack.length) {
    const item = stack.pop()!
    if (item instanceof PDFRef) {
      if (seen.has(item.tag)) continue
      seen.add(item.tag)
      const target = context.lookup(item)
      if (target) stack.push(...children(target))
    } else stack.push(...children(item))
  }
  return seen
}

function hasSignature(context: PDFContext) {
  for (const [, object] of context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFRawStream
        ? object.dict
        : object instanceof PDFDict
          ? object
          : undefined
    if (!dict) continue
    if (dict.has(N('ByteRange'))) return true
    const type = dict.lookup(N('Type'))
    if (
      type instanceof PDFName &&
      type.decodeText() === 'Sig' &&
      dict.has(N('Contents'))
    )
      return true
  }
  return false
}

interface ImageInfo {
  ref: PDFRef
  stream: PDFRawStream
  /** Largest page (inches) the image is used on, or the document maximum. */
  inches: { width: number; height: number }
}

/** Which pages reference which image XObjects (one level of forms), for resolution targets. */
function collectImages(doc: PDFDocument): ImageInfo[] {
  const { context } = doc
  const pageInches = doc.getPages().map((page) => {
    const { width, height } = page.getSize()
    return { page, width: width / 72, height: height / 72 }
  })
  const fallback = pageInches.reduce(
    (max, p) => ({
      width: Math.max(max.width, p.width),
      height: Math.max(max.height, p.height),
    }),
    { width: 0, height: 0 },
  )
  const found = new Map<string, ImageInfo>()
  const visit = (
    resources: PDFDict | undefined,
    inches: { width: number; height: number },
    forms: Set<string>,
  ) => {
    const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict)
    if (!xobjects) return
    for (const [, value] of xobjects.entries()) {
      if (!(value instanceof PDFRef)) continue
      const target = context.lookup(value)
      if (!(target instanceof PDFRawStream)) continue
      const subtype = target.dict.lookup(N('Subtype'))
      if (!(subtype instanceof PDFName)) continue
      if (subtype.decodeText() === 'Image') {
        const existing = found.get(value.tag)
        found.set(value.tag, {
          ref: value,
          stream: target,
          inches: existing
            ? {
                width: Math.max(existing.inches.width, inches.width),
                height: Math.max(existing.inches.height, inches.height),
              }
            : inches,
        })
      } else if (subtype.decodeText() === 'Form' && !forms.has(value.tag)) {
        forms.add(value.tag)
        visit(target.dict.lookupMaybe(N('Resources'), PDFDict), inches, forms)
      }
    }
  }
  for (const { page, width, height } of pageInches)
    visit(page.node.Resources(), { width, height }, new Set())
  // Images only reachable through unusual structures keep the safest (largest) target.
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFRawStream &&
      object.dict.lookup(N('Subtype')) === N('Image') &&
      !found.has(ref.tag)
    )
      found.set(ref.tag, { ref, stream: object, inches: fallback })
  }
  return Array.from(found.values())
}

function jpegInfo(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++
      continue
    }
    const marker = bytes[at + 1]
    if (
      marker === 0xff ||
      marker === 0x00 ||
      (marker >= 0xd0 && marker <= 0xd8)
    ) {
      at += marker === 0xff ? 1 : 2
      continue
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3]
    if (marker >= 0xc0 && marker <= 0xc2)
      return { precision: bytes[at + 4], components: bytes[at + 9] }
    if (marker === 0xda) return undefined
    at += 2 + length
  }
  return undefined
}

function colorComponents(dict: PDFDict): 1 | 3 | undefined {
  const space = dict.lookup(N('ColorSpace'))
  if (space instanceof PDFName) {
    const name = space.decodeText()
    return name === 'DeviceRGB' ? 3 : name === 'DeviceGray' ? 1 : undefined
  }
  if (space instanceof PDFArray && space.size() === 2) {
    const kind = space.lookup(0)
    const profile = space.lookup(1)
    if (
      kind instanceof PDFName &&
      kind.decodeText() === 'ICCBased' &&
      profile instanceof PDFRawStream
    ) {
      const n = num(profile.dict, 'N')
      return n === 1 || n === 3 ? n : undefined
    }
  }
  return undefined
}

/** PNG predictors (Predictor >= 10) as used by Flate images. */
function unpredict(data: Uint8Array, columns: number, comps: number) {
  const row = columns * comps
  const rows = Math.floor(data.length / (row + 1))
  const out = new Uint8Array(rows * row)
  for (let y = 0; y < rows; y++) {
    const type = data[y * (row + 1)]
    const src = y * (row + 1) + 1
    const dst = y * row
    for (let x = 0; x < row; x++) {
      const left = x >= comps ? out[dst + x - comps] : 0
      const up = y ? out[dst - row + x] : 0
      const upLeft = y && x >= comps ? out[dst - row + x - comps] : 0
      let add = 0
      if (type === 1) add = left
      else if (type === 2) add = up
      else if (type === 3) add = (left + up) >> 1
      else if (type === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left),
          pb = Math.abs(p - up),
          pc = Math.abs(p - upLeft)
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      } else if (type !== 0) throw new Error('predictor')
      out[dst + x] = (data[src + x] + add) & 255
    }
  }
  return out
}

function looksPhotographic(pixels: Uint8Array, comps: number) {
  const colors = new Set<number>()
  const step = Math.max(1, Math.floor(pixels.length / comps / 8192))
  for (let i = 0; i < pixels.length / comps; i += step) {
    const at = i * comps
    colors.add(
      comps === 3
        ? (pixels[at] << 16) | (pixels[at + 1] << 8) | pixels[at + 2]
        : pixels[at],
    )
    if (colors.size >= 256) return true
  }
  return false
}

function targetSize(
  image: ImageInfo,
  width: number,
  height: number,
  maxDpi: number,
) {
  // Orientation-agnostic: the image can never be shown larger than its page.
  const longTarget = Math.max(image.inches.width, image.inches.height) * maxDpi
  const shortTarget = Math.min(image.inches.width, image.inches.height) * maxDpi
  const scale = Math.min(
    1,
    longTarget / Math.max(width, height),
    shortTarget / Math.min(width, height),
  )
  return {
    scale,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function replaceStream(
  context: PDFContext,
  image: ImageInfo,
  contents: Uint8Array,
  edit: (dict: PDFDict) => void,
) {
  const dict = image.stream.dict.clone(context)
  for (const key of ['Filter', 'DecodeParms', 'DP', 'Length'])
    dict.delete(N(key))
  edit(dict)
  dict.set(N('Length'), PDFNumber.of(contents.length))
  context.assign(image.ref, PDFRawStream.of(dict, contents))
}

/** Returns true if the image stream was replaced by a smaller one. */
async function optimizeImage(
  context: PDFContext,
  image: ImageInfo,
  settings: ModeSettings,
  codec: RasterCodec,
): Promise<boolean> {
  const { dict, contents } = image.stream
  const width = num(dict, 'Width'),
    height = num(dict, 'Height')
  if (!width || !height || width * height > MAX_DECODE_PIXELS) return false
  if (width * height < 250_000) return false
  if (
    dict.has(N('Decode')) ||
    dict.has(N('Mask')) ||
    dict.lookup(N('ImageMask')) !== undefined
  )
    return false
  const comps = colorComponents(dict)
  if (!comps) return false
  const filter = filterName(dict)
  const target = targetSize(image, width, height, settings.maxDpi)
  const downscale = target.scale < 0.98
  const finishJpeg = (bytes: Uint8Array) => {
    if (bytes.length >= contents.length * settings.minGain) return false
    replaceStream(context, image, bytes, (next) => {
      next.set(N('Filter'), N('DCTDecode'))
      next.set(N('Width'), PDFNumber.of(target.width))
      next.set(N('Height'), PDFNumber.of(target.height))
      next.set(N('BitsPerComponent'), PDFNumber.of(8))
      if (comps === 1) next.set(N('ColorSpace'), N('DeviceRGB'))
    })
    return true
  }
  if (filter === 'DCTDecode') {
    const info = jpegInfo(contents)
    if (!info || info.precision !== 8 || info.components !== comps) return false
    const bytes = await codec.toJpeg(
      { kind: 'jpeg', bytes: contents },
      { width, height },
      { width: target.width, height: target.height },
      settings.jpegQuality,
    )
    return bytes ? finishJpeg(bytes) : false
  }
  if (filter !== 'FlateDecode' || num(dict, 'BitsPerComponent') !== 8)
    return false
  const parms = dict.lookup(N('DecodeParms'))
  let predictor = 1
  if (parms instanceof PDFDict) {
    predictor = num(parms, 'Predictor') ?? 1
    const columns = num(parms, 'Columns') ?? 1
    const colors = num(parms, 'Colors') ?? 1
    if (
      predictor === 2 ||
      (predictor >= 10 && (columns !== width || colors !== comps))
    )
      return false
  } else if (parms) return false
  let pixels = await flate(contents, 'decompress')
  if (predictor >= 10) pixels = unpredict(pixels, width, comps)
  if (pixels.length !== width * height * comps) return false
  const photo = looksPhotographic(pixels, comps)
  if (photo && settings.photoToJpeg) {
    const bytes = await codec.toJpeg(
      { kind: 'raw', pixels, components: comps },
      { width, height },
      { width: target.width, height: target.height },
      settings.jpegQuality,
    )
    return bytes ? finishJpeg(bytes) : false
  }
  if (!downscale) return false
  const scaled = await codec.scaleRaw(pixels, comps, { width, height }, target)
  if (!scaled) return false
  const packed = await flate(scaled, 'compress')
  if (packed.length >= contents.length * settings.minGain) return false
  replaceStream(context, image, packed, (next) => {
    next.set(N('Filter'), N('FlateDecode'))
    next.set(N('Width'), PDFNumber.of(target.width))
    next.set(N('Height'), PDFNumber.of(target.height))
  })
  return true
}

async function sha256(data: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

function redirect(context: PDFContext, map: Map<string, PDFRef>) {
  const walk = (value: PDFObject) => {
    if (value instanceof PDFArray) {
      value.asArray().forEach((item, i) => {
        if (item instanceof PDFRef) {
          const next = map.get(item.tag)
          if (next) value.set(i, next)
        } else walk(item)
      })
    } else if (value instanceof PDFDict || value instanceof PDFRawStream) {
      const dict = value instanceof PDFRawStream ? value.dict : value
      for (const [key, item] of dict.entries()) {
        if (item instanceof PDFRef) {
          const next = map.get(item.tag)
          if (next) dict.set(key, next)
        } else walk(item)
      }
    }
  }
  for (const [, object] of context.enumerateIndirectObjects()) walk(object)
}

export async function compressPdf(
  original: Uint8Array,
  mode: CompressionMode,
  codec: RasterCodec,
  options: {
    signal?: AbortSignal
    onProgress?: (progress: CompressProgress) => void
  } = {},
): Promise<CompressOutcome> {
  const { signal, onProgress } = options
  const check = () => {
    if (signal?.aborted) throw cancelled()
  }
  const stats: CompressStats = {
    mode,
    originalBytes: original.length,
    outputBytes: original.length,
    images: { found: 0, optimized: 0, skipped: 0 },
    duplicates: 0,
    removedObjects: 0,
    deflatedStreams: 0,
  }
  const settings = MODE_SETTINGS[mode]
  onProgress?.({ phase: 'analyzing', done: 0, total: 1 })
  const doc = await loadPdf(original)
  const pages = doc.getPageCount()
  const { context } = doc
  if (hasSignature(context)) return { kind: 'signed', bytes: original, stats }
  check()
  // 1. Images (strategy depends on mode; lossless never touches pixels).
  const images = collectImages(doc)
  stats.images.found = images.length
  if (settings.recompressImages) {
    for (let i = 0; i < images.length; i++) {
      check()
      onProgress?.({ phase: 'images', done: i, total: images.length })
      let changed: boolean
      try {
        changed = await optimizeImage(context, images[i], settings, codec)
      } catch {
        changed = false // an undecodable image is kept exactly as it was
      }
      if (changed) stats.images.optimized++
      else stats.images.skipped++
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  // 2. Structure: identical image streams share one object.
  onProgress?.({ phase: 'structure', done: 0, total: 1 })
  const canonical = new Map<string, PDFRef>()
  const redirects = new Map<string, PDFRef>()
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    check()
    if (
      !(object instanceof PDFRawStream) ||
      object.dict.lookup(N('Subtype')) !== N('Image') ||
      object.contents.length < 1024
    )
      continue
    const key =
      (await sha256(object.contents)) +
      object.dict
        .entries()
        .filter(([name]) => name.decodeText() !== 'Length')
        .map(([name, value]) => name.decodeText() + value.toString())
        .sort()
        .join('|')
    const first = canonical.get(key)
    if (first) redirects.set(ref.tag, first)
    else canonical.set(key, ref)
  }
  if (redirects.size) redirect(context, redirects)
  stats.duplicates = redirects.size
  // 3. Drop objects nothing refers to (superseded revisions, orphaned streams).
  const live = reachable(context)
  for (const [ref] of context.enumerateIndirectObjects())
    if (!live.has(ref.tag)) {
      context.delete(ref)
      stats.removedObjects++
    }
  // 4. Uncompressed streams get Flate (XMP metadata stays readable).
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    check()
    if (
      !(object instanceof PDFRawStream) ||
      object.contents.length < 512 ||
      object.dict.has(N('Filter')) ||
      object.dict.has(N('DecodeParms')) ||
      object.dict.lookup(N('Type')) === N('Metadata')
    )
      continue
    const packed = await flate(object.contents, 'compress')
    if (packed.length >= object.contents.length * 0.95) continue
    const dict = object.dict.clone(context)
    dict.set(N('Filter'), N('FlateDecode'))
    dict.set(N('Length'), PDFNumber.of(packed.length))
    context.assign(ref, PDFRawStream.of(dict, packed))
    stats.deflatedStreams++
  }
  onProgress?.({ phase: 'saving', done: 0, total: 1 })
  const bytes = await doc.save({ useObjectStreams: true })
  // The result must reopen with the same page count or it is discarded.
  try {
    const check = await loadPdf(bytes)
    if (check.getPageCount() !== pages) throw new Error('pages')
  } catch {
    return { kind: 'unchanged', bytes: original, stats }
  }
  stats.outputBytes = bytes.length
  return bytes.length < original.length
    ? { kind: 'reduced', bytes, stats }
    : {
        kind: 'unchanged',
        bytes: original,
        stats: { ...stats, outputBytes: original.length },
      }
}
