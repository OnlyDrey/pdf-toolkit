import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFRef,
} from 'pdf-lib'
import { compressPdf, MODE_SETTINGS, type RasterCodec } from '../pdf-compress'

// Deterministic photographic-looking pixels (many distinct colors, poorly compressible).
function noise(width: number, height: number) {
  const out = new Uint8Array(width * height * 3)
  let seed = 12345
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    out[i] = (seed >>> 24) & 255
  }
  return out
}
function addImage(doc: PDFDocument, pixels: Uint8Array, w: number, h: number) {
  const packed = deflateSync(pixels)
  const ref = doc.context.register(
    PDFRawStream.of(
      doc.context.obj({
        Type: 'XObject',
        Subtype: 'Image',
        Width: w,
        Height: h,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
        Filter: 'FlateDecode',
        Length: packed.length,
      }),
      packed,
    ),
  )
  return ref
}
function place(doc: PDFDocument, page: number, name: string, ref: PDFRef) {
  doc.getPage(page).node.setXObject(PDFName.of(name), ref)
}
class FakeCodec implements RasterCodec {
  calls: { target: { width: number; height: number }; quality: number }[] = []
  scaled = 0
  async toJpeg(
    _source: Parameters<RasterCodec['toJpeg']>[0],
    _size: { width: number; height: number },
    target: { width: number; height: number },
    quality: number,
  ) {
    this.calls.push({ target, quality })
    // Size model: pixel count and quality drive the byte count, like a real encoder.
    return new Uint8Array(
      Math.round(target.width * target.height * quality * 0.3),
    )
  }
  async scaleRaw(
    _pixels: Uint8Array,
    components: 1 | 3,
    _size: { width: number; height: number },
    target: { width: number; height: number },
  ) {
    this.scaled++
    return new Uint8Array(target.width * target.height * components)
  }
}
async function fixture(
  options: { duplicate?: boolean; orphan?: boolean } = {},
) {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  doc.addPage([595, 842])
  const pixels = noise(1600, 1200)
  const image = addImage(doc, pixels, 1600, 1200)
  place(doc, 0, 'Im1', image)
  if (options.duplicate) place(doc, 1, 'Im2', addImage(doc, pixels, 1600, 1200))
  if (options.orphan)
    doc.context.register(
      doc.context.flateStream(new Uint8Array(40_000).fill(7)),
    )
  doc.setTitle('Keep me')
  doc
    .getPage(1)
    .node.set(
      PDFName.of('Contents'),
      doc.context.register(doc.context.stream('0 0 m 10 10 l S\n'.repeat(400))),
    )
  return new Uint8Array(await doc.save({ useObjectStreams: false }))
}
const imageSizes = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes)
  return doc.context.enumerateIndirectObjects().flatMap(([, o]) =>
    o instanceof PDFRawStream &&
    o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
      ? [
          {
            w: (o.dict.get(PDFName.of('Width')) as PDFNumber).asNumber(),
            n: o.contents.length,
            filter: o.dict.get(PDFName.of('Filter'))?.toString(),
          },
        ]
      : [],
  )
}

