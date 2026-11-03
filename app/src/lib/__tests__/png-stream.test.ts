import { expect, it } from 'vitest'
import { inflateSync, deflateSync } from 'node:zlib'
import { readPng, preparePng, unfilterRow } from '../png-stream'
import { generatedPng, pngChunk } from '../../../tests/png-fixtures'
import {
  imageLayout,
  checkDecodeBudget,
  DEFAULT_IMAGE_OPTIONS,
} from '../images-to-pdf'
it('splits RGBA rows losslessly and preserves the exact alpha values', async () => {
  const bytes = await generatedPng(48, 64),
    blob = new Blob([bytes])
  const source = await readPng(blob),
    prepared = await preparePng(blob, source)
  expect(source.dpiX).toBeCloseTo(300, 2)
  expect(prepared.width).toBe(48)
  expect(prepared.height).toBe(64)
  const colors = inflateSync(prepared.colors),
    alpha = inflateSync(prepared.alpha!)
  expect(Array.from(colors.subarray(0, 7))).toEqual([
    0, 40, 90, 160, 40, 90, 160,
  ])
  expect(Array.from(alpha.subarray(0, 4))).toEqual([0, 128, 128, 128])
  expect(Array.from(prepared.thumbnail.subarray(0, 4))).toEqual([
    40, 90, 160, 128,
  ])
})
it('reuses RGB IDAT bytes with a PDF predictor instead of recompressing or decoding a full bitmap', async () => {
  const bytes = await generatedPng(35, 42, { alpha: false }),
    blob = new Blob([bytes]),
    source = await readPng(blob),
    raster = await preparePng(blob, source)
  const idat = Buffer.concat(
    source.idat.map((p) => bytes.subarray(p.start, p.start + p.length)),
  )
  expect(Buffer.from(raster.colors)).toEqual(idat)
  expect(raster.alpha).toBeUndefined()
})
it.each([0, 1, 2, 3, 4])(
  'reverses PNG filter %i exactly across channel/row boundaries',
  (filter) => {
    const raw = Uint8Array.from([20, 40, 60, 70, 100, 140]),
      previous = Uint8Array.from([10, 15, 25, 30, 50, 80]),
      encoded = raw.map((v, x) => {
        const a = x >= 3 ? raw[x - 3] : 0,
          b = previous[x],
          c = x >= 3 ? previous[x - 3] : 0,
          p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c)
        const prediction =
          filter === 0
            ? 0
            : filter === 1
              ? a
              : filter === 2
                ? b
                : filter === 3
                  ? Math.floor((a + b) / 2)
                  : pa <= pb && pa <= pc
                    ? a
                    : pb <= pc
                      ? b
                      : c
        return (v - prediction) & 255
      })
    unfilterRow(encoded, previous, 3, filter)
    expect(encoded).toEqual(raw)
  },
)
it('rejects bad CRC, compressed corruption, missing/extra rows and invalid filters', async () => {
  const input = await generatedPng(2, 2),
    blob = new Blob([input]),
    meta = await readPng(blob)
  const crc = input.slice()
  crc[meta.idat[0].start] ^= 1
  await expect(
    preparePng(new Blob([crc]), await readPng(new Blob([crc]))),
  ).rejects.toThrow('corrupt')
  for (const raw of [
    Buffer.from([5, 0, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.alloc(1),
    Buffer.alloc(40),
  ]) {
    const file = new Blob([
      input.subarray(0, 33),
      pngChunk('IDAT', deflateSync(raw)),
      pngChunk('IEND', new Uint8Array()),
    ])
    await expect(preparePng(file, await readPng(file))).rejects.toThrow(
      'corrupt',
    )
  }
})
it('distinguishes fallback memory budgets and actual PDF physical page constraints from resolution', () => {
  expect(() => checkDecodeBudget(10800, 14400)).toThrow('resource')
  expect(() => imageLayout(10800, 14400, DEFAULT_IMAGE_OPTIONS)).not.toThrow()
  expect(
    imageLayout(
      10800,
      14400,
      { ...DEFAULT_IMAGE_OPTIONS, size: 'original', margin: 'none' },
      300,
      300,
    ),
  ).toMatchObject({ pageWidth: 2592, pageHeight: 3456 })
  expect(() =>
    imageLayout(30000, 1000, { ...DEFAULT_IMAGE_OPTIONS, size: 'original' }),
  ).toThrow('pageSize')
})

it('preserves 16-bit color and alpha samples instead of reducing source precision', async () => {
  const file = new Blob([await generatedPng(8, 9, { depth: 16 })]),
    source = await readPng(file),
    raster = await preparePng(file, source)
  expect(raster.depth).toBe(16)
  expect(Array.from(inflateSync(raster.colors).subarray(0, 7))).toEqual([
    0, 40, 0, 90, 0, 160, 0,
  ])
  expect(Array.from(inflateSync(raster.alpha!).subarray(0, 5))).toEqual([
    0, 128, 0, 128, 0,
  ])
  expect(Array.from(raster.thumbnail.subarray(4, 8))).toEqual([
    40, 90, 160, 128,
  ])
})

it('preflights huge PDF image previews without expanding pixels or restricting editing', async () => {
  const { PDFDocument } = await import('pdf-lib'),
    { assertPreviewBudget } = await import('../pdf-preview-budget')
  const doc = await PDFDocument.create()
  doc.addPage()
  doc.context.register(
    doc.context.stream(new Uint8Array(), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 10800,
      Height: 14400,
      BitsPerComponent: 8,
      ColorSpace: 'DeviceRGB',
    }),
  )
  await expect(assertPreviewBudget(await doc.save())).rejects.toThrow(
    'highResolutionPreview',
  )
})
it('reuses validated compressed samples and releases cached plans without silently reducing 16-bit precision', async () => {
  const { prepareImageData, convertImages, releasePreparedImage } =
    await import('../images-to-pdf')
  const file = new File(
      [await generatedPng(8, 9, { depth: 16 })],
      'cached.png',
      { type: 'image/png' },
    ),
    key = 'cache-test'
  const data = await prepareImageData(file, key),
    entry = { ...data.info, file, id: key }
  const decompress = globalThis.DecompressionStream
  try {
    Object.defineProperty(globalThis, 'DecompressionStream', {
      value: undefined,
      configurable: true,
    })
    expect(
      (await convertImages([entry], DEFAULT_IMAGE_OPTIONS, () => {})).length,
    ).toBeGreaterThan(0)
    releasePreparedImage(key)
    await expect(
      convertImages([entry], DEFAULT_IMAGE_OPTIONS, () => {}),
    ).rejects.toThrow('encoding')
  } finally {
    Object.defineProperty(globalThis, 'DecompressionStream', {
      value: decompress,
      configurable: true,
    })
    releasePreparedImage(key)
  }
})
