import { describe, it, expect } from 'vitest'
import {
  PDFDocument,
  PDFArray,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib'
import {
  inspectImage,
  imageLayout,
  orientationMatrix,
  validateImageBatch,
  validateImageSize,
  addImagePage,
  DEFAULT_IMAGE_OPTIONS as defaults,
} from '../images-to-pdf'
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DQwMDw/z8ADX4DfuoeFyEAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
)
describe('image metadata and limits', () => {
  it('uses magic bytes, rejects unsupported/TIFF/corrupt input', () => {
    expect(inspectImage(png)).toEqual({
      format: 'png',
      width: 2,
      height: 1,
      orientation: 1,
    })
    expect(() => inspectImage(new TextEncoder().encode('<svg></svg>'))).toThrow(
      'type',
    )
    expect(() => inspectImage(new Uint8Array())).toThrow('corrupt')
    expect(() =>
      inspectImage(new Uint8Array([73, 73, 42, 0, 0, 0, 0, 0])),
    ).toThrow('tiff')
    expect(() =>
      inspectImage(new Uint8Array([255, 216, 255, 225, 255, 255])),
    ).toThrow('corrupt')
  })
  it('accepts high-resolution images and large files without arbitrary pixel/byte caps', () => {
    expect(() => validateImageSize(10800, 14400)).not.toThrow()
    expect(() => validateImageSize(30000, 2000)).not.toThrow()
    expect(() => validateImageSize(0, 1)).toThrow('corrupt')
    expect(() => validateImageBatch([{ size: 200 * 1024 ** 2 }])).not.toThrow()
    expect(() => validateImageBatch([])).toThrow('empty')
    expect(() =>
      validateImageBatch(Array.from({ length: 101 }, () => ({ size: 1 }))),
    ).toThrow('batch')
    const bytes = png.slice()
    new DataView(bytes.buffer).setUint32(16, 20000)
    expect(inspectImage(bytes).width).toBe(20000)
  })
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'reads bounded EXIF orientation %i',
    (orientation) => {
      const bytes = new Uint8Array(59)
      bytes.set([
        255,
        216,
        255,
        225,
        0,
        34,
        69,
        120,
        105,
        102,
        0,
        0,
        73,
        73,
        42,
        0,
        8,
        0,
        0,
        0,
        1,
        0,
        18,
        1,
        3,
        0,
        1,
        0,
        0,
        0,
        orientation,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ])
      bytes.set(
        [
          255, 192, 0, 17, 8, 0, 20, 0, 40, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
          255, 218,
        ],
        38,
      )
      expect(inspectImage(bytes)).toEqual({
        format: 'jpeg',
        width: orientation >= 5 ? 20 : 40,
        height: orientation >= 5 ? 40 : 20,
        orientation,
      })
    },
  )
})
describe('PDF layout and orientation', () => {
  it('uses source DPI without downscaling and rejects only incompatible physical pages', () => {
    expect(
      imageLayout(
        10800,
        14400,
        { ...defaults, size: 'original', margin: 'none' },
        300,
        300,
      ),
    ).toMatchObject({ pageWidth: 2592, pageHeight: 3456 })
    expect(() =>
      imageLayout(30000, 1000, { ...defaults, size: 'original' }),
    ).toThrow('pageSize')
    expect(() => imageLayout(30000, 1000, defaults)).not.toThrow()
  })
  it('uses centered contain, A4 auto and normal margins', () => {
    const l = imageLayout(200, 400, defaults)
    expect(l.pageWidth).toBe(595.28)
    expect(l.pageHeight).toBe(841.89)
    expect(l.drawHeight).toBeCloseTo(841.89 - 48)
    expect(l.drawWidth / l.drawHeight).toBe(0.5)
    expect(l.x).toBeCloseTo((l.pageWidth - l.drawWidth) / 2)
    expect(l.y).toBeCloseTo(24)
    expect(imageLayout(400, 200, defaults).pageWidth).toBe(841.89)
  })
  it('uses 96DPI for original images; margins add rather than consume the image area', () => {
    expect(
      imageLayout(960, 480, { ...defaults, size: 'original', margin: 'none' }),
    ).toMatchObject({
      pageWidth: 720,
      pageHeight: 360,
      drawWidth: 720,
      drawHeight: 360,
      x: 0,
      y: 0,
    })
    expect(imageLayout(2, 1, { ...defaults, size: 'original' })).toMatchObject({
      pageWidth: 49.5,
      pageHeight: 48.75,
      drawWidth: 1.5,
      drawHeight: 0.75,
      x: 24,
      y: 24,
    })
  })
  it('honors Letter/forced orientation and fill cropping while preserving margins', () => {
    const l = imageLayout(400, 100, {
      size: 'letter',
      orientation: 'portrait',
      fit: 'cover',
      margin: 'small',
    })
    expect(l).toMatchObject({
      pageWidth: 612,
      pageHeight: 792,
      margin: 12,
      drawHeight: 768,
      y: 12,
    })
    expect(l.x).toBeLessThan(12)
    expect(l.drawWidth / l.drawHeight).toBe(4)
    expect(
      imageLayout(10, 40, {
        ...defaults,
        size: 'letter',
        orientation: 'landscape',
      }),
    ).toMatchObject({ pageWidth: 792, pageHeight: 612 })
    expect(() =>
      imageLayout(1, 1, { ...defaults, fit: 'stretch' as 'contain' }),
    ).toThrow('processing')
  })
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'EXIF %i maps every corner into a nondegenerate unit square',
    (orientation) => {
      const [a, b, c, d, e, f] = orientationMatrix(orientation)
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
      expect(new Set(corners.map((p) => p.join(','))).size).toBe(4)
      corners.flat().forEach((n) => expect([0, 1]).toContain(n))
      expect(Math.abs(a * d - b * c)).toBe(1)
    },
  )
  it('pins reflection and quarter-turn directions', () => {
    expect(orientationMatrix(2)).toEqual([-1, 0, 0, 1, 1, 0])
    expect(orientationMatrix(5)).toEqual([0, -1, -1, 0, 1, 1])
    expect(orientationMatrix(6)).toEqual([0, -1, 1, 0, 0, 1])
    expect(orientationMatrix(7)).toEqual([0, 1, 1, 0, 0, 0])
    expect(orientationMatrix(8)).toEqual([0, 1, -1, 0, 1, 0])
  })
  it('serializes ordered pages, precise placement, clip paths and alpha masks', async () => {
    const doc = await PDFDocument.create(),
      info = inspectImage(png)
    await addImagePage(doc, png, info, {
      ...defaults,
      size: 'original',
      margin: 'none',
    })
    await addImagePage(doc, png, info, {
      ...defaults,
      size: 'letter',
      orientation: 'portrait',
    })
    const saved = await PDFDocument.load(await doc.save())
    expect(saved.getPageCount()).toBe(2)
    expect(saved.getPage(0).getSize()).toEqual({ width: 1.5, height: 0.75 })
    expect(saved.getPage(1).getSize()).toEqual({ width: 612, height: 792 })
    const stream = saved
      .getPage(0)
      .node.lookup(PDFName.of('Contents'), PDFArray)
      .lookup(0, PDFRawStream)
    const ops = new TextDecoder().decode(decodePDFRawStream(stream).decode())
    expect(ops).toContain('0 0 1.5 0.75 re')
    expect(ops).toContain('W\nn')
    expect(ops).toContain('1.5 0 0 0.75 0 0 cm')
    const images = saved.context
      .enumerateIndirectObjects()
      .filter(
        ([, o]) =>
          o instanceof PDFRawStream &&
          o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
      )
    expect(
      images.some(([, o]) => (o as PDFRawStream).dict.has(PDFName.of('SMask'))),
    ).toBe(true)
  })
})
