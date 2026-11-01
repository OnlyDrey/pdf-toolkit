import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, degrees } from 'pdf-lib'
import {
  loadPdf,
  detectVersion,
  rewriteVersion,
  MAX_PDF_BYTES,
} from '../pdf-document'
import { cropPages, resizePages, rotatePages } from '../pdf-operations'
import en from '../../i18n/en.json'
import nb from '../../i18n/nb.json'

async function fixture() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 400])
  page.drawText('Private document')
  doc.addPage([300, 500])
  return doc
}
describe('PDF input and header safety', () => {
  it('rejects invalid, empty and oversized input', async () => {
    await expect(
      loadPdf(new TextEncoder().encode('not a PDF')),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      loadPdf(
        await (await PDFDocument.create()).save({ addDefaultPage: false }),
      ),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      loadPdf(new Uint8Array(MAX_PDF_BYTES + 1)),
    ).rejects.toMatchObject({ code: 'tooLarge' })
  })
  it.each([
    '%PDF-1.70\n',
    '%PDF-9.0\n',
    'prefix%PDF-1.7\n',
    '%PDF-1.7',
    '%PDF-1.\n',
  ])('rejects incomplete or ambiguous header %s', (header) => {
    expect(detectVersion(new TextEncoder().encode(header))).toBeNull()
  })
  it('only edits three version bytes without modifying xref offsets or the input', async () => {
    const bytes = await (await fixture()).save({ useObjectStreams: false })
    const result = await rewriteVersion(bytes, '2.0')
    expect(result.length).toBe(bytes.length)
    expect(result.subarray(8)).toEqual(bytes.subarray(8))
    expect(detectVersion(bytes)).toBe('1.7')
    expect(detectVersion(result)).toBe('2.0')
    expect((await loadPdf(result)).getPageCount()).toBe(2)
    const lower = await rewriteVersion(bytes, '1.4')
    expect(detectVersion(lower)).toBe('1.4')
    expect(lower.subarray(8)).toEqual(bytes.subarray(8))
    expect(lower.subarray(0, 5)).toEqual(bytes.subarray(0, 5))
    expect((await loadPdf(lower)).getPageCount()).toBe(2)
  })
  it('preserves catalog version overrides while changing only the header', async () => {
    const doc = await fixture()
    doc.catalog.set(PDFName.of('Version'), PDFName.of('2.0'))
    const bytes = await doc.save()
    const result = await rewriteVersion(bytes, '1.4')
    expect(detectVersion(result)).toBe('1.4')
    expect(
      (await loadPdf(result)).catalog.get(PDFName.of('Version'))?.toString(),
    ).toBe('/2.0')
    expect(result.subarray(8)).toEqual(bytes.subarray(8))
  })
  it.each(['0.9', '1.8', '2.1', '1.4\n', 'v1.4'])(
    'rejects unsupported target %s',
    async (target) => {
      await expect(
        rewriteVersion(await (await fixture()).save(), target),
      ).rejects.toMatchObject({ code: 'version' })
    },
  )
  it('rejects encrypted documents instead of bypassing encryption', async () => {
    const doc = await fixture()
    const encryption = doc.context.obj({
      Filter: 'Standard',
      V: 1,
      R: 2,
      O: 'owner',
      U: 'user',
      P: -4,
    })
    doc.context.trailerInfo.Encrypt = doc.context.register(encryption)
    await expect(
      loadPdf(await doc.save({ useObjectStreams: false })),
    ).rejects.toMatchObject({ code: 'encrypted' })
  })
})
describe('page geometry regression', () => {
  it('rotates only selected pages and survives serialization', async () => {
    const doc = await fixture()
    rotatePages(doc, [1], 90)
    const result = await loadPdf(await doc.save())
    expect(result.getPage(0).getRotation().angle).toBe(0)
    expect(result.getPage(1).getRotation().angle).toBe(90)
  })
  it('resizes rotated pages without losing their rotation', async () => {
    const doc = await fixture()
    doc.getPage(0).setRotation(degrees(90))
    resizePages(doc, 600, 800, true)
    const result = await loadPdf(await doc.save())
    expect(result.getPage(0).getRotation().angle).toBe(90)
    expect(result.getPage(0).getSize()).toEqual({ width: 800, height: 600 })
    expect(result.getPage(1).getSize()).toEqual({ width: 600, height: 800 })
  })
  it('crops relative to a nonzero media origin and rejects impossible margins', async () => {
    const doc = await fixture()
    doc.getPage(0).setMediaBox(10, 20, 200, 400)
    cropPages(doc, [0], { left: 10, right: 20, top: 30, bottom: 40 })
    expect((await loadPdf(await doc.save())).getPage(0).getCropBox()).toEqual({
      x: 20,
      y: 60,
      width: 170,
      height: 330,
    })
    expect(() =>
      cropPages(doc, [0], { left: 200, right: 0, top: 0, bottom: 0 }),
    ).toThrow()
  })
})
function keys(value: object, prefix = ''): string[] {
  return Object.entries(value)
    .flatMap(([key, item]) =>
      typeof item === 'object'
        ? keys(item, prefix + key + '.')
        : [prefix + key],
    )
    .sort()
}
it('keeps English and Norwegian translation keys in parity', () =>
  expect(keys(en)).toEqual(keys(nb)))
