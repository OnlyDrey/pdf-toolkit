import { degrees, type PDFDocument } from 'pdf-lib'

export function rotatePages(
  doc: PDFDocument,
  indices: number[],
  angle: number,
) {
  for (const index of indices) {
    const page = doc.getPage(index)
    page.setRotation(degrees((page.getRotation().angle + angle) % 360))
  }
}
export function resizePages(
  doc: PDFDocument,
  width: number,
  height: number,
  scale: boolean,
) {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('Invalid page dimensions')
  for (const page of doc.getPages()) {
    const sideways = page.getRotation().angle % 180 !== 0
    const targetW = sideways ? height : width
    const targetH = sideways ? width : height
    const { width: originalW, height: originalH } = page.getSize()
    if (scale) {
      const factor = Math.min(targetW / originalW, targetH / originalH)
      page.scaleContent(factor, factor)
      page.scaleAnnotations(factor, factor)
      // Translation is applied outside the scaling transform, in target points.
      page.translateContent(
        (targetW - originalW * factor) / 2,
        (targetH - originalH * factor) / 2,
      )
    }
    // Preserve /Rotate so rotated source content keeps its visual orientation.
    page.setSize(targetW, targetH)
  }
}
export interface CropMargins {
  top: number
  right: number
  bottom: number
  left: number
}
export function cropPages(
  doc: PDFDocument,
  indices: number[],
  margins: CropMargins,
) {
  if (!Object.values(margins).every((n) => Number.isFinite(n) && n >= 0))
    throw new Error('Invalid crop margins')
  for (const index of indices) {
    const page = doc.getPage(index)
    const box = page.getMediaBox()
    const width = box.width - margins.left - margins.right
    const height = box.height - margins.top - margins.bottom
    if (width <= 0 || height <= 0) throw new Error('Invalid crop margins')
    page.setCropBox(box.x + margins.left, box.y + margins.bottom, width, height)
  }
}

/** Reinsert existing page objects so catalog metadata/resources survive reorder. */
export function reorderPages(doc: PDFDocument, order: number[]) {
  const pages = doc.getPages()
  if (
    order.length !== pages.length ||
    new Set(order).size !== pages.length ||
    order.some((i) => !Number.isInteger(i) || i < 0 || i >= pages.length)
  )
    throw new Error('Invalid page order')
  for (let n = pages.length - 1; n >= 0; n--) doc.removePage(n)
  for (const index of order) doc.addPage(pages[index])
}
export function removePages(doc: PDFDocument, indices: number[]) {
  const selected = Array.from(new Set(indices))
  if (
    !selected.length ||
    selected.length >= doc.getPageCount() ||
    selected.some(
      (i) => !Number.isInteger(i) || i < 0 || i >= doc.getPageCount(),
    )
  )
    throw new Error('Invalid page removal')
  selected.sort((a, b) => b - a).forEach((index) => doc.removePage(index))
}
