import { PDFDocument, PDFName } from 'pdf-lib'

export const MAX_PDF_BYTES = 100 * 1024 * 1024
export class PdfInputError extends Error {
  constructor(
    public code: 'invalid' | 'encrypted' | 'tooLarge' | 'version' | 'downgrade',
  ) {
    super(code)
  }
}
export async function loadPdf(data: ArrayBuffer | Uint8Array) {
  if (data.byteLength > MAX_PDF_BYTES) throw new PdfInputError('tooLarge')
  try {
    const doc = await PDFDocument.load(data, {
      throwOnInvalidObject: true,
      updateMetadata: false,
    })
    if (doc.isEncrypted) throw new PdfInputError('encrypted')
    if (!doc.getPageCount()) throw new PdfInputError('invalid')
    return doc
  } catch (error) {
    if (error instanceof PdfInputError) throw error
    if (error instanceof Error && /encrypt/i.test(error.message))
      throw new PdfInputError('encrypted')
    throw new PdfInputError('invalid')
  }
}
export function detectVersion(bytes: Uint8Array): string | null {
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 16))
  return /^%PDF-(1\.[0-7]|2\.0)(?:\r\n|\r|\n)/.exec(header)?.[1] ?? null
}
/** Fixed-length header metadata edit only. Never rewrites offsets or converts features. */
export async function rewriteVersion(
  bytes: Uint8Array,
  target: string,
): Promise<Uint8Array> {
  const version = detectVersion(bytes)
  if (!version || !/^(1\.[0-7]|2\.0)$/.test(target))
    throw new PdfInputError('version')
  const doc = await loadPdf(bytes)
  const catalogVersion = doc.catalog
    .get(PDFName.of('Version'))
    ?.toString()
    .replace(/^\//, '')
  const effective = Math.max(Number(version), Number(catalogVersion) || 0)
  if (Number(target) < effective) throw new PdfInputError('downgrade')
  const result = new Uint8Array(bytes)
  result.set(new TextEncoder().encode(target), 5)
  return result
}