describe('compressPdf', () => {
  it('modes use materially different strategies', () => {
    expect(MODE_SETTINGS.lossless.recompressImages).toBe(false)
    expect(MODE_SETTINGS.balanced.maxDpi).toBeGreaterThan(
      MODE_SETTINGS.maximum.maxDpi,
    )
    expect(MODE_SETTINGS.balanced.jpegQuality).toBeGreaterThan(
      MODE_SETTINGS.maximum.jpegQuality,
    )
  })

  it('lossless never decodes or alters image pixels but removes dead structure', async () => {
    const input = await fixture({ duplicate: true, orphan: true })
    const codec = new FakeCodec()
    const result = await compressPdf(input, 'lossless', codec)
    expect(codec.calls).toHaveLength(0)
    expect(codec.scaled).toBe(0)
    expect(result.kind).toBe('reduced')
    expect(result.stats.duplicates).toBe(1)
    expect(result.stats.removedObjects).toBeGreaterThanOrEqual(1)
    expect(result.stats.deflatedStreams).toBeGreaterThanOrEqual(1)
    const images = await imageSizes(result.bytes)
    expect(images).toHaveLength(1)
    expect(images[0].w).toBe(1600)
    const out = await PDFDocument.load(result.bytes)
    expect(out.getPageCount()).toBe(2)
    expect(out.getTitle()).toBe('Keep me')
    expect(out.getPage(0).getSize()).toEqual({ width: 595, height: 842 })
    // The shared image is still referenced from both pages.
    expect(result.bytes.length).toBeLessThan(input.length)
  })

  it('balanced and maximum downsample differently and measure real output bytes', async () => {
    const input = await fixture()
    const balanced = new FakeCodec(),
      maximum = new FakeCodec()
    const a = await compressPdf(input, 'balanced', balanced)
    const b = await compressPdf(input, 'maximum', maximum)
    expect(a.kind).toBe('reduced')
    expect(b.kind).toBe('reduced')
    // 595pt page = 8.26in: 150dpi -> 1240px, 100dpi -> 826px for the long/short edge limit.
    expect(balanced.calls[0].target.width).toBeGreaterThan(
      maximum.calls[0].target.width,
    )
    expect(balanced.calls[0].quality).toBeGreaterThan(maximum.calls[0].quality)
    expect(a.stats.outputBytes).toBe(a.bytes.length)
    expect(b.bytes.length).toBeLessThan(a.bytes.length)
    expect(a.stats.images.optimized).toBe(1)
    expect((await imageSizes(a.bytes))[0].filter).toBe('/DCTDecode')
    expect((await PDFDocument.load(b.bytes)).getPageCount()).toBe(2)
  })

  it('keeps the original when the encoder cannot make an image smaller', async () => {
    const input = await fixture()
    const worse: RasterCodec = {
      toJpeg: async () => new Uint8Array(10_000_000),
      scaleRaw: async () => null,
    }
    const result = await compressPdf(input, 'maximum', worse)
    expect(result.stats.images.optimized).toBe(0)
    expect(result.stats.images.skipped).toBe(1)
    expect((await imageSizes(result.bytes))[0].filter).toBe('/FlateDecode')
  })

  it('returns the untouched original when no smaller file can be produced', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    const input = new Uint8Array(await doc.save({ useObjectStreams: true }))
    const result = await compressPdf(input, 'balanced', new FakeCodec())
    expect(result.kind).toBe('unchanged')
    expect(result.bytes).toBe(input)
    expect(result.stats.outputBytes).toBe(input.length)
  })

  it('refuses to rewrite signed documents', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    doc.context.register(
      doc.context.obj({
        Type: 'Sig',
        Filter: 'Adobe.PPKLite',
        ByteRange: [0, 10, 20, 30],
        Contents: PDFRawStream.of(doc.context.obj({}), new Uint8Array(0)).dict,
      }),
    )
    const input = new Uint8Array(await doc.save())
    const result = await compressPdf(input, 'maximum', new FakeCodec())
    expect(result.kind).toBe('signed')
    expect(result.bytes).toBe(input)
  })

  it('cancellation aborts without a result', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      compressPdf(await fixture(), 'balanced', new FakeCodec(), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('vector/text documents shrink losslessly with no image work', async () => {
    const doc = await PDFDocument.create()
    for (let n = 0; n < 5; n++) {
      doc
        .addPage([300, 300])
        .node.set(
          PDFName.of('Contents'),
          doc.context.register(
            doc.context.stream('0 0 m 50 50 l S\n'.repeat(2000)),
          ),
        )
    }
    const input = new Uint8Array(await doc.save({ useObjectStreams: false }))
    for (const mode of ['lossless', 'balanced', 'maximum'] as const) {
      const codec = new FakeCodec()
      const result = await compressPdf(input, mode, codec)
      expect(result.kind).toBe('reduced')
      expect(result.bytes.length).toBeLessThan(input.length / 5)
      expect(result.stats.images.found).toBe(0)
      expect(codec.calls).toHaveLength(0)
      expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(5)
    }
  })

  it('decodes PNG-predicted Flate rasters before recompression', async () => {
    const width = 700,
      height = 600
    const pixels = noise(width, height)
    const row = width * 3
    const filtered = new Uint8Array((row + 1) * height)
    for (let y = 0; y < height; y++) {
      filtered[y * (row + 1)] = 2 // Up
      for (let x = 0; x < row; x++)
        filtered[y * (row + 1) + 1 + x] =
          (pixels[y * row + x] - (y ? pixels[(y - 1) * row + x] : 0)) & 255
    }
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const packed = deflateSync(filtered)
    const ref = doc.context.register(
      PDFRawStream.of(
        doc.context.obj({
          Type: 'XObject',
          Subtype: 'Image',
          Width: width,
          Height: height,
          ColorSpace: 'DeviceRGB',
          BitsPerComponent: 8,
          Filter: 'FlateDecode',
          DecodeParms: {
            Predictor: 15,
            Colors: 3,
            BitsPerComponent: 8,
            Columns: width,
          },
          Length: packed.length,
        }),
        packed,
      ),
    )
    place(doc, 0, 'Im1', ref)
    let seen: Uint8Array | undefined
    const codec: RasterCodec = {
      toJpeg: async (source) => {
        if (source.kind === 'raw') seen = source.pixels
        return new Uint8Array(1000)
      },
      scaleRaw: async () => null,
    }
    const result = await compressPdf(
      new Uint8Array(await doc.save({ useObjectStreams: false })),
      'balanced',
      codec,
    )
    expect(seen).toEqual(pixels)
    expect(result.stats.images.optimized).toBe(1)
  })
})
