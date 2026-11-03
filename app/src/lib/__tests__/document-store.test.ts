import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { DocumentStore } from '../document-store'
import {
  rotatePages,
  reorderPages,
  removePages,
  cropPages,
  resizePages,
} from '../pdf-operations'
import { moveSelectedPages } from '../page-order'
async function fixture() {
  const doc = await PDFDocument.create()
  doc.setTitle('Keep metadata')
  for (const width of [100, 200, 300]) doc.addPage([width, 400])
  return doc.save()
}
async function commit(
  store: DocumentStore,
  bytes: Uint8Array,
  kind = 'open',
  options = {},
) {
  const token = store.begin(kind)!
  try {
    return await store.commit(token, bytes, 'test.pdf', options)
  } finally {
    store.end(token)
  }
}
describe('transactional document history', () => {
  it('restores exact contents, stable IDs and selection across edits and redo', async () => {
    const store = new DocumentStore(),
      original = await commit(store, await fixture(), 'open', { saved: true }),
      ids = original.pageIds
    store.select([ids[1]])
    const doc = await PDFDocument.load(original.bytes)
    rotatePages(doc, [1], 90)
    cropPages(doc, [0], { top: 10, bottom: 0, left: 0, right: 0 })
    resizePages(doc, 500, 700, false)
    const edited = await commit(store, await doc.save(), 'crop')
    expect(edited.pageIds).toEqual(ids)
    expect(edited.dirty).toBe(true)
    const reordered = await PDFDocument.load(edited.bytes)
    reorderPages(reordered, [2, 0, 1])
    const result = await commit(store, await reordered.save(), 'reorder', {
      pageIds: [ids[2], ids[0], ids[1]],
    })
    expect((await PDFDocument.load(result.bytes)).getTitle()).toBe(
      'Keep metadata',
    )
    expect(store.getState().snapshot?.selectedIds).toEqual([ids[1]])
    store.undo()
    expect(store.getState().session?.bytes).toBe(edited.bytes)
    store.undo()
    expect(store.getState().session?.bytes).toBe(original.bytes)
    expect(store.getState().session?.dirty).toBe(false)
    store.redo()
    store.redo()
    expect(store.getState().session?.bytes).toBe(result.bytes)
    expect(
      (await PDFDocument.load(store.getState().session!.bytes))
        .getPage(2)
        .getRotation().angle,
    ).toBe(90)
    store.undo()
    await commit(store, edited.bytes, 'compress')
    expect(store.getState().future).toHaveLength(0)
  })
  it('undoes creation/replacement/extraction/deletion using snapshots, including empty state', async () => {
    const store = new DocumentStore(),
      original = await commit(store, await fixture(), 'images')
    store.undo()
    expect(store.getState().session).toBeNull()
    store.redo()
    expect(store.getState().session?.bytes).toBe(original.bytes)
    const doc = await PDFDocument.load(original.bytes)
    removePages(doc, [1])
    const shortened = await commit(store, await doc.save(), 'delete', {
      pageIds: [original.pageIds[0], original.pageIds[2]],
    })
    expect(shortened.pageCount).toBe(2)
    expect(
      (await PDFDocument.load(shortened.bytes))
        .getPages()
        .map((p) => p.getWidth()),
    ).toEqual([100, 300])
    store.undo()
    expect(store.getState().session?.pageCount).toBe(3)
    store.redo()
    expect(store.getState().session?.bytes).toBe(shortened.bytes)
    store.save()
    expect(store.getState().session?.dirty).toBe(false)
    store.clear()
    expect(store.getState().past).toEqual([])
    expect(store.redo()).toBe(false)
  })
  it('rolls back corrupt results, rejects overlapping and stale work', async () => {
    const store = new DocumentStore(),
      original = await commit(store, await fixture()),
      token = store.begin('rotate')!
    expect(store.begin('crop')).toBeNull()
    await expect(
      store.commit(token, new Uint8Array([1]), 'bad.pdf'),
    ).rejects.toThrow()
    expect(store.getState().session).toBe(original)
    store.clear()
    await expect(
      store.commit(token, original.bytes, 'stale.pdf'),
    ).rejects.toThrow('stale')
    expect(store.getState().session).toBeNull()
    store.end(token)
    expect(store.begin('open')).not.toBeNull()
  })
  it('bounds both step count and unique retained bytes and shares repeated buffers', async () => {
    const bytes = await fixture(),
      store = new DocumentStore({ maxSteps: 2, maxBytes: bytes.byteLength * 2 })
    for (let i = 0; i < 5; i++) await commit(store, bytes, 'compress')
    expect(store.getState().past).toHaveLength(2)
    expect(store.historyBytes()).toBe(0)
    expect(store.getState().discarded).toBe(3)
    const tiny = new DocumentStore({ maxBytes: 1 })
    await commit(tiny, bytes)
    await commit(tiny, new Uint8Array(bytes), 'compress')
    expect(tiny.historyBytes()).toBe(0)
    expect(tiny.getState().past).toHaveLength(0)
    expect(tiny.getState().discarded).toBe(2)
  })
  it('rejects invalid stable IDs and preserves the old document', async () => {
    const store = new DocumentStore(),
      original = await commit(store, await fixture()),
      token = store.begin('extract')!
    await expect(
      store.commit(token, original.bytes, 'bad.pdf', {
        pageIds: ['x', 'x', 'y'],
      }),
    ).rejects.toThrow('selection')
    expect(store.getState().session).toBe(original)
  })
})
describe('page actions', () => {
  it('preserves actual page contents/order and rejects invalid permutations or empty deletion', async () => {
    const doc = await PDFDocument.load(await fixture())
    reorderPages(doc, [2, 0, 1])
    expect(
      (await PDFDocument.load(await doc.save()))
        .getPages()
        .map((p) => p.getWidth()),
    ).toEqual([300, 100, 200])
    expect(() => reorderPages(doc, [0, 0, 1])).toThrow()
    expect(() => removePages(doc, [0, 1, 2])).toThrow()
    expect(() => removePages(doc, [-1])).toThrow()
  })
  it('moves groups accessibly without reversing selected pages', () => {
    const selected = new Set([1, 2])
    expect(moveSelectedPages(5, selected, 'up')).toEqual([1, 2, 0, 3, 4])
    expect(moveSelectedPages(5, selected, 'down')).toEqual([0, 3, 1, 2, 4])
    expect(moveSelectedPages(5, selected, 4)).toEqual([0, 3, 4, 1, 2])
  })
})
