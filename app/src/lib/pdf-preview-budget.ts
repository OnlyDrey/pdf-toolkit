import { PDFDocument, PDFRawStream, PDFName, PDFNumber } from 'pdf-lib'
// Rendering is separate from editing: do not expand huge embedded rasters just
// to draw a 200px preview. This budget never changes the saved document.
export async function assertPreviewBudget(data: Uint8Array) {
  const doc = await PDFDocument.load(data, { updateMetadata: false })
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (
      !(object instanceof PDFRawStream) ||
      object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')
    )
      continue
    const width = object.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(),
      height = object.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber()
    if (width * height > 32 * 1024 ** 2)
      throw new Error('highResolutionPreview')
  }
}
