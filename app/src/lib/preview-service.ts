import { imageWorkerAvailable, imageWorkerRequest } from './image-worker-client'
import { createImagePreview } from './images-to-pdf'
import { acquirePreviewDocument } from './pdf-preview'
import { ResourceCache, RenderQueue, type ResourceLease } from './preview-cache'
import type { RenderTask } from 'pdfjs-dist'
export interface PreviewBitmap {
  url: string
  width: number
  height: number
  ptW: number
  ptH: number
  pages: number
  limited?: boolean
}
export interface PreviewSize {
  page: number
  width: number
  height: number
  rotation?: number
}
const cache = new ResourceCache<PreviewBitmap>(),
  queue = new RenderQueue(2),
  ids = new WeakMap<File, number>()
let next = 0
export const previewFileKey = (file: File) => {
  let id = ids.get(file)
  if (!id) {
    id = ++next
    ids.set(file, id)
  }
  return `file-${id}`
}
const jobs = new Map<
  string,
  {
    controller: AbortController
    users: number
    readers: number
    lease?: ResourceLease<PreviewBitmap>
    promise: Promise<void>
  }
>()
const cancelled = () => new DOMException('Cancelled', 'AbortError')
function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('previewUnavailable'))),
      'image/png',
    ),
  )
}
export async function pdfPreview(
  file: File,
  size: PreviewSize,
  signal: AbortSignal,
): Promise<ResourceLease<PreviewBitmap>> {
  const key = `${previewFileKey(file)}:pdf:${size.page}:${Math.round(size.width)}:${Math.round(size.height)}:${size.rotation ?? 0}`
  if (signal.aborted) throw cancelled()
  const ready = cache.acquire(key)
  if (ready) return ready
  let job = jobs.get(key)
  if (job?.controller.signal.aborted) {
    jobs.delete(key)
    job = undefined
  }
  if (!job) {
    const controller = new AbortController()
    const created: {
      controller: AbortController
      users: number
      readers: number
      lease?: ResourceLease<PreviewBitmap>
      promise: Promise<void>
    } = { controller, users: 0, readers: 0, promise: Promise.resolve() }
    created.promise = queue
      .enqueue(async () => {
        const existing = cache.acquire(key)
        if (existing) {
          created.lease = existing
          return
        }
        const lease = acquirePreviewDocument(file)
        let task: RenderTask | undefined
        const canvas = document.createElement('canvas')
        canvas.dataset.previewRender = 'true'
        const cancel = () => task?.cancel()
        controller.signal.addEventListener('abort', cancel, { once: true })
        try {
          const doc = await lease.promise
          if (controller.signal.aborted) throw cancelled()
          const page = await doc.getPage(size.page),
            base = page.getViewport({
              scale: 1,
              rotation: page.rotate + (size.rotation ?? 0),
            })
          const scale = Math.min(
            Math.max(1, size.width) / base.width,
            Math.max(1, size.height) / base.height,
            Math.sqrt(4_000_000 / (base.width * base.height)),
          )
          const vp = page.getViewport({
            scale,
            rotation: page.rotate + (size.rotation ?? 0),
          })
          canvas.width = Math.max(1, Math.floor(vp.width))
          canvas.height = Math.max(1, Math.floor(vp.height))
          const context = canvas.getContext('2d')
          if (!context) throw new Error('previewUnavailable')
          task = page.render({ canvas, canvasContext: context, viewport: vp })
          await task.promise
          if (controller.signal.aborted) throw cancelled()
          const blob = await png(canvas)
          if (controller.signal.aborted) throw cancelled()
          const value: PreviewBitmap = {
            url: URL.createObjectURL(blob),
            width: canvas.width,
            height: canvas.height,
            ptW: base.width,
            ptH: base.height,
            pages: doc.numPages,
          }
          created.lease = cache.put(
            key,
            value,
            blob.size + canvas.width * canvas.height * 4,
            (v) => URL.revokeObjectURL(v.url),
          )
        } finally {
          controller.signal.removeEventListener('abort', cancel)
          canvas.width = canvas.height = 0
          lease.release()
        }
      }, controller.signal)
      .finally(() => {
        if (jobs.get(key) === created) jobs.delete(key)
      })
    // Every consumer races its own cancellation while sharing a bounded render job.
    created.promise.catch(() => {})
    job = created
    jobs.set(key, created)
  }
  job.users++
  const current = job
  let abort: () => void = () => {}
  try {
    await Promise.race([
      current.promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(cancelled())
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      }),
    ])
    if (signal.aborted) throw cancelled()
    if (!current.lease) throw new Error('previewUnavailable')
    current.readers++
    let released = false
    return {
      value: current.lease.value,
      release: () => {
        if (released) return
        released = true
        current.readers--
        if (!current.readers && !current.users) current.lease?.release()
      },
    }
  } finally {
    signal.removeEventListener('abort', abort)
    current.users--
    if (!current.users && signal.aborted) current.controller.abort()
    if (!current.users && !current.readers) current.lease?.release()
  }
}
export function invalidatePreviews(file?: File) {
  const prefix = file ? previewFileKey(file) + ':' : undefined
  cache.invalidate((key) => !prefix || key.startsWith(prefix))
  for (const [key, job] of jobs)
    if (!prefix || key.startsWith(prefix)) job.controller.abort()
}
export const previewStats = () => ({ cache: cache.stats, queue: queue.stats })

export async function imagePreview(
  file: File,
  fallback: string | undefined,
  signal: AbortSignal,
): Promise<ResourceLease<PreviewBitmap>> {
  const key = previewFileKey(file) + ':image:1600'
  const existing = cache.acquire(key)
  if (existing) return existing
  try {
    return await queue.enqueue(async () => {
      const blob = imageWorkerAvailable()
        ? await imageWorkerRequest('preview', { file, edge: 1600 })
        : await createImagePreview(file, 1600)
      if (signal.aborted) throw cancelled()
      const header = new DataView(await blob.slice(0, 24).arrayBuffer()),
        width = header.getUint32(16),
        height = header.getUint32(20)
      const value = {
        url: URL.createObjectURL(blob),
        width,
        height,
        ptW: width,
        ptH: height,
        pages: 1,
      }
      return cache.put(
        key,
        value,
        blob.size + value.width * value.height * 4,
        (v) => URL.revokeObjectURL(v.url),
      )
    }, signal)
  } catch (error) {
    if (signal.aborted) throw error
    if (fallback)
      return {
        value: {
          url: fallback,
          width: 160,
          height: 160,
          ptW: 160,
          ptH: 160,
          pages: 1,
          limited: true,
        },
        release: () => {},
      }
    throw error
  }
}
