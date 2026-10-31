import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import { MAX_PDF_BYTES } from './pdf-document'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href
interface PreviewDocument {
  promise: Promise<PDFDocumentProxy>
  task?: PDFDocumentLoadingTask
  references: number
  disposed: boolean
}
// A thumbnail grid shares one parser/worker and source buffer per File.
const documents = new WeakMap<File, PreviewDocument>()
export function acquirePreviewDocument(file: File) {
  let entry = documents.get(file)
  if (!entry) {
    const created: PreviewDocument = {
      references: 0,
      disposed: false,
      promise: Promise.resolve(undefined as never),
    }
    created.promise = (async () => {
      if (file.size > MAX_PDF_BYTES) throw new Error('tooLarge')
      const data = await file.arrayBuffer()
      if (created.disposed) throw new Error('Preview cancelled')
      created.task = getDocument({ data: new Uint8Array(data) })
      return created.task.promise
    })()
    entry = created
    documents.set(file, entry)
  }
  entry.references++
  const current = entry
  let released = false
  return {
    promise: current.promise,
    release() {
      if (released) return
      released = true
      if (--current.references === 0) {
        current.disposed = true
        documents.delete(file)
        void current.task?.destroy().catch(() => {})
      }
    },
  }
}
